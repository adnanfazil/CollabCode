const fs = require('fs').promises;
const path = require('path');
const File = require('../models/File');
const logger = require('../utils/logger');

/**
 * Synchronizes project files from database to filesystem
 * @param {string} projectId - The project ID to sync
 * @returns {Promise<{success: boolean, filesCount: number, error?: string}>}
 */
async function syncProjectToDisk(projectId) {
  try {
    logger.info(`📂 Starting file sync for project ${projectId}`);
    
    // Create project directory
    const projectDir = path.join(process.cwd(), 'temp', 'projects', projectId.toString());
    await fs.mkdir(projectDir, { recursive: true });
    
    // Get all files for the project (excluding folders)
    const projectFiles = await File.find({ 
      project: projectId, 
      type: 'file',
      isDeleted: false 
    }).select('name content parent');
    
    logger.debug(`📁 Found ${projectFiles.length} files to sync`);
    
    // Build file tree to handle nested structure
    const fileTree = await buildFileTree(projectFiles, projectId);
    
    // Write files to disk
    let syncedCount = 0;
    for (const file of projectFiles) {
      try {
        const filePath = await getFileSystemPath(file, projectDir, projectId);
        
        // Ensure directory exists
        const fileDir = path.dirname(filePath);
        await fs.mkdir(fileDir, { recursive: true });
        
        // Write file content
        await fs.writeFile(filePath, file.content || '', 'utf8');
        syncedCount++;
        
        logger.debug(`✅ Synced: ${path.relative(projectDir, filePath)}`);
      } catch (fileError) {
        logger.error(`❌ Failed to sync file ${file.name}:`, fileError);
      }
    }
    
    logger.info(`📂 File sync completed: ${syncedCount}/${projectFiles.length} files synced`);
    
    return {
      success: true,
      filesCount: syncedCount,
      projectDir
    };
    
  } catch (error) {
    logger.error(`💥 File sync failed for project ${projectId}:`, error);
    return {
      success: false,
      filesCount: 0,
      error: error.message
    };
  }
}

/**
 * Builds a file tree structure to resolve parent-child relationships
 * @param {Array} files - Array of file documents
 * @param {string} projectId - Project ID
 * @returns {Promise<Map>} Map of file ID to file path
 */
async function buildFileTree(files, projectId) {
  const fileMap = new Map();
  const pathMap = new Map();
  
  // Get all folders for the project
  const folders = await File.find({ 
    project: projectId, 
    type: 'folder',
    isDeleted: false 
  }).select('name parent');
  
  // Build folder paths first
  const folderPaths = new Map();
  
  // Helper function to resolve folder path recursively
  const resolveFolderPath = async (folderId) => {
    if (!folderId) return '';
    if (folderPaths.has(folderId.toString())) {
      return folderPaths.get(folderId.toString());
    }
    
    const folder = folders.find(f => f._id.toString() === folderId.toString());
    if (!folder) return '';
    
    const parentPath = await resolveFolderPath(folder.parent);
    const fullPath = parentPath ? path.join(parentPath, folder.name) : folder.name;
    
    folderPaths.set(folderId.toString(), fullPath);
    return fullPath;
  };
  
  // Resolve all folder paths
  for (const folder of folders) {
    await resolveFolderPath(folder._id);
  }
  
  return folderPaths;
}

/**
 * Gets the filesystem path for a file, considering its parent folder structure
 * @param {Object} file - File document
 * @param {string} projectDir - Project directory path
 * @param {string} projectId - Project ID
 * @returns {Promise<string>} Full filesystem path
 */
async function getFileSystemPath(file, projectDir, projectId) {
  if (!file.parent) {
    // Root level file
    return path.join(projectDir, file.name);
  }
  
  // File is in a folder, resolve the folder path
  const folderPath = await resolveFolderPath(file.parent, projectId);
  return path.join(projectDir, folderPath, file.name);
}

/**
 * Resolves the full path of a folder by traversing parent relationships
 * @param {string} folderId - Folder ID
 * @param {string} projectId - Project ID
 * @returns {Promise<string>} Folder path
 */
async function resolveFolderPath(folderId, projectId) {
  if (!folderId) return '';
  
  const folder = await File.findOne({ 
    _id: folderId, 
    project: projectId, 
    type: 'folder',
    isDeleted: false 
  }).select('name parent');
  
  if (!folder) return '';
  
  const parentPath = await resolveFolderPath(folder.parent, projectId);
  return parentPath ? path.join(parentPath, folder.name) : folder.name;
}

/**
 * Syncs files from container filesystem back to database
 * @param {string} projectId - The project ID to sync
 * @returns {Promise<{success: boolean, newFiles: number, error?: string}>}
 */
async function syncProjectFromDisk(projectId) {
  try {
    logger.info(`📥 Starting reverse file sync for project ${projectId}`);

    const projectDir = path.join(process.cwd(), 'temp', 'projects', projectId.toString());

    // Check if directory exists
    try {
      await fs.access(projectDir);
    } catch (error) {
      return { success: true, newFiles: 0 };
    }

    // Get all files from filesystem
    const filesOnDisk = await getAllFilesRecursive(projectDir);

    // Get existing files from database
    const existingFiles = await File.find({
      project: projectId,
      type: 'file',
      isDeleted: false
    }).select('name path');

    const existingPaths = new Set(existingFiles.map(f => f.path || f.name));
    let newFilesCount = 0;

    // Find new files that don't exist in database
    for (const filePath of filesOnDisk) {
      const relativePath = path.relative(projectDir, filePath);
      const normalizedPath = relativePath.replace(/\\/g, '/'); // Normalize path separators

      if (!existingPaths.has(normalizedPath) && !existingPaths.has(path.basename(filePath))) {
        try {
          // Read file content
          const content = await fs.readFile(filePath, 'utf8');

          // Create new file in database
          await File.create({
            name: path.basename(filePath),
            content,
            type: 'file',
            path: normalizedPath,
            project: projectId,
            metadata: {
              lastEditedBy: null, // System created
              createdInContainer: true
            }
          });

          newFilesCount++;
          logger.info(`📥 Synced new file from container: ${normalizedPath}`);
        } catch (fileError) {
          logger.error(`❌ Failed to sync file ${relativePath}:`, fileError);
        }
      }
    }

    logger.info(`📥 Reverse sync completed: ${newFilesCount} new files synced`);
    return { success: true, newFiles: newFilesCount };

  } catch (error) {
    logger.error(`❌ Failed to sync project from disk:`, error);
    return { success: false, error: error.message, newFiles: 0 };
  }
}

/**
 * Gets all files recursively from a directory
 * @param {string} dirPath - Directory path
 * @returns {Promise<string[]>} Array of file paths
 */
async function getAllFilesRecursive(dirPath) {
  const files = [];

  async function scanDirectory(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        // Skip node_modules and other common directories
        if (!['node_modules', '.git', '.next', 'dist', 'build'].includes(entry.name)) {
          await scanDirectory(fullPath);
        }
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await scanDirectory(dirPath);
  return files;
}

/**
 * Cleans up project directory by removing it entirely
 * @param {string} projectId - Project ID
 * @returns {Promise<boolean>} Success status
 */
async function cleanupProjectDirectory(projectId) {
  try {
    const projectDir = path.join(process.cwd(), 'temp', 'projects', projectId.toString());
    await fs.rm(projectDir, { recursive: true, force: true });
    logger.info(`🗑️ Cleaned up project directory: ${projectId}`);
    return true;
  } catch (error) {
    logger.error(`❌ Failed to cleanup project directory ${projectId}:`, error);
    return false;
  }
}

module.exports = {
  syncProjectToDisk,
  syncProjectFromDisk,
  cleanupProjectDirectory
};