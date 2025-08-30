"use client"

import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import {
  Code,
  Play,
  Save,
  Users,
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  Plus,
  MoreHorizontal,
  Search,
  Terminal,
  GitBranch,
  Upload,
  X,
  Wifi,
  WifiOff,
  RotateCcw
} from "lucide-react"
import Link from "next/link"
import { useState, useEffect, use } from "react"
import { useAuth } from "@/lib/auth-context"
import { useSocket } from "@/lib/socket-context"
import { useRouter } from "next/navigation"
import { apiClient } from "@/lib/api"
import CodeEditor from "@/components/code-editor"
import SocketDebug from "@/components/socket-debug"
import TerminalComponent from "@/components/terminal"
import ChatButton from "@/components/chatbot/ChatButton"
import UnifiedChat from "@/components/UnifiedChat"
import { useRef } from "react"
import type React from "react"

interface Collaborator {
  id: string
  name: string
  avatar?: string
  status?: "online" | "away" | "offline" | string
  line?: number
  color?: string
}

interface FileItem {
  _id: string
  name: string
  type: "file" | "folder"
  children?: FileItem[]
  content?: string
  parent?: string
}

interface Project {
  _id?: string
  name?: string
  programmingLanguage?: string
  collaborators?: Collaborator[]
}

interface ChatMessage {
  id: string
  message: string
  user: {
    id: string
    name: string
    email: string
  }
  timestamp: string
}

interface TabItem extends FileItem {
  modified?: boolean
}

export default function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null)
  const [files, setFiles] = useState<FileItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [expandedFolders, setExpandedFolders] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<FileItem | null>(null)
  const [activeFileContent, setActiveFileContent] = useState("")
  const [openTabs, setOpenTabs] = useState<TabItem[]>([])
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newChatMessage, setNewChatMessage] = useState('')
  const [terminalLogs, setTerminalLogs] = useState<string[]>([])  
  const [terminalOutput, setTerminalOutput] = useState<string>('')
  const chatTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const [runMode, setRunMode] = useState<'logs' | 'html'>('logs')
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [iframeSrcDoc, setIframeSrcDoc] = useState<string>("")
  const uploadInputRef = useRef<HTMLInputElement | null>(null)
  const [pendingJsCode, setPendingJsCode] = useState<string | null>(null)

  const { isAuthenticated } = useAuth()
  const { 
    isConnected, 
    isConnecting,
    connectionError,
    collaborators, 
    chatMessages, 
    chatTypingUsers,
    joinProject, 
    leaveProject, 
    sendChatMessage,
    sendCodeChange,
    sendCursorPosition,
    sendFileSelect,
    startFileEdit,
    stopFileEdit,
    startChatTyping,
    stopChatTyping,
    reconnect
  } = useSocket()
  const router = useRouter()

  // Helpers for terminal output and running code
  const appendLog = (line: string) => setTerminalLogs(prev => [...prev, line])
  const getActiveFileExt = () => activeFile?.name?.split(".").pop()?.toLowerCase()
  const buildJsRunnerHtml = () => `<!DOCTYPE html><html><head><meta charset=\"utf-8\"/><script>
    (function(){
      function send(type, msg){ parent.postMessage({ type, msg }, '*'); }
      ['log','error','warn','info'].forEach(fn=>{
        const orig = console[fn];
        console[fn] = function(){ send('log', Array.from(arguments).map(a=>{
          try { return typeof a==='object'? JSON.stringify(a): String(a); } catch(e){ return '[object]'; }
        }).join(' ')); orig && orig.apply(console, arguments); };
      });
      window.onerror = function(msg, url, line, col){ send('error', String(msg) + ' @' + line + ':' + col); };
      window.addEventListener('message', function(e){
        try {
          var data = e && e.data;
          if (data && data.type === 'EXEC' && typeof data.code === 'string') {
            try { new Function(data.code)(); } catch (err) { send('error', String(err)); }
          }
        } catch(_){}
      });
    })();
  </script></head><body></body></html>`
  const runCode = () => {
    if (!activeFile) return
    setTerminalOpen(true)
    setTerminalLogs([])

    const ext = getActiveFileExt()
    const content = activeFileContent

    if (ext === 'html') {
      setRunMode('html')
      const runner = `<!DOCTYPE html><html><head><meta charset=\"utf-8\"/><script>
        (function(){
          function send(type, msg){ parent.postMessage({ type, msg }, '*'); }
          ['log','error','warn','info'].forEach(fn=>{
            const orig = console[fn];
            console[fn] = function(){ send('log', Array.from(arguments).map(a=>typeof a==='object'? JSON.stringify(a): String(a)).join(' ')); orig && orig.apply(console, arguments); };
          });
          window.onerror = function(msg, url, line, col){ send('error', msg + ' @' + line + ':' + col); };
        })();
      </script></head><body>
      ${content}
      </body></html>`
      setIframeSrcDoc(runner)
      appendLog('HTML preview rendered.')
      return
    }

    if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
      setRunMode('logs')
      appendLog('Running JavaScript...')
      setIframeSrcDoc(buildJsRunnerHtml())
      setPendingJsCode(content)
      return
    }

    appendLog(`Run not supported for .${ext || 'unknown'} files.`)
    setRunMode('logs')
  }

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
      return
    }

    fetchProjectData()
  }, [isAuthenticated, router])

  // Join project room when component mounts and project is loaded
  useEffect(() => {
    if (project?._id) {
      if (isConnected) {
        joinProject(project._id)
      }
      
      return () => {
        if (project._id) {
          leaveProject(project._id)
        }
      }
    }
  }, [project?._id, isConnected, joinProject, leaveProject])

  // Update terminal output for AI assistant
  useEffect(() => {
    setTerminalOutput(terminalLogs.join('\n'))
  }, [terminalLogs])

  const fetchProjectData = async () => {
    try {
      setLoading(true)
      setError("")
      
      const [projectResponse, filesResponse] = await Promise.all([
        apiClient.getProject(id),
        apiClient.getProjectFiles(id)
      ])
      
      // Extract project data
      const projectData = projectResponse.data?.project || projectResponse
      setProject(projectData)
      
      // Extract files data from response (supports both array and wrapped shapes)
      const filesData = Array.isArray(filesResponse)
        ? filesResponse
        : (filesResponse as any)?.data?.files ?? []
      const validFiles = Array.isArray(filesData) ? filesData : []
      setFiles(validFiles)
      
      // Open the first file if available
      if (validFiles.length > 0) {
        const firstFile = validFiles.find(f => f.type !== 'folder')
        if (firstFile) {
          openFile(firstFile)
        }
      }
    } catch (err: any) {
      console.error('Error loading project:', err)
      setError(err.message || 'Failed to load project')
      setFiles([]) // Ensure files is always an array
    } finally {
      setLoading(false)
    }
  }
 
  const openFile = async (file: FileItem) => {
    if (file.type === 'folder') return
    
    try {
      const fileData = await apiClient.getFile(file._id) as FileItem & { content?: string }
      setActiveFile(fileData)
      setActiveFileContent(fileData?.content || '')
      
      // Send file selection event to other collaborators
      if (project?._id) {
        sendFileSelect(file._id, project._id)
        startFileEdit(file._id, project._id)
      }
      
      // Add to open tabs if not already open (dedupe using functional update)
      setOpenTabs(prev => {
        if (prev.some(tab => tab._id === file._id)) return prev
        return [...prev, { ...fileData, modified: false }]
      })
    } catch (err: any) {
      setError(err.message || 'Failed to load file')
    }
  }
 
  const saveFile = async () => {
    if (!activeFile) return
    
    try {
      setSaving(true)
      await apiClient.updateFile(activeFile._id, { content: activeFileContent })
      
      // Update tab to show saved state
      setOpenTabs(prev => prev.map(tab => 
        tab._id === activeFile._id ? { ...tab, modified: false } : tab
      ))
    } catch (err: any) {
      setError(err.message || 'Failed to save file')
    } finally {
      setSaving(false)
    }
  }

  const handleContentChange = (content: string) => {
    setActiveFileContent(content)
    
    // Mark tab as modified
    setOpenTabs(prev => prev.map(tab => 
      tab._id === activeFile?._id ? { ...tab, modified: true } : tab
    ))
  }

  // Auto-save 1s after edits stop
  useEffect(() => {
    if (!activeFile) return
    const timer = setTimeout(() => {
      const isModified = openTabs.some(t => t._id === activeFile._id && t.modified)
      if (isModified) {
        saveFile()
      }
    }, 1000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFileContent, activeFile?._id])

  // Global message listener for logs/errors from iframe runner
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event?.data || typeof event.data !== 'object') return
      if ((event.data as any).type === 'log') appendLog(String((event.data as any).msg))
      if ((event.data as any).type === 'error') appendLog(`Error: ${String((event.data as any).msg)}`)
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  if (!isAuthenticated) {
    return null
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white">Loading project...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-red-400 text-center">
          <div className="mb-4">{error}</div>
          <Button onClick={fetchProjectData} variant="outline" className="text-white border-gray-600">
            Retry
          </Button>
        </div>
      </div>
    )
  }

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) =>
      prev.includes(folderId) ? prev.filter((f) => f !== folderId) : [...prev, folderId],
    )
  }

  const closeTab = (fileId: string) => {
    // Send stop editing event
    if (project?._id) {
      stopFileEdit(fileId, project._id)
    }
    
    setOpenTabs((prev) => prev.filter((tab) => tab._id !== fileId))
    if (activeFile?._id === fileId && openTabs.length > 1) {
      const remainingTabs = openTabs.filter((tab) => tab._id !== fileId)
      if (remainingTabs.length > 0) {
        openFile(remainingTabs[0])
      } else {
          setActiveFile(null)
          setActiveFileContent('')
        }
    }
  }

  const renderFileTree = (fileList: FileItem[], level = 0) => {
    if (!Array.isArray(fileList)) return null
    return fileList.map((item: FileItem) => (
      <div key={item._id} style={{ marginLeft: `${level * 16}px` }}>
        {item.type === 'folder' ? (
          <div>
            <div
              className="flex items-center gap-2 px-2 py-1 hover:bg-gray-800 cursor-pointer text-gray-300"
              onClick={() => toggleFolder(item._id)}
            >
              {expandedFolders.includes(item._id) ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <Folder className="h-4 w-4" />
              <span className="text-sm">{item.name}</span>
            </div>
            {expandedFolders.includes(item._id) && item.children && (
              <div>
                {renderFileTree(item.children, level + 1)}
              </div>
            )}
          </div>
        ) : (
          <div
            className={`flex items-center gap-2 px-2 py-1 hover:bg-gray-800 cursor-pointer ${
              activeFile?._id === item._id ? 'bg-gray-800 text-white' : 'text-gray-300'
            }`}
            onClick={() => openFile(item)}
          >
            <File className="h-4 w-4" />
            <span className="text-sm">{item.name}</span>
          </div>
        )}
      </div>
    ))
  }

  const getFileIcon = (fileName?: string, type?: string) => {
    if (type === "folder") return <Folder className="w-4 h-4 text-blue-500" />

    const ext = typeof fileName === 'string' ? fileName.split(".").pop()?.toLowerCase() : undefined
    const iconClass = "w-4 h-4"

    switch (ext) {
      case "js":
      case "jsx":
        return <File className={`${iconClass} text-yellow-500`} />
      case "css":
        return <File className={`${iconClass} text-blue-400`} />
      case "html":
        return <File className={`${iconClass} text-orange-500`} />
      case "json":
        return <File className={`${iconClass} text-green-500`} />
      case "md":
        return <File className={`${iconClass} text-gray-600`} />
      default:
        return <File className={`${iconClass} text-gray-500`} />
    }
  }

  const handleCreateNew = async () => {
    if (!project) return
    const name = prompt('Enter new file name (e.g., index.js). Leave empty to create a folder:')
    if (name === null) return
    try {
      const isFolder = name.trim() === ''
      let created
      if (isFolder) {
        created = await apiClient.createFile({
          name: 'New Folder',
          project: project._id as string,
          type: 'folder' as const,
        })
      } else {
        created = await apiClient.createFile({
          name: name.trim(),
          project: project._id as string,
          type: 'file' as const,
          content: ''
        })
      }
      // Refresh files list
      const updated = await apiClient.getProjectFiles(project._id as string)
      setFiles(updated)
      if (!isFolder) {
        openFile(created)
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create file/folder')
    }
  }

  const handleUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!project) return
    const filesList = e.target.files
    if (!filesList || filesList.length === 0) return
    try {
      const uploads = Array.from(filesList)
      for (const f of uploads) {
        const text = await f.text()
        await apiClient.createFile({
          name: f.name,
          content: text,
          project: project._id as string,
          type: 'file' as const
        })
      }
      const updated = await apiClient.getProjectFiles(project._id as string)
      setFiles(updated)
    } catch (err: any) {
      setError(err.message || 'Upload failed')
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = ''
    }
  }

  const handleUploadClick = () => {
    uploadInputRef.current?.click()
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="flex items-center gap-2">
              <Code className="w-6 h-6 text-purple-600" />
              <span className="font-semibold">CollabCode</span>
            </Link>
            <Separator orientation="vertical" className="h-6" />
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>{project?.name || 'Loading...'}</span>
              <Badge variant="outline" className="text-xs">
                {project?.programmingLanguage || 'Unknown'}
              </Badge>
              <div className="flex items-center gap-1 text-xs text-green-600">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                {saving ? 'Saving...' : 'Saved'}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Connection Status */}
            <div className="flex items-center gap-1 mr-2">
              {isConnecting ? (
                <div className="flex items-center text-yellow-600">
                  <Wifi className="w-4 h-4 mr-1 animate-pulse" />
                  <span className="text-xs">Connecting...</span>
                </div>
              ) : isConnected ? (
                <div className="flex items-center text-green-600">
                  <Wifi className="w-4 h-4 mr-1" />
                  <span className="text-xs">Connected</span>
                </div>
              ) : (
                <div className="flex items-center text-red-600">
                  <WifiOff className="w-4 h-4 mr-1" />
                  <span className="text-xs">Disconnected</span>
                  {connectionError && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-6 w-6 p-0 ml-1"
                      onClick={reconnect}
                    >
                      <RotateCcw className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* Collaborators */}
            <div className="flex items-center gap-1">
              {collaborators.map((user) => (
                <div key={user.id} className="relative group">
                  <Avatar className="w-8 h-8 cursor-pointer">
                    <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${user.name}`} />
                    <AvatarFallback className="text-xs" style={{ backgroundColor: user.color }}>
                      {user.name?.charAt(0) || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white">
                    <div className="w-full h-full rounded-full bg-green-500"></div>
                  </div>
                  <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-black text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    {user.name}
                    {user.cursor && ` (Line ${user.cursor.line})`}
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" className="ml-2 bg-transparent">
                <Users className="w-4 h-4 mr-1" />
                Share
              </Button>
            </div>

            <Separator orientation="vertical" className="h-6" />

            <div className="flex items-center gap-1">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={saveFile}
                disabled={saving || !activeFile}
              >
                <Save className="w-4 h-4 mr-1" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button variant="outline" size="sm" className="bg-green-50 text-green-700 border-green-200" onClick={runCode}>
                <Play className="w-4 h-4 mr-1" />
                Run
              </Button>
              <Button variant="outline" size="sm">
                <GitBranch className="w-4 h-4 mr-1" />
                main
              </Button>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* File Explorer */}
        <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-3 border-b border-gray-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Explorer</h3>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleCreateNew}>
                  <Plus className="w-3 h-3" />
                </Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleUploadClick}>
                  <Upload className="w-3 h-3" />
                </Button>
              </div>
            </div>
            {/* Hidden file input for uploads */}
            <input
              ref={uploadInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleUploadChange}
            />
            <div className="relative">
              <Search className="w-3 h-3 absolute left-2 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <Input placeholder="Search files..." className="pl-7 h-7 text-xs" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">{renderFileTree(files)}</div>
        </div>

        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col">
          {/* File Tabs */}
          <div className="bg-gray-100 border-b border-gray-200 px-2 py-1">
            <div className="flex items-center gap-1 overflow-x-auto">
              {openTabs.map((tab: TabItem) => (
                <div
                  key={tab._id}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-t-md text-sm cursor-pointer min-w-0 ${
                    activeFile?._id === tab._id
                      ? "bg-white text-purple-700 border-t-2 border-purple-500"
                      : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                  }`}
                  onClick={() => openFile(tab)}
                >
                  {getFileIcon(tab.name, "file")}
                  <span className="truncate">{tab.name}</span>
                  {tab.modified && <div className="w-2 h-2 bg-orange-500 rounded-full flex-shrink-0" />}
                  <button
                    className="ml-1 hover:bg-gray-300 rounded p-0.5 flex-shrink-0"
                    onClick={(e) => {
                      e.stopPropagation()
                      closeTab(tab._id)
                    }}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Code Editor */}
          <div className="flex-1 bg-gray-900 text-gray-100 font-mono text-sm overflow-hidden relative">
            {activeFile ? (
              <div className="flex h-full">
                {/* Monaco Editor takes full space */}
                <div className="flex-1 min-w-0">
                  <CodeEditor
                    value={activeFileContent}
                    onChange={handleContentChange}
                    path={activeFile?.name}
                    fileId={activeFile._id}
                    projectId={project?._id}
                  />
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                <div className="text-center">
                  <File className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>Select a file to start editing</p>
                </div>
              </div>
            )}
          </div>

          {/* Terminal */}
          {terminalOpen && (
            <div className="h-48 border-t border-gray-700">
              <TerminalComponent 
                onClose={() => setTerminalOpen(false)}
                projectId={params.id}
              />
            </div>
          )}

          {/* Status Bar */}
          <div className="bg-purple-600 text-white px-4 py-1 text-xs flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span>{project?.programmingLanguage || 'JavaScript'}</span>
              <span>UTF-8</span>
              <span>Ln 32, Col 15</span>
              <span>Spaces: 2</span>
              <button
                className="hover:bg-purple-700 px-2 py-0.5 rounded"
                onClick={() => setTerminalOpen(!terminalOpen)}
              >
                <Terminal className="w-3 h-3 inline mr-1" />
                Terminal
              </button>
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                {isConnecting ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse"></div>
                    Connecting...
                  </>
                ) : isConnected ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-green-400"></div>
                    Live Share Active
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 rounded-full bg-red-400"></div>
                    Disconnected
                  </>
                )}
              </span>
              <span>{collaborators.length} collaborator{collaborators.length !== 1 ? 's' : ''} online</span>
              <span>Auto-save: On</span>
            </div>
          </div>
        </div>

        {/* Right Sidebar */}
        <div className="w-80 bg-white border-l border-gray-200 flex flex-col">
          <UnifiedChat
            chatMessages={chatMessages}
            chatTypingUsers={chatTypingUsers}
            newChatMessage={newChatMessage}
            setNewChatMessage={setNewChatMessage}
            onSendMessage={(message) => {
              if (project?._id) {
                sendChatMessage(project._id, message);
              }
            }}
            onTypingChange={(typing) => {
              if (project?._id) {
                if (typing) {
                  if (!chatTypingTimeoutRef.current) {
                    startChatTyping(project._id);
                  }
                } else {
                  stopChatTyping(project._id);
                }
              }
            }}
            isConnected={isConnected}
            projectId={project?._id}
            terminalOutput={terminalOutput}
          />
        </div>
      </div>
      <SocketDebug />
    </div>
  )
}
