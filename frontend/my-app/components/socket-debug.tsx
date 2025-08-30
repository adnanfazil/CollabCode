"use client"

import { useState } from "react"
import { useSocket } from "@/lib/socket-context"
import { useAuth } from "@/lib/auth-context"

export default function SocketDebug() {
  const { isConnected, collaborators } = useSocket()
  const { user, token } = useAuth()
  const [visible, setVisible] = useState(true)

  if (!visible) return null

  return (
    <div className="fixed top-4 right-4 bg-black text-white p-4 rounded-lg text-xs z-50">
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold">Socket Debug</h3>
        <button 
          onClick={() => setVisible(false)} 
          className="ml-2 text-red-400 hover:text-red-600 font-bold"
        >
          ✕
        </button>
      </div>
      <div>User: {user?.email || 'Not logged in'}</div>
      <div>Token: {token ? `${token.substring(0, 10)}...` : 'No token'}</div>
      <div>Socket Connected: {isConnected ? '✅' : '❌'}</div>
      <div>Collaborators: {collaborators.length}</div>
      <div className="mt-2">
        <button 
          onClick={() => {
            console.log('🧪 Manual socket test:', { 
              hasUser: !!user, 
              hasToken: !!token, 
              isConnected,
              collaborators: collaborators.length 
            })
          }}
          className="bg-blue-500 px-2 py-1 rounded text-xs"
        >
          Log Status
        </button>
      </div>
    </div>
  )
}
