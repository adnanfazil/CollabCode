import React, { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Bot, Users, Send } from 'lucide-react';
import ChatInterface from './chatbot/ChatInterface';

interface ChatMessage {
  id: string;
  message: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  timestamp: string;
}

interface TypingUser {
  id: string;
  name: string;
}

interface UnifiedChatProps {
  // Collaborator chat props
  chatMessages: ChatMessage[];
  chatTypingUsers: TypingUser[];
  newChatMessage: string;
  setNewChatMessage: (message: string) => void;
  onSendMessage: (message: string) => void;
  onTypingChange: (typing: boolean) => void;
  isConnected: boolean;
  
  // AI chat props
  projectId?: string;
  terminalOutput?: string;
}

type ChatMode = 'collaborator' | 'ai';

const UnifiedChat: React.FC<UnifiedChatProps> = ({
  chatMessages,
  chatTypingUsers,
  newChatMessage,
  setNewChatMessage,
  onSendMessage,
  onTypingChange,
  isConnected,
  projectId,
  terminalOutput
}) => {
  const [chatMode, setChatMode] = useState<ChatMode>('collaborator');
  const chatTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [chatMessages]);

  const handleInputChange = (value: string) => {
    setNewChatMessage(value);
    
    // Handle typing indicators for collaborator chat
    if (chatMode === 'collaborator') {
      if (!chatTypingTimeoutRef.current) {
        onTypingChange(true);
      }
      
      if (chatTypingTimeoutRef.current) {
        clearTimeout(chatTypingTimeoutRef.current);
      }
      
      chatTypingTimeoutRef.current = setTimeout(() => {
        onTypingChange(false);
        chatTypingTimeoutRef.current = null;
      }, 2000);
    }
  };

  const handleSendMessage = () => {
    if (newChatMessage.trim()) {
      onSendMessage(newChatMessage.trim());
      setNewChatMessage('');
      
      // Stop typing indicator
      if (chatTypingTimeoutRef.current) {
        clearTimeout(chatTypingTimeoutRef.current);
        chatTypingTimeoutRef.current = null;
        onTypingChange(false);
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Chat Mode Toggle */}
      <div className="flex border-b border-gray-200">
        <button
          className={`flex-1 px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
            chatMode === 'collaborator'
              ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
          onClick={() => setChatMode('collaborator')}
        >
          <Users className="w-4 h-4" />
          Collaborators
          {chatMessages.length > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs">
              {chatMessages.length}
            </Badge>
          )}
        </button>
        <button
          className={`flex-1 px-4 py-2 text-sm font-medium flex items-center justify-center gap-2 transition-colors ${
            chatMode === 'ai'
              ? 'text-purple-600 border-b-2 border-purple-600 bg-purple-50'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
          onClick={() => setChatMode('ai')}
        >
          <Bot className="w-4 h-4" />
          AI Assistant
        </button>
      </div>

      {/* Chat Content */}
      <div className="flex-1 flex flex-col min-h-0">
        {chatMode === 'collaborator' ? (
          // Collaborator Chat
          <>
            <div className="flex-1 p-3 space-y-3 overflow-y-auto min-h-0">
              {chatMessages.map((msg) => (
                <div key={msg.id} className="flex gap-2">
                  <Avatar className="w-6 h-6 flex-shrink-0">
                    <AvatarFallback className="text-xs">
                      {msg.user?.name?.charAt(0)?.toUpperCase() || 'U'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-medium text-gray-900 truncate">
                        {msg.user?.name || 'Unknown User'}
                      </span>
                      <span className="text-xs text-gray-500 flex-shrink-0">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="text-sm text-gray-700">{msg.message}</div>
                  </div>
                </div>
              ))}

              {/* Typing indicator */}
              {chatTypingUsers.length > 0 && (
                <div className="flex gap-2 opacity-60">
                  <Avatar className="w-6 h-6">
                    <AvatarFallback className="text-xs">
                      {chatTypingUsers[0].name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex items-center gap-1 text-sm text-gray-500">
                    <span>
                      {chatTypingUsers.length === 1 
                        ? `${chatTypingUsers[0].name} is typing`
                        : chatTypingUsers.length === 2
                        ? `${chatTypingUsers[0].name} and ${chatTypingUsers[1].name} are typing`
                        : `${chatTypingUsers[0].name} and ${chatTypingUsers.length - 1} others are typing`
                      }
                    </span>
                    <div className="flex gap-1">
                      <div className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"></div>
                      <div
                        className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      ></div>
                      <div
                        className="w-1 h-1 bg-gray-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      ></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="p-3 border-t border-gray-200">
              <div className="flex gap-2">
                <Input
                  placeholder="Type a message..."
                  className="flex-1 text-sm"
                  value={newChatMessage}
                  onChange={(e) => handleInputChange(e.target.value)}
                  onKeyPress={handleKeyPress}
                />
                <Button 
                  size="sm" 
                  className="bg-purple-600 hover:bg-purple-700"
                  onClick={handleSendMessage}
                  disabled={!isConnected || !newChatMessage.trim()}
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </>
        ) : (
          // AI Chat
          <div className="flex-1 flex flex-col min-h-0">
            <ChatInterface
              projectId={projectId}
              terminalOutput={terminalOutput}
              embedded={true}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default UnifiedChat;