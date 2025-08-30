"use client"

import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuth } from './auth-context'

interface User {
  id: string
  name: string
  email: string
}

interface CollaborationUser extends User {
  cursor?: {
    line: number
    column: number
  }
  selection?: {
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
  }
  color?: string
}

interface ChatMessage {
  id: string
  message: string
  user: User
  timestamp: string | Date
}

interface CodeChange {
  fileId: string
  changes: any[]
  version: number
  user: User
}

interface SocketContextType {
  socket: Socket | null
  isConnected: boolean
  isConnecting: boolean
  connectionError: string | null
  collaborators: CollaborationUser[]
  chatMessages: ChatMessage[]
  chatTypingUsers: User[]
  codeTypingUsers: User[]
  joinProject: (projectId: string) => void
  leaveProject: (projectId: string) => void
  sendChatMessage: (projectId: string, message: string) => void
  sendCodeChange: (fileId: string, projectId: string, changes: any[], version: number) => void
  sendCursorPosition: (fileId: string, projectId: string, position: { line: number; column: number }) => void
  sendFileSelect: (fileId: string, projectId: string) => void
  startFileEdit: (fileId: string, projectId: string) => void
  stopFileEdit: (fileId: string, projectId: string) => void
  startChatTyping: (projectId: string) => void
  stopChatTyping: (projectId: string) => void
  startCodeTyping: (projectId: string, fileId: string) => void
  stopCodeTyping: (projectId: string, fileId: string) => void
  onCodeChange: (callback: (data: CodeChange) => void) => void
  onCursorUpdate: (callback: (data: any) => void) => void
  onUserJoined: (callback: (data: any) => void) => void
  onUserLeft: (callback: (data: any) => void) => void
  onFileEditStarted: (callback: (data: any) => void) => void
  onFileEditStopped: (callback: (data: any) => void) => void
  onFileSelected: (callback: (data: any) => void) => void
  onUserChatTyping: (callback: (data: any) => void) => void
  onUserStoppedChatTyping: (callback: (data: any) => void) => void
  onUserCodeTyping: (callback: (data: any) => void) => void
  onUserStoppedCodeTyping: (callback: (data: any) => void) => void
  reconnect: () => void
}

const SocketContext = createContext<SocketContextType | null>(null)

const USER_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
  '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9'
]

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [collaborators, setCollaborators] = useState<CollaborationUser[]>([])
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatTypingUsers, setChatTypingUsers] = useState<User[]>([])
  const [codeTypingUsers, setCodeTypingUsers] = useState<User[]>([])
  const { user, token } = useAuth()
  const colorIndexRef = useRef(0)
  const socketRef = useRef<Socket | null>(null)
  const reconnectAttempts = useRef(0)
  const maxReconnectAttempts = 5

  const connectSocket = useCallback(() => {
    if (!user || !token) {
      console.log('🔌 Socket connection skipped: missing user or token', { hasUser: !!user, hasToken: !!token })
      return
    }

    console.log('🔌 Attempting to connect socket...', { user: user.email, socketUrl: process.env.NEXT_PUBLIC_SOCKET_URL })

    // Close existing socket if present
    if (socketRef.current) {
      console.log('🔌 Closing existing socket')
      socketRef.current.close()
    }

    setIsConnecting(true)
    setConnectionError(null)

    // Initialize socket connection
    const newSocket = io(process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:5000', {
      auth: {
        token: token
      },
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 20000
    })

    socketRef.current = newSocket
    setSocket(newSocket)

    // Connection event handlers
    newSocket.on('connect', () => {
      console.log('🔌 Socket connected successfully!')
      setIsConnected(true)
      setIsConnecting(false)
      setConnectionError(null)
      reconnectAttempts.current = 0

      // Test WebSocket connection by emitting a ping
      newSocket.emit('ping', { timestamp: Date.now() })
    })

    newSocket.on('disconnect', (reason) => {
      setIsConnected(false)
      setIsConnecting(false)
      
      // If it's a manual disconnect, don't try to reconnect
      if (reason === 'io client disconnect') {
        setCollaborators([])
        return
      }
      
      // Try to reconnect automatically
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++
        setTimeout(() => {
          if (socketRef.current) {
            socketRef.current.connect()
          }
        }, 1000 * reconnectAttempts.current) // Exponential backoff
      } else {
        setConnectionError('Failed to reconnect after multiple attempts. Please refresh the page.')
      }
    })

    newSocket.on('connect_error', (error) => {
      console.log('🔌 Socket connection error:', error)
      setIsConnecting(false)
      setConnectionError('Failed to connect to the collaboration server.')
      
      // Try to reconnect automatically
      if (reconnectAttempts.current < maxReconnectAttempts) {
        reconnectAttempts.current++
        console.log(`🔌 Retrying connection (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`)
        setTimeout(() => {
          if (socketRef.current) {
            socketRef.current.connect()
          }
        }, 1000 * reconnectAttempts.current) // Exponential backoff
      } else {
        console.log('🔌 Max reconnection attempts reached')
      }
    })

    newSocket.on('error', (error) => {
      // Handle general socket errors
    })

    newSocket.on('pong', (data) => {
      // Pong received - WebSocket connection is working
    })

    // Project collaboration events
    newSocket.on('project-joined', (data) => {
      const usersWithColors = (data.users || []).map((user: any, index: number) => ({
        ...user,
        color: USER_COLORS[index % USER_COLORS.length]
      }))
      setCollaborators(usersWithColors)
    })

    newSocket.on('user-joined', (data) => {
      setCollaborators(prev => {
        // Check if user already exists
        const exists = prev.find(u => u.id === data.user.id)
        if (exists) return prev
        
        const newUser = {
          ...data.user,
          color: USER_COLORS[colorIndexRef.current % USER_COLORS.length]
        }
        colorIndexRef.current = (colorIndexRef.current + 1) % USER_COLORS.length
        return [...prev, newUser]
      })
    })

    newSocket.on('user-left', (data) => {
      setCollaborators(prev => prev.filter(u => u.id !== data.user.id))
    })

    // Chat events
    newSocket.on('chat-message', (data) => {
      // Add timestamp if not present
      const messageWithTimestamp = {
        ...data,
        timestamp: data.timestamp || new Date().toISOString()
      }
      setChatMessages(prev => [...prev, messageWithTimestamp])
    })

    // Code collaboration events
    newSocket.on('code-changed', (data) => {
      // This will be handled by individual components
    })

    newSocket.on('cursor-updated', (data) => {
      setCollaborators(prev => prev.map(user => 
        user.id === data.user.id 
          ? { ...user, cursor: data.position }
          : user
      ))
    })

    newSocket.on('file-edit-started', (data) => {
      // File edit started
    })

    newSocket.on('file-edit-stopped', (data) => {
      // File edit stopped
    })

    newSocket.on('file-selected', (data) => {
      // File selected
    })

    newSocket.on('file-created', (data) => {
      // This will be handled by individual components
    })

    newSocket.on('file-deleted', (data) => {
      // This will be handled by individual components
    })

    // Chat typing indicator events
    newSocket.on('user-chat-typing', (data) => {
      setChatTypingUsers(prev => {
        // Check if user already exists
        const exists = prev.find(u => u.id === data.user.id)
        if (exists) return prev
        return [...prev, data.user]
      })
    })

    newSocket.on('user-stopped-chat-typing', (data) => {
      setChatTypingUsers(prev => prev.filter(u => u.id !== data.user.id))
    })

    // Code typing indicator events
    newSocket.on('user-code-typing', (data) => {
      setCodeTypingUsers(prev => {
        // Check if user already exists
        const exists = prev.find(u => u.id === data.user.id)
        if (exists) return prev
        return [...prev, { ...data.user, fileId: data.fileId }]
      })
    })

    newSocket.on('user-stopped-code-typing', (data) => {
      setCodeTypingUsers(prev => prev.filter(u => u.id !== data.user.id))
    })
  }, [user, token])

  // Initialize socket connection
  useEffect(() => {
    connectSocket()

    return () => {
      if (socketRef.current) {
        socketRef.current.close()
      }
    }
  }, [connectSocket])

  const joinProject = useCallback((projectId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('join-project', { projectId })
    }
  }, [])

  const leaveProject = useCallback((projectId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('leave-project', { projectId })
    }
  }, [])

  const sendChatMessage = useCallback((projectId: string, message: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('chat-message', { projectId, message })
    }
  }, [])

  const sendCodeChange = useCallback((fileId: string, projectId: string, changes: any[], version: number) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('code-change', { fileId, projectId, changes, version })
    }
  }, [])

  const sendCursorPosition = useCallback((fileId: string, projectId: string, position: { line: number; column: number }) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('cursor-position', { fileId, projectId, position })
    }
  }, [])

  const sendFileSelect = useCallback((fileId: string, projectId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('file-select', { fileId, projectId })
    }
  }, [])

  const startFileEdit = useCallback((fileId: string, projectId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('file-edit-start', { fileId, projectId })
    }
  }, [])

  const stopFileEdit = useCallback((fileId: string, projectId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('file-edit-stop', { fileId, projectId })
    }
  }, [])

  const startChatTyping = useCallback((projectId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('chat-typing-start', { projectId })
    }
  }, [])

  const stopChatTyping = useCallback((projectId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('chat-typing-stop', { projectId })
    }
  }, [])

  const startCodeTyping = useCallback((projectId: string, fileId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('code-typing-start', { projectId, fileId })
    }
  }, [])

  const stopCodeTyping = useCallback((projectId: string, fileId: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('code-typing-stop', { projectId, fileId })
    }
  }, [])

  const onCodeChange = useCallback((callback: (data: CodeChange) => void) => {
    if (socketRef.current) {
      socketRef.current.on('code-changed', callback)
      return () => socketRef.current?.off('code-changed', callback)
    }
  }, [])

  const onCursorUpdate = useCallback((callback: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on('cursor-updated', callback)
      return () => socketRef.current?.off('cursor-updated', callback)
    }
  }, [])

  const onUserJoined = useCallback((callback: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on('user-joined', callback)
      return () => socketRef.current?.off('user-joined', callback)
    }
  }, [])

  const onUserLeft = useCallback((callback: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on('user-left', callback)
      return () => socketRef.current?.off('user-left', callback)
    }
  }, [])

  const onFileEditStarted = useCallback((callback: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on('file-edit-started', callback)
      return () => socketRef.current?.off('file-edit-started', callback)
    }
  }, [])

  const onFileEditStopped = useCallback((callback: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on('file-edit-stopped', callback)
      return () => socketRef.current?.off('file-edit-stopped', callback)
    }
  }, [])

  const onFileSelected = useCallback((callback: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on('file-selected', callback)
      return () => socketRef.current?.off('file-selected', callback)
    }
  }, [])

  const onUserChatTyping = useCallback((callback: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on('user-chat-typing', callback)
      return () => socketRef.current?.off('user-chat-typing', callback)
    }
  }, [])

  const onUserStoppedChatTyping = useCallback((callback: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on('user-stopped-chat-typing', callback)
      return () => socketRef.current?.off('user-stopped-chat-typing', callback)
    }
  }, [])

  const onUserCodeTyping = useCallback((callback: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on('user-code-typing', callback)
      return () => socketRef.current?.off('user-code-typing', callback)
    }
  }, [])

  const onUserStoppedCodeTyping = useCallback((callback: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on('user-stopped-code-typing', callback)
      return () => socketRef.current?.off('user-stopped-code-typing', callback)
    }
  }, [])

  const reconnect = useCallback(() => {
    reconnectAttempts.current = 0
    connectSocket()
  }, [connectSocket])

  const value: SocketContextType = {
    socket,
    isConnected,
    isConnecting,
    connectionError,
    collaborators,
    chatMessages,
    chatTypingUsers,
    codeTypingUsers,
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
    startCodeTyping,
    stopCodeTyping,
    onCodeChange,
    onCursorUpdate,
    onUserJoined,
    onUserLeft,
    onFileEditStarted,
    onFileEditStopped,
    onFileSelected,
    onUserChatTyping,
    onUserStoppedChatTyping,
    onUserCodeTyping,
    onUserStoppedCodeTyping,
    reconnect
  }

  return (
    <SocketContext.Provider value={value}>
      {children}
    </SocketContext.Provider>
  )
}

export function useSocket() {
  const context = useContext(SocketContext)
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider')
  }
  return context
}