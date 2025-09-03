"use client"

import { useCallback, useRef, useState, useEffect } from 'react'
import { useAuth } from './auth-context'
import { io, Socket } from 'socket.io-client'

export interface CompletionRequest {
  code: string
  language: string
  cursorPosition: {
    line: number
    column: number
  }
  maxTokens?: number
  temperature?: number
  context?: any
}

export interface CompletionToken {
  type: 'connected' | 'token' | 'completed' | 'error'
  token?: string
  completionText?: string
  tokenCount?: number
  message?: string
  timestamp: number
}

export interface StreamingCompletionHook {
  requestCompletion: (request: CompletionRequest) => Promise<void>
  cancelCompletion: () => void
  isLoading: boolean
  currentCompletion: string
  error: string | null
  tokenCount: number
  onToken?: (token: CompletionToken) => void
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || ''
const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:5000'

export function useStreamingCompletions(): StreamingCompletionHook {
  const { user, token } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [currentCompletion, setCurrentCompletion] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [tokenCount, setTokenCount] = useState(0)
  
  // Refs for managing connections
  const socketRef = useRef<Socket | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const onTokenRef = useRef<((token: CompletionToken) => void) | undefined>()

  // Cleanup function
  const cleanup = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsLoading(false)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])

  const handleToken = useCallback((tokenData: CompletionToken) => {
    if (onTokenRef.current) {
      onTokenRef.current(tokenData)
    }

    switch (tokenData.type) {
      case 'token':
        if (tokenData.token) {
          setCurrentCompletion(prev => prev + tokenData.token)
          setTokenCount(prev => prev + 1)
        }
        break
      case 'completed':
        setIsLoading(false)
        if (tokenData.completionText) {
          setCurrentCompletion(tokenData.completionText)
        }
        if (tokenData.tokenCount) {
          setTokenCount(tokenData.tokenCount)
        }
        break
      case 'error':
        setError(tokenData.message || 'Unknown error occurred')
        setIsLoading(false)
        break
      case 'connected':
        setError(null)
        break
    }
  }, [])

  const requestCompletionViaWebSocket = useCallback(async (request: CompletionRequest) => {
    if (!user || !token) {
      throw new Error('Authentication required')
    }

    return new Promise<void>((resolve, reject) => {
      let connectionTimer: ReturnType<typeof setTimeout> | null = null
      let finished = false
      let everConnected = false
      const clearTimer = () => {
        if (connectionTimer) {
          clearTimeout(connectionTimer)
          connectionTimer = null
        }
      }

      try {
        // Create Socket.io connection to completions namespace
        const socket = io(`${WS_BASE_URL}/completions`, {
          auth: {
            token
          },
          transports: ['websocket', 'polling'],
          timeout: 10000,
          forceNew: true
        })
        socketRef.current = socket

        const finalizeSuccess = () => {
          if (finished) return
          finished = true
          clearTimer()
          setIsLoading(false)
          try { socket.disconnect() } catch {}
          resolve()
        }

        const finalizeError = (errMsg: string) => {
          if (finished) return
          finished = true
          clearTimer()
          setError(errMsg)
          setIsLoading(false)
          try { socket.disconnect() } catch {}
          reject(new Error(errMsg))
        }

        socket.on('connect', () => {
          everConnected = true
          clearTimer()
          console.log('🔌 Socket.io connected for completions')
          
          // Send completion request
          socket.emit('request-completion', {
            prompt: request.code,
            language: request.language,
            filename: '', // Could be derived from context
            projectId: '', // Could be passed in request
            cursorPosition: request.cursorPosition,
            maxTokens: request.maxTokens,
            temperature: request.temperature
          })

          // Debug the request (avoid logging full code to keep console readable)
          console.log('📤 WS request payload:', {
            language: request.language,
            codeLen: request.code?.length || 0,
            cursor: request.cursorPosition,
            maxTokens: request.maxTokens,
            temperature: request.temperature
          })
        })

        socket.on('completion-token', (data) => {
          // Enhanced logging to see what exactly we get from backend
          const tokenLen = data?.token?.length || 0
          const completionLen = data?.completionText?.length || 0
          const preview = (data?.completionText || '').slice(Math.max(0, completionLen - 120))
          console.log('📝 Received completion token packet:', {
            tokenShown: data?.token === '' ? '<empty string>' : data?.token,
            tokenLen,
            completionLen,
            done: data?.done,
            count: data?.tokenCount,
            previewTail120: preview
          })
          handleToken({
            type: 'token',
            token: data.token,
            completionText: data.completionText,
            tokenCount: data.tokenCount,
            timestamp: data.timestamp || Date.now()
          })
          
          // If completion is done, resolve the promise and cleanup
          if (data.done) {
            console.log('✅ Completion finished via token done flag')
            handleToken({
              type: 'completed',
              completionText: data.completionText,
              tokenCount: data.tokenCount,
              timestamp: Date.now()
            })
            finalizeSuccess()
          }
        })

        socket.on('completion-complete', (data) => {
          console.log('✅ Completion finished:', {
            finalLen: data?.completionText?.length || 0,
            tokenCount: data?.tokenCount,
            previewTail200: (data?.completionText || '').slice(Math.max(0, (data?.completionText?.length || 0) - 200))
          })
          handleToken({
            type: 'completed',
            completionText: data.completionText,
            tokenCount: data.tokenCount,
            timestamp: data.timestamp || Date.now()
          })
          finalizeSuccess()
        })

        socket.on('completion-error', (data) => {
          console.error('❌ Completion error:', data)
          finalizeError(data.error || data.message || 'Completion failed')
        })

        socket.on('connect_error', (error) => {
          console.error('❌ Socket.io connection error:', error)
          finalizeError('Failed to connect to completion service')
        })

        socket.on('disconnect', (reason) => {
          console.log('🔌 Socket.io disconnected:', reason)
          if (reason !== 'io client disconnect' && !finished) {
            finalizeError('Connection to completion service lost')
          }
        })

        // Set a timeout for initial connection only
        connectionTimer = setTimeout(() => {
          if (!everConnected && socket && !socket.connected && !finished) {
            console.error('❌ Socket.io connection timeout')
            finalizeError('Connection timeout')
          }
        }, 10000)

      } catch (error) {
        console.error('❌ Error creating Socket.io connection:', error)
        setError('Failed to create completion connection')
        setIsLoading(false)
        reject(error)
      }
    })
  }, [user, token, handleToken])

  const requestCompletionViaSSE = useCallback(async (request: CompletionRequest) => {
    if (!user || !token) {
      throw new Error('Authentication required')
    }

    return new Promise<void>((resolve, reject) => {
      try {
        // Create abort controller for cancellation
        const abortController = new AbortController()
        abortControllerRef.current = abortController

        // Make POST request to start SSE stream
        fetch(`${API_BASE_URL}/api/completions/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Accept': 'text/event-stream',
            'Cache-Control': 'no-cache'
          },
          body: JSON.stringify(request),
          signal: abortController.signal
        }).then(response => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }

          if (!response.body) {
            throw new Error('No response body for SSE stream')
          }

          const reader = response.body.getReader()
          const decoder = new TextDecoder()

          const readStream = async () => {
            try {
              while (true) {
                const { done, value } = await reader.read()
                
                if (done) {
                  console.log('📡 SSE stream completed')
                  resolve()
                  break
                }

                const chunk = decoder.decode(value, { stream: true })
                const lines = chunk.split('\n')

                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    try {
                      const data = JSON.parse(line.slice(6))

                      // Verbose SSE packet logging
                      const tokenLen = data?.token?.length || 0
                      const completionLen = data?.completionText?.length || 0
                      const preview = (data?.completionText || '').slice(Math.max(0, completionLen - 120))
                      console.log('🛰️ SSE received packet:', {
                        type: data?.type,
                        tokenShown: data?.token === '' ? '<empty string>' : data?.token,
                        tokenLen,
                        completionLen,
                        done: data?.done,
                        count: data?.tokenCount,
                        previewTail120: preview
                      })
                      
                      handleToken({
                        type: data.type,
                        token: data.token,
                        completionText: data.completionText,
                        tokenCount: data.tokenCount,
                        message: data.message,
                        timestamp: data.timestamp || Date.now()
                      })

                      if (data.type === 'completed') {
                        console.log('🛰️ SSE stream reports completed. Final length:', completionLen)
                        resolve()
                        return
                      }

                      if (data.type === 'error') {
                        console.error('❌ SSE reported error packet:', data)
                        reject(new Error(data.message))
                        return
                      }
                    } catch (parseError) {
                      console.error('❌ Error parsing SSE data:', parseError)
                    }
                  }
                }
              }
            } catch (streamError) {
              if (abortController.signal.aborted) {
                console.log('📡 SSE stream aborted')
                resolve()
              } else {
                console.error('❌ SSE stream error:', streamError)
                reject(streamError)
              }
            }
          }

          readStream()
        }).catch(fetchError => {
          if (abortController.signal.aborted) {
            console.log('📡 SSE request aborted')
            resolve()
          } else {
            console.error('❌ SSE fetch error:', fetchError)
            setError('Failed to start completion stream')
            setIsLoading(false)
            reject(fetchError)
          }
        })
      } catch (error) {
        console.error('❌ Error setting up SSE:', error)
        setError('Failed to setup completion stream')
        setIsLoading(false)
        reject(error)
      }
    })
  }, [user, token, handleToken])

  const requestCompletion = useCallback(async (request: CompletionRequest) => {
    // Cancel any existing requests first
    cleanup()

    // Reset state
    setCurrentCompletion('')
    setError(null)
    setTokenCount(0)

    // Mark loading true for the new request
    setIsLoading(true)

    try {
      // Try Socket.io first, fallback to SSE
      const useWebSocket = process.env.NEXT_PUBLIC_USE_WEBSOCKET !== 'false'
      
      if (useWebSocket) {
        console.log('🔌 Attempting Socket.io completion...')
        try {
          await requestCompletionViaWebSocket(request)
        } catch (wsError) {
          console.warn('⚠️ Socket.io failed, falling back to SSE:', wsError)
          await requestCompletionViaSSE(request)
        }
      } else {
        console.log('📡 Using SSE completion...')
        await requestCompletionViaSSE(request)
      }
    } catch (error) {
      console.error('❌ Completion request failed:', error)
      setError(error instanceof Error ? error.message : 'Unknown error occurred')
      setIsLoading(false)
    }
  }, [cleanup, requestCompletionViaWebSocket, requestCompletionViaSSE])

  const cancelCompletion = useCallback(() => {
    console.log('🛑 Cancelling completion request')
    
    // Send cancel signal to Socket.io if connected
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('cancel-completion')
      try { socketRef.current.disconnect() } catch {}
    }
    
    cleanup()
    setCurrentCompletion('')
    setError(null)
    setTokenCount(0)
    setIsLoading(false)
  }, [cleanup])

  // Set onToken callback
  const setOnToken = useCallback((callback: ((token: CompletionToken) => void) | undefined) => {
    onTokenRef.current = callback
  }, [])

  return {
    requestCompletion,
    cancelCompletion,
    isLoading,
    currentCompletion,
    error,
    tokenCount,
    onToken: setOnToken
  }
}