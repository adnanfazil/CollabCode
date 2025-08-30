const { spawn } = require('child_process');
const logger = require('../utils/logger');
const { syncProjectToDisk, cleanupProjectDirectory } = require('../services/fileSync');
const path = require('path');

class ContainerManager {
  constructor() {
    this.activeSessions = new Map(); // socketId -> session info
    this.activeContainers = new Map(); // containerId -> container info
    this.portMappings = new Map(); // projectId -> port mappings
    this.dockerAvailable = null; // Cache Docker availability status
  }

  /**
   * Checks if Docker is available and running
   * @returns {Promise<boolean>}
   */
  async checkDockerAvailability() {
    if (this.dockerAvailable !== null) {
      return this.dockerAvailable;
    }

    try {
      // Test with a simple container run to verify Docker daemon is actually working
      const dockerProcess = spawn('docker', ['run', '--rm', 'hello-world'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      return new Promise((resolve) => {
        let output = '';
        let error = '';

        dockerProcess.stdout.on('data', (data) => {
          output += data.toString();
        });

        dockerProcess.stderr.on('data', (data) => {
          error += data.toString();
        });

        dockerProcess.on('close', (code) => {
          const isAvailable = code === 0 && (output.includes('Hello from Docker') || output.includes('hello-world'));
          this.dockerAvailable = isAvailable;
          
          if (!isAvailable) {
            logger.warn(`🐳 Docker not available: exit code ${code}, error: ${error.trim()}`);
            logger.warn(`🐳 Docker output: ${output.trim()}`);
          } else {
            logger.info(`🐳 Docker is available and working properly`);
          }
          
          resolve(isAvailable);
        });

        dockerProcess.on('error', (err) => {
          logger.warn(`🐳 Docker check failed: ${err.message}`);
          this.dockerAvailable = false;
          resolve(false);
        });

        // Timeout after 10 seconds for container pull/run
        setTimeout(() => {
          dockerProcess.kill();
          logger.warn(`🐳 Docker check timed out - daemon may not be running`);
          this.dockerAvailable = false;
          resolve(false);
        }, 10000);
      });
    } catch (error) {
      logger.warn(`🐳 Docker availability check error: ${error.message}`);
      this.dockerAvailable = false;
      return false;
    }
  }

  /**
   * Creates a new terminal session for a project
   * @param {string} socketId - Socket ID for the session
   * @param {string} projectId - Project ID
   * @param {Function} onOutput - Callback for terminal output
   * @param {Function} onError - Callback for errors
   * @param {Function} onPreview - Callback for preview URL detection
   * @returns {Promise<{success: boolean, containerId?: string, error?: string}>}
   */
  async createSession(socketId, projectId, onOutput, onError, onPreview) {
    try {
      // Check if session already exists for this socket
      if (this.activeSessions.has(socketId)) {
        logger.warn(`⚠️ Session already exists for socket ${socketId}, skipping creation`);
        return { success: false, error: 'Session already exists' };
      }
      
      logger.info(`🐳 Creating container session for project ${projectId}, socket ${socketId}`);

      // Check if Docker is available
      const dockerAvailable = await this.checkDockerAvailability();
      if (!dockerAvailable) {
        logger.warn(`🐳 Docker not available, falling back to local terminal for project ${projectId}`);
        return this.createFallbackSession(socketId, projectId, onOutput, onError, onPreview);
      }

      // Sync project files to disk first
      const syncResult = await syncProjectToDisk(projectId);
      if (!syncResult.success) {
        throw new Error(`File sync failed: ${syncResult.error}`);
      }

      const projectDir = path.join(process.cwd(), 'temp', 'projects', projectId);
      const containerId = `collabcode-${projectId}-${Date.now()}`;
      
      // Get available port for potential HTTP servers
      const { default: getPort, portNumbers } = await import('get-port');
      const availablePort = await getPort({ port: portNumbers(3000, 9010) });
      
      // Docker run command with security constraints
      const dockerArgs = [
        'run',
        '-i',
        '--rm',
        '--name', containerId,
        '--user', 'node', // Run as non-root user
        '--cpus', '1',    // CPU limit
        '--memory', '512m', // Memory limit
        '--network', 'bridge',
        '-w', '/workspace',
        '-v', `${projectDir}:/workspace`,
        '-p', `${availablePort}:${availablePort}`, // Port mapping for HTTP servers
        // Cache mounts for faster dependency installs
        '-v', 'collabcode-npm-cache:/home/node/.npm',
        '-v', 'collabcode-pip-cache:/home/node/.cache/pip',
        'node:18-alpine', // Base image with Node.js
        '/bin/sh' // Start with shell
      ];

      logger.debug(`🐳 Starting container with args: docker ${dockerArgs.join(' ')}`);

      // Spawn Docker container
      const containerProcess = spawn('docker', dockerArgs, {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Store session info
      const sessionInfo = {
        socketId,
        projectId,
        containerId,
        process: containerProcess,
        port: availablePort,
        onOutput,
        onError,
        onPreview,
        createdAt: new Date(),
        isActive: true
      };

      this.activeSessions.set(socketId, sessionInfo);
      this.activeContainers.set(containerId, sessionInfo);

      // Handle container output
      containerProcess.stdout.on('data', (data) => {
        const output = data.toString();
        logger.debug(`📤 Container Output (${containerId}): ${output.trim()}`);
        
        // Check for HTTP server patterns
        this.detectHttpServer(output, sessionInfo);
        
        onOutput(output);
      });

      // Handle container errors
      containerProcess.stderr.on('data', (data) => {
        const error = data.toString();
        logger.debug(`❌ Container Error (${containerId}): ${error.trim()}`);
        onError(error);
      });

      // Handle container exit
      containerProcess.on('close', (code) => {
        logger.info(`🐳 Container ${containerId} exited with code ${code}`);
        this.cleanupSession(socketId);
        
        // If container exits with error code, try fallback
        if (code !== 0 && code !== null) {
          logger.warn(`🐳 Container failed with code ${code}, attempting fallback for socket ${socketId}`);
          this.createFallbackSession(socketId, projectId, onOutput, onError, onPreview)
            .then(result => {
              if (result.success) {
                logger.info(`✅ Fallback session created after container failure`);
              }
            })
            .catch(err => {
              logger.error(`💥 Fallback session creation failed:`, err);
            });
        }
      });

      // Handle container spawn errors
      containerProcess.on('error', (error) => {
        logger.error(`💥 Container spawn error for ${containerId}:`, error);
        onError(`Container failed to start: ${error.message}`);
        this.cleanupSession(socketId);
        
        // Try fallback when container spawn fails
        logger.warn(`🐳 Container spawn failed, attempting fallback for socket ${socketId}`);
        this.createFallbackSession(socketId, projectId, onOutput, onError, onPreview)
          .then(result => {
            if (result.success) {
              logger.info(`✅ Fallback session created after spawn failure`);
            }
          })
          .catch(err => {
            logger.error(`💥 Fallback session creation failed:`, err);
          });
      });

      // Set a timeout for container initialization
      const containerTimeout = setTimeout(() => {
        logger.warn(`🐳 Container ${containerId} initialization timeout, attempting fallback`);
        containerProcess.kill('SIGTERM');
        this.cleanupSession(socketId);
        
        // Create fallback session on timeout
        this.createFallbackSession(socketId, projectId, onOutput, onError, onPreview)
          .then(result => {
            if (result.success) {
              logger.info(`✅ Fallback session created after container timeout`);
            }
          })
          .catch(err => {
            logger.error(`💥 Fallback session creation failed after timeout:`, err);
          });
      }, 15000); // 15 second timeout
      
      // Clear timeout if container starts successfully
      containerProcess.stdout.once('data', () => {
        clearTimeout(containerTimeout);
        logger.info(`✅ Container session created: ${containerId}`);
      });
      
      return {
        success: true,
        containerId,
        port: availablePort,
        sessionType: 'container'
      };

    } catch (error) {
      logger.error(`💥 Failed to create container session:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Creates a fallback local terminal session when Docker is not available
   * @param {string} socketId - Socket ID for the session
   * @param {string} projectId - Project ID
   * @param {Function} onOutput - Callback for terminal output
   * @param {Function} onError - Callback for errors
   * @param {Function} onPreview - Callback for preview URL detection
   * @returns {Promise<{success: boolean, containerId?: string, error?: string}>}
   */
  async createFallbackSession(socketId, projectId, onOutput, onError, onPreview) {
    try {
      // Check if session already exists for this socket
      if (this.activeSessions.has(socketId)) {
        logger.warn(`⚠️ Fallback session already exists for socket ${socketId}, skipping creation`);
        return { success: false, error: 'Session already exists' };
      }
      
      logger.info(`💻 Creating fallback terminal session for project ${projectId}, socket ${socketId}`);

      // Sync project files to disk first
      const syncResult = await syncProjectToDisk(projectId);
      if (!syncResult.success) {
        throw new Error(`File sync failed: ${syncResult.error}`);
      }

      const projectDir = path.join(process.cwd(), 'temp', 'projects', projectId);
      const sessionId = `fallback-${projectId}-${Date.now()}`;
      
      // Get available port for potential HTTP servers
      const { default: getPort, portNumbers } = await import('get-port');
      const availablePort = await getPort({ port: portNumbers(3000, 9010) });
      
      // Use PowerShell on Windows for better compatibility
      const shellCommand = process.platform === 'win32' ? 'powershell.exe' : '/bin/bash';
      // Launch in interactive mode so the shell stays open and continues reading from stdin
      const shellArgs = process.platform === 'win32'
        ? ['-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit']
        : ['-i'];

      // Spawn local shell process
      const terminalProcess = spawn(shellCommand, shellArgs, {
        cwd: projectDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PORT: availablePort }
      });

      // Store session info
      const sessionInfo = {
        socketId,
        projectId,
        containerId: sessionId,
        process: terminalProcess,
        port: availablePort,
        onOutput,
        onError,
        onPreview,
        createdAt: new Date(),
        isActive: true,
        isFallback: true
      };

      this.activeSessions.set(socketId, sessionInfo);
      this.activeContainers.set(sessionId, sessionInfo);

      // Handle terminal output
      terminalProcess.stdout.on('data', (data) => {
        const output = data.toString();
        logger.debug(`📤 Terminal Output (${sessionId}): ${output.trim()}`);
        
        // Check for HTTP server patterns
        this.detectHttpServer(output, sessionInfo);
        
        onOutput(output);
      });

      // Handle terminal errors
      terminalProcess.stderr.on('data', (data) => {
        const error = data.toString();
        logger.debug(`❌ Terminal Error (${sessionId}): ${error.trim()}`);
        onError(error);
      });

      // Handle terminal exit
      terminalProcess.on('close', (code) => {
        logger.info(`💻 Terminal ${sessionId} exited with code ${code}`);
        this.cleanupSession(socketId);
      });

      // Handle terminal spawn errors
      terminalProcess.on('error', (error) => {
        logger.error(`💥 Terminal spawn error for ${sessionId}:`, error);
        onError(`Terminal failed to start: ${error.message}`);
        this.cleanupSession(socketId);
      });

      // Send initial setup commands for Windows
      if (process.platform === 'win32') {
        setTimeout(() => {
          terminalProcess.stdin.write(`cd "${projectDir}"\r\n`);
          terminalProcess.stdin.write('Write-Host "💻 Fallback terminal ready (Docker not available)" -ForegroundColor Green\r\n');
          terminalProcess.stdin.write('Write-Host "Type your commands below:" -ForegroundColor Cyan\r\n');
        }, 500);
      } else {
        setTimeout(() => {
          terminalProcess.stdin.write(`cd "${projectDir}"\n`);
          terminalProcess.stdin.write('echo "💻 Fallback terminal ready (Docker not available)"\n');
          terminalProcess.stdin.write('echo "Type your commands below:"\n');
        }, 500);
      }

      logger.info(`✅ Fallback terminal session created: ${sessionId}`);
      
      return {
        success: true,
        containerId: sessionId,
        port: availablePort,
        sessionType: 'fallback'
      };

    } catch (error) {
      logger.error(`💥 Failed to create fallback terminal session:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Executes a command in an existing container session
   * @param {string} socketId - Socket ID
   * @param {string} command - Command to execute
   * @returns {boolean} Success status
   */
  execCommand(socketId, command) {
    const session = this.activeSessions.get(socketId);
    if (!session || !session.isActive) {
      logger.warn(`❌ No active session found for socket ${socketId}`);
      return false;
    }

    try {
      logger.debug(`⚡ Executing command in ${session.containerId}: ${command.trim()}`);
      
      // Write command to container stdin with proper line endings
      const lineEnding = (process.platform === 'win32' && session.isFallback) ? '\r\n' : '\n';
      session.process.stdin.write(command + lineEnding);
      return true;
    } catch (error) {
      logger.error(`💥 Failed to execute command in ${session.containerId}:`, error);
      return false;
    }
  }

  /**
   * Sends interrupt signal (Ctrl+C) to container
   * @param {string} socketId - Socket ID
   * @returns {boolean} Success status
   */
  interrupt(socketId) {
    const session = this.activeSessions.get(socketId);
    if (!session || !session.isActive) {
      return false;
    }

    try {
      logger.debug(`🛑 Sending interrupt to container ${session.containerId}`);
      
      // Send Ctrl+C to container
      session.process.stdin.write('\x03');
      return true;
    } catch (error) {
      logger.error(`💥 Failed to interrupt container ${session.containerId}:`, error);
      return false;
    }
  }

  /**
   * Stops a container session
   * @param {string} socketId - Socket ID
   * @returns {Promise<boolean>} Success status
   */
  async stopSession(socketId) {
    const session = this.activeSessions.get(socketId);
    if (!session) {
      return false;
    }

    try {
      logger.info(`🛑 Stopping container session ${session.containerId}`);
      
      // Mark as inactive
      session.isActive = false;
      
      // Try graceful shutdown first
      if (session.process && !session.process.killed) {
        session.process.stdin.write('exit\n');
        
        // Wait a bit for graceful shutdown
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Force kill if still running
        if (!session.process.killed) {
          session.process.kill('SIGTERM');
          
          // Final force kill after timeout
          setTimeout(() => {
            if (!session.process.killed) {
              session.process.kill('SIGKILL');
            }
          }, 5000);
        }
      }
      
      // Cleanup
      this.cleanupSession(socketId);
      
      return true;
    } catch (error) {
      logger.error(`💥 Failed to stop container session:`, error);
      return false;
    }
  }

  /**
   * Detects HTTP servers in container output and emits preview events
   * @param {string} output - Container output
   * @param {Object} session - Session info
   */
  detectHttpServer(output, session) {
    // Common HTTP server patterns
    const patterns = [
      /(?:Server running|Listening|Available) (?:on|at) .*:(\d+)/i,
      /(?:Local|Development server).*http:\/\/.*:(\d+)/i,
      /http:\/\/localhost:(\d+)/i,
      /http:\/\/0\.0\.0\.0:(\d+)/i,
      /Port (\d+) is already in use/i
    ];

    for (const pattern of patterns) {
      const match = output.match(pattern);
      if (match) {
        const detectedPort = parseInt(match[1]);
        logger.info(`🌐 HTTP server detected on port ${detectedPort} in container ${session.containerId}`);
        
        // Emit preview event
        const previewUrl = `http://localhost:${session.port}`;
        session.onPreview({
          projectId: session.projectId,
          port: detectedPort,
          previewUrl,
          containerId: session.containerId
        });
        
        break;
      }
    }
  }

  /**
   * Cleans up session resources
   * @param {string} socketId - Socket ID
   */
  cleanupSession(socketId) {
    const session = this.activeSessions.get(socketId);
    if (session) {
      logger.debug(`🧹 Cleaning up session for socket ${socketId}`);
      
      this.activeSessions.delete(socketId);
      this.activeContainers.delete(session.containerId);
      
      // Optional: cleanup project directory
      // cleanupProjectDirectory(session.projectId);
    }
  }

  /**
   * Gets session info for a socket
   * @param {string} socketId - Socket ID
   * @returns {Object|null} Session info
   */
  getSession(socketId) {
    return this.activeSessions.get(socketId) || null;
  }

  /**
   * Gets all active sessions
   * @returns {Array} Array of session info
   */
  getActiveSessions() {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Cleanup all sessions (for graceful shutdown)
   * @returns {Promise<void>}
   */
  async cleanup() {
    logger.info(`🧹 Cleaning up ${this.activeSessions.size} active container sessions`);
    
    const cleanupPromises = Array.from(this.activeSessions.keys()).map(socketId => 
      this.stopSession(socketId)
    );
    
    await Promise.all(cleanupPromises);
    
    this.activeSessions.clear();
    this.activeContainers.clear();
    this.portMappings.clear();
  }
}

module.exports = ContainerManager;