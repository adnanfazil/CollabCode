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
    // Reset cache to check fresh each time for debugging
    // if (this.dockerAvailable !== null) {
    //   return this.dockerAvailable;
    // }

    try {
      // First check if docker command exists
      const versionProcess = spawn('docker', ['--version'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      return new Promise((resolve) => {
        let output = '';
        let error = '';

        versionProcess.stdout.on('data', (data) => {
          output += data.toString();
        });

        versionProcess.stderr.on('data', (data) => {
          error += data.toString();
        });

        versionProcess.on('close', (code) => {
          if (code !== 0) {
            logger.warn(`🐳 Docker command not found: exit code ${code}, error: ${error.trim()}`);
            this.dockerAvailable = false;
            resolve(false);
            return;
          }

          logger.info(`🐳 Docker version: ${output.trim()}`);

          // Now test with a simple container run to verify Docker daemon is working
          const testProcess = spawn('docker', ['run', '--rm', 'hello-world'], {
            stdio: ['pipe', 'pipe', 'pipe']
          });

          let testOutput = '';
          let testError = '';

          testProcess.stdout.on('data', (data) => {
            testOutput += data.toString();
          });

          testProcess.stderr.on('data', (data) => {
            testError += data.toString();
          });

          testProcess.on('close', (testCode) => {
            const isAvailable = testCode === 0 && (testOutput.includes('Hello from Docker') || testOutput.includes('hello-world'));
            this.dockerAvailable = isAvailable;

            if (!isAvailable) {
              logger.warn(`🐳 Docker daemon not working: exit code ${testCode}`);
              logger.warn(`🐳 Docker test error: ${testError.trim()}`);
              logger.warn(`🐳 Docker test output: ${testOutput.trim()}`);
            } else {
              logger.info(`🐳 Docker is available and working properly`);
            }

            resolve(isAvailable);
          });

          testProcess.on('error', (err) => {
            logger.warn(`🐳 Docker test failed: ${err.message}`);
            this.dockerAvailable = false;
            resolve(false);
          });

          // Timeout after 15 seconds for container pull/run
          setTimeout(() => {
            testProcess.kill();
            logger.warn(`🐳 Docker test timed out - daemon may not be running`);
            this.dockerAvailable = false;
            resolve(false);
          }, 15000);
        });

        versionProcess.on('error', (err) => {
          logger.warn(`🐳 Docker version check failed: ${err.message}`);
          this.dockerAvailable = false;
          resolve(false);
        });

        // Timeout for version check
        setTimeout(() => {
          versionProcess.kill();
          logger.warn(`🐳 Docker version check timed out`);
          this.dockerAvailable = false;
          resolve(false);
        }, 5000);
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
        logger.warn(`⚠️ Session already exists for socket ${socketId}, cleaning up and recreating`);
        await this.stopSession(socketId);
      }

      // Validate projectId
      if (!projectId || projectId === 'undefined' || projectId === 'null' || projectId.toString() === 'NaN') {
        logger.error(`❌ Invalid projectId provided: ${projectId}`);
        return { success: false, error: 'Invalid project ID provided' };
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
      // Sanitize projectId for container name (Docker names must be lowercase alphanumeric with hyphens)
      const sanitizedProjectId = projectId.toString().toLowerCase().replace(/[^a-z0-9-]/g, '-');
      const containerId = `collabcode-${sanitizedProjectId}-${Date.now()}`;

      // Get available port for potential HTTP servers
      const { default: getPort } = await import('get-port');
      const availablePort = await getPort({ port: [3001, 3002, 3003, 3004, 3005, 8000, 8080, 8081, 8082, 8083, 9000, 9001, 9002, 9003, 9004] });

      // Docker run command with security constraints
      // Use -i only (not -it) to avoid TTY issues on Windows
      const dockerArgs = [
        'run',
        '-i', // Interactive mode only, no TTY allocation
        '--rm',
        '--name', containerId,
        '--user', 'node', // Run as non-root user
        '--cpus', '1',    // CPU limit
        '--memory', '512m', // Memory limit
        '--network', 'bridge',
        '-w', '/workspace',
        '-v', `${projectDir}:/workspace`,
        // Map multiple common ports to the available host port range
        '-p', `${availablePort}:3000`,     // Map host port to container port 3000
        '-p', `${availablePort + 1}:3001`, // Map host port+1 to container port 3001
        '-p', `${availablePort + 2}:3010`, // Map host port+2 to container port 3010
        '-p', `${availablePort + 3}:8000`, // Map host port+3 to container port 8000
        '-p', `${availablePort + 4}:8010`, // Map host port+4 to container port 8010
        '-p', `${availablePort + 5}:8080`, // Map host port+5 to container port 8080
        '-p', `${availablePort + 6}:5000`, // Map host port+6 to container port 5000
        '-p', `${availablePort + 7}:4000`, // Map host port+7 to container port 4000
        '-p', `${availablePort + 8}:9000`, // Map host port+8 to container port 9000
        // Cache mounts for faster dependency installs
        '-v', 'collabcode-npm-cache:/home/node/.npm',
        '-v', 'collabcode-pip-cache:/home/node/.cache/pip',
        'node:18-alpine', // Base image with Node.js
        '/bin/sh' // Start with shell
      ];

      logger.debug(`🐳 Starting container with args: docker ${dockerArgs.join(' ')}`);

      // Spawn Docker container with proper Windows handling
      const spawnOptions = {
        stdio: ['pipe', 'pipe', 'pipe']
      };

      // On Windows, use shell to avoid TTY issues
      if (process.platform === 'win32') {
        spawnOptions.shell = true;
      }

      const containerProcess = spawn('docker', dockerArgs, spawnOptions);

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

      // Debug logging for session storage
      logger.debug(`🔍 Session stored for socketId: ${socketId}, containerId: ${containerId}`);
      logger.debug(`🔍 Total active sessions after creation: ${this.activeSessions.size}`);

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

        // Log container startup errors for debugging
        if (error.includes('docker:') || error.includes('Error response from daemon')) {
          logger.error(`🐳 Docker daemon error: ${error.trim()}`);
        }

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

      // Clear timeout once the container process has spawned
      containerProcess.on('spawn', () => {
        clearTimeout(containerTimeout);
        logger.info(`✅ Container process spawned: ${containerId}`);

        // Wait a bit longer for container to fully start, then send initial commands
        setTimeout(() => {
          try {
            // Check if container is actually running by sending a test command
            logger.debug(`🔍 Testing container connectivity for ${containerId}`);
            containerProcess.stdin.write('echo "🐳 Container terminal ready - $(date)"\n');
            containerProcess.stdin.write('pwd\n');
            containerProcess.stdin.write('whoami\n');
          } catch (error) {
            logger.error(`⚠️ Failed to send initial commands to ${containerId}: ${error.message}`);
            // Try fallback if initial commands fail
            this.createFallbackSession(socketId, projectId, onOutput, onError, onPreview)
              .then(result => {
                if (result.success) {
                  logger.info(`✅ Fallback session created after container command failure`);
                }
              })
              .catch(err => {
                logger.error(`💥 Fallback session creation failed:`, err);
              });
          }
        }, 2000); // Increased delay to 2 seconds
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
        logger.warn(`⚠️ Fallback session already exists for socket ${socketId}, cleaning up and recreating`);
        await this.stopSession(socketId);
      }

      // Validate projectId
      if (!projectId || projectId === 'undefined' || projectId === 'null' || projectId.toString() === 'NaN') {
        logger.error(`❌ Invalid projectId provided for fallback session: ${projectId}`);
        return { success: false, error: 'Invalid project ID provided' };
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
      const { default: getPort } = await import('get-port');
      const availablePort = await getPort({ port: [3001, 3002, 3003, 3004, 3005, 8000, 8080, 8081, 8082, 8083, 9000, 9001, 9002, 9003, 9004] });
      
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
    // Debug logging for session lookup
    logger.debug(`🔍 Looking for session with socketId: ${socketId}`);
    logger.debug(`🔍 Active sessions count: ${this.activeSessions.size}`);
    logger.debug(`🔍 Active session keys: ${Array.from(this.activeSessions.keys()).join(', ')}`);

    const session = this.activeSessions.get(socketId);
    if (!session) {
      logger.warn(`❌ No session found for socket ${socketId}`);
      logger.debug(`🔍 Available sessions: ${JSON.stringify(Array.from(this.activeSessions.entries()).map(([id, s]) => ({ id, containerId: s.containerId, isActive: s.isActive })))}`);
      return false;
    }

    if (!session.isActive) {
      logger.warn(`❌ Session found but not active for socket ${socketId}`);
      return false;
    }

    // Check if the process is still alive
    if (!session.process || session.process.killed || session.process.exitCode !== null) {
      logger.warn(`❌ Container process is not running for socket ${socketId}`);
      logger.debug(`🔍 Process state: killed=${session.process?.killed}, exitCode=${session.process?.exitCode}`);
      return false;
    }

    try {
      // Handle special sync commands
      if (command.trim() === 'sync-files') {
        this.syncProjectFiles(session.projectId);
        return true;
      }

      if (command.trim() === 'sync-from-container') {
        this.syncFromContainer(session.projectId);
        return true;
      }

      logger.debug(`⚡ Executing command in ${session.containerId}: ${command.trim()}`);

      // Write command to container stdin with proper line endings
      const lineEnding = (process.platform === 'win32' && session.isFallback) ? '\r\n' : '\n';
      session.process.stdin.write(command + lineEnding);
      return true;
    } catch (error) {
      logger.error(`💥 Failed to execute command in ${session.containerId}:`, error);

      // If command execution fails, mark session as inactive
      session.isActive = false;
      return false;
    }
  }

  /**
   * Syncs project files to container filesystem
   * @param {string} projectId - Project ID
   */
  async syncProjectFiles(projectId) {
    try {
      logger.info(`🔄 Manual file sync requested for project ${projectId}`);
      const { syncProjectToDisk } = require('../services/fileSync');
      const result = await syncProjectToDisk(projectId);

      if (result.success) {
        logger.info(`✅ Files synced successfully: ${result.filesCount} files`);
      } else {
        logger.error(`❌ File sync failed: ${result.error}`);
      }
    } catch (error) {
      logger.error(`💥 File sync error:`, error);
    }
  }

  /**
   * Syncs files from container filesystem back to database
   * @param {string} projectId - Project ID
   */
  async syncFromContainer(projectId) {
    try {
      logger.info(`📥 Manual reverse file sync requested for project ${projectId}`);
      const { syncProjectFromDisk } = require('../services/fileSync');
      const result = await syncProjectFromDisk(projectId);

      if (result.success) {
        logger.info(`✅ Reverse sync completed: ${result.newFiles} new files found`);
      } else {
        logger.error(`❌ Reverse sync failed: ${result.error}`);
      }
    } catch (error) {
      logger.error(`💥 Reverse sync error:`, error);
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
      
      // For fallback sessions (local processes), try multiple interrupt methods
      if (session.isFallback) {
        // Method 1: Send Ctrl+C character to stdin
        session.process.stdin.write('\x03');
        
        // Method 2: Send SIGINT signal to process (if supported)
        setTimeout(() => {
          if (session.process && !session.process.killed) {
            try {
              session.process.kill('SIGINT');
              logger.debug(`📡 Sent SIGINT to process ${session.process.pid}`);
            } catch (killError) {
              logger.debug(`⚠️ SIGINT failed, process may have already terminated`);
            }
          }
        }, 100);
      } else {
        // For containerized sessions, send Ctrl+C to container
        session.process.stdin.write('\x03');
      }
      
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
      logger.info(`🛑 Stopping ${session.isFallback ? 'fallback' : 'container'} session ${session.containerId}`);

      // Mark as inactive immediately
      session.isActive = false;

      // Cleanup first to prevent duplicate operations
      this.cleanupSession(socketId);

      // Handle process termination
      if (session.process && !session.process.killed) {
        try {
          // For fallback sessions (PowerShell), send exit command
          if (session.isFallback) {
            session.process.stdin.write('exit\r\n');

            // Wait briefly for graceful exit
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Force kill if still running
            if (!session.process.killed) {
              session.process.kill('SIGTERM');

              // Final force kill after short timeout
              setTimeout(() => {
                if (!session.process.killed) {
                  session.process.kill('SIGKILL');
                }
              }, 2000);
            }
          } else {
            // For container sessions, kill immediately
            session.process.kill('SIGTERM');

            setTimeout(() => {
              if (!session.process.killed) {
                session.process.kill('SIGKILL');
              }
            }, 3000);
          }
        } catch (killError) {
          logger.debug(`⚠️ Process kill error (process may have already terminated):`, killError.message);
        }
      }

      return true;
    } catch (error) {
      logger.error(`💥 Failed to stop session:`, error);
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
        logger.info(`🌐 HTTP server detected on port ${detectedPort} in ${session.isFallback ? 'fallback' : 'container'} ${session.containerId}`);

        // For fallback sessions, use the detected port directly
        // For container sessions, map to the appropriate host port
        let hostPort;
        if (session.isFallback) {
          hostPort = detectedPort; // In fallback mode, the detected port is the actual host port
        } else {
          hostPort = this.getHostPortForContainerPort(detectedPort, session.port);
        }

        const previewUrl = `http://localhost:${hostPort}`;

        logger.info(`🌐 Preview URL: ${previewUrl} (${session.isFallback ? 'fallback' : 'container'} mode)`);

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
   * Maps container port to host port based on Docker port mapping
   * @param {number} containerPort - Port inside container
   * @param {number} baseHostPort - Base host port assigned to session
   * @returns {number} Host port to access the service
   */
  getHostPortForContainerPort(containerPort, baseHostPort) {
    // For fallback sessions (local), the detected port is the actual host port
    // For container sessions, we need to map based on Docker port mapping
    const portMappings = {
      3000: baseHostPort,           // 3000 -> basePort
      3001: baseHostPort + 1,       // 3001 -> basePort + 1
      3010: baseHostPort + 2,       // 3010 -> basePort + 2
      8000: baseHostPort + 3,       // 8000 -> basePort + 3
      8010: baseHostPort + 4,       // 8010 -> basePort + 4  <- Your current app port
      8080: baseHostPort + 5,       // 8080 -> basePort + 5
      5000: baseHostPort + 6,       // 5000 -> basePort + 6
      4000: baseHostPort + 7,       // 4000 -> basePort + 7
      9000: baseHostPort + 8        // 9000 -> basePort + 8
    };

    return portMappings[containerPort] || containerPort; // For fallback, use detected port directly
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
   * Checks if a container is actually running
   * @param {string} containerId - Container ID
   * @returns {Promise<boolean>} Whether container is running
   */
  async checkContainerStatus(containerId) {
    try {
      const checkProcess = spawn('docker', ['inspect', '--format={{.State.Running}}', containerId], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      return new Promise((resolve) => {
        let output = '';

        checkProcess.stdout.on('data', (data) => {
          output += data.toString();
        });

        checkProcess.on('close', (code) => {
          const isRunning = output.trim() === 'true';
          logger.debug(`🔍 Container ${containerId} running status: ${isRunning}`);
          resolve(isRunning);
        });

        checkProcess.on('error', () => {
          resolve(false);
        });
      });
    } catch (error) {
      logger.debug(`⚠️ Failed to check container status: ${error.message}`);
      return false;
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
   * Debug method to list all sessions
   */
  debugListSessions() {
    logger.info(`🔍 Debug: Total active sessions: ${this.activeSessions.size}`);
    for (const [socketId, session] of this.activeSessions.entries()) {
      logger.info(`🔍 Session: socketId=${socketId}, containerId=${session.containerId}, isActive=${session.isActive}, processKilled=${session.process?.killed}, exitCode=${session.process?.exitCode}`);
    }
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