"use client"

import { useEffect, useRef, useState } from "react"
import { Terminal as XTerm } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { useSocket } from "@/lib/socket-context"
import { useAuth } from "@/lib/auth-context"
import { Button } from "@/components/ui/button"
import { ExternalLink, Square, Play } from "lucide-react"
import "@xterm/xterm/css/xterm.css"

export type TerminalProps = {
  projectId?: string
  className?: string
  height?: string
  onClose?: () => void
}

export default function Terminal({ projectId, className = "", height = "300px", onClose }: TerminalProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [sessionReady, setSessionReady] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [containerId, setContainerId] = useState<string | null>(null)
  const { socket } = useSocket()
  const { user } = useAuth()
  // Keep a ref in sync with sessionReady to avoid stale closure inside onData
  const sessionReadyRef = useRef(false)
  
  useEffect(() => {
    sessionReadyRef.current = sessionReady
  }, [sessionReady])

  useEffect(() => {
    if (!terminalRef.current) return

    // Create terminal instance
    const terminal = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        selection: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5'
      },
      allowTransparency: true,
      convertEol: true,
      scrollback: 1000
    })

    // Create and load addons
    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    
    terminal.loadAddon(fitAddon)
    terminal.loadAddon(webLinksAddon)
    
    // Open terminal in DOM
    terminal.open(terminalRef.current)
    // Ensure terminal receives keyboard focus
    setTimeout(() => terminal.focus(), 0)

    // Store references
    xtermRef.current = terminal
    fitAddonRef.current = fitAddon
    
    // Fit terminal to container
    fitAddon.fit()
    
    // Welcome message
    terminal.writeln('\x1b[32mCollabCode Terminal (Container Runtime)\x1b[0m')
    terminal.writeln('Initializing container session...\r\n')
    
    // Handle terminal input
    let currentLine = ''
    terminal.onData((data) => {
      // Allow typing/echo even if session isn't ready; only send on Enter when ready
      if (!socket || !projectId) return
      
      // Handle different key inputs
      if (data === '\r') { // Enter key
        terminal.write('\r\n')
        if (currentLine.trim()) {
          if (sessionReadyRef.current) {
            // Send command to container only when session is ready
            socket.emit('terminal-command', {
              command: currentLine.trim()
            })
          }
        }
        currentLine = ''
      } else if (data === '\u007f') { // Backspace
        if (currentLine.length > 0) {
          currentLine = currentLine.slice(0, -1)
          terminal.write('\b \b')
        }
      } else if (data === '\u0003') { // Ctrl+C
        terminal.write('^C\r\n')
        if (sessionReadyRef.current) {
          socket.emit('terminal-interrupt')
        }
        currentLine = ''
      } else {
        // Regular character input
        currentLine += data
        terminal.write(data)
      }
    })
    
    // Create terminal session when component mounts
    if (socket && projectId) {
      socket.emit('terminal-create', { projectId })
    }
    
    // Cleanup function
    return () => {
      terminal.dispose()
    }
  }, [projectId, socket, user])

  // Handle socket events for terminal output and container management
  useEffect(() => {
    if (!socket || !xtermRef.current) return

    const handleTerminalOutput = (data: { output: string; type: 'stdout' | 'stderr' }) => {
      if (xtermRef.current) {
        if (data.type === 'stderr') {
          xtermRef.current.write(`\x1b[31m${data.output}\x1b[0m`) // Red for errors
        } else {
          xtermRef.current.write(data.output)
        }
      }
    }

    const handleTerminalReady = (data: { containerId: string; port: number }) => {
      if (xtermRef.current) {
        xtermRef.current.write(`\x1b[32m✅ Container session ready (${data.containerId.slice(0, 12)})\x1b[0m\r\n`)
        xtermRef.current.write('$ ')
        setSessionReady(true)
        setContainerId(data.containerId)
      }
    }

    const handleTerminalPreview = (data: { projectId: string; port: number; previewUrl: string; containerId: string }) => {
      if (xtermRef.current) {
        xtermRef.current.write(`\x1b[36m🌐 HTTP server detected on port ${data.port}\x1b[0m\r\n`)
        xtermRef.current.write(`\x1b[36m📡 Preview available at: ${data.previewUrl}\x1b[0m\r\n`)
        setPreviewUrl(data.previewUrl)
      }
    }

    const handleTerminalError = (data: { error: string }) => {
      if (xtermRef.current) {
        xtermRef.current.write(`\x1b[31mError: ${data.error}\x1b[0m\r\n`)
        if (sessionReady) {
          xtermRef.current.write('$ ')
        }
      }
    }

    const handleTerminalStopped = () => {
      if (xtermRef.current) {
        xtermRef.current.write(`\x1b[33m🛑 Terminal session stopped\x1b[0m\r\n`)
        setSessionReady(false)
        setPreviewUrl(null)
        setContainerId(null)
      }
    }

    socket.on('terminal-output', handleTerminalOutput)
    socket.on('terminal-ready', handleTerminalReady)
    socket.on('terminal-preview', handleTerminalPreview)
    socket.on('terminal-error', handleTerminalError)
    socket.on('terminal-stopped', handleTerminalStopped)

    setIsConnected(true)

    return () => {
      socket.off('terminal-output', handleTerminalOutput)
      socket.off('terminal-ready', handleTerminalReady)
      socket.off('terminal-preview', handleTerminalPreview)
      socket.off('terminal-error', handleTerminalError)
      socket.off('terminal-stopped', handleTerminalStopped)
      setIsConnected(false)
    }
  }, [socket, sessionReady])

  // Handle window resize
  useEffect(() => {
    const handleResize = () => {
      if (fitAddonRef.current) {
        fitAddonRef.current.fit()
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Handle terminal stop
  const handleStopTerminal = () => {
    if (socket && sessionReady) {
      socket.emit('terminal-stop')
    }
  }

  // Handle preview open
  const handleOpenPreview = () => {
    if (previewUrl) {
      window.open(previewUrl, '_blank')
    }
  }

  return (
    <div className={`terminal-container ${className}`} style={{ height }}>
      <div className="terminal-header bg-gray-800 text-white px-3 py-2 text-sm flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500"></div>
          <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
          <div className="w-3 h-3 rounded-full bg-green-500"></div>
          <span className="ml-2">Terminal</span>
          {containerId && (
            <span className="text-xs text-gray-400 ml-2">
              ({containerId.slice(0, 8)})
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {previewUrl && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs bg-blue-600 hover:bg-blue-700 border-blue-500"
              onClick={handleOpenPreview}
            >
              <ExternalLink className="w-3 h-3 mr-1" />
              Open Preview
            </Button>
          )}
          {sessionReady && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-xs bg-red-600 hover:bg-red-700 border-red-500"
              onClick={handleStopTerminal}
            >
              <Square className="w-3 h-3 mr-1" />
              Stop
            </Button>
          )}
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${
              sessionReady ? 'bg-green-400' : isConnected ? 'bg-yellow-400' : 'bg-red-400'
            }`}></div>
            <span className="text-xs">
              {sessionReady ? 'Ready' : isConnected ? 'Connecting' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>
      <div 
        ref={terminalRef} 
        className="terminal-content" 
        // Make container focusable and focus xterm on click to ensure keystrokes are captured
        tabIndex={0}
        onClick={() => xtermRef.current?.focus()}
        style={{ 
          height: 'calc(100% - 40px)',
          backgroundColor: '#1e1e1e'
        }}
      />
    </div>
  )
}