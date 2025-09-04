import React, { useState, useRef, useEffect } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Avatar } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { apiClient } from '@/lib/api';
import { Paperclip, AtSign, X as XIcon, Folder as FolderIcon, File as FileIcon, RefreshCcw } from 'lucide-react';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  type?: 'text' | 'error' | 'code' | 'suggestion';
}

interface ChatInterfaceProps {
  projectId?: string;
  terminalOutput?: string;
  onClose?: () => void;
  embedded?: boolean;
}

// Minimal file type for picker
interface PickerFileItem {
  _id: string;
  name: string;
  type: 'file' | 'folder';
  children?: PickerFileItem[];
}

const ChatInterface: React.FC<ChatInterfaceProps> = ({ 
  projectId, 
  terminalOutput, 
  onClose,
  embedded = false
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Attachments state
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<PickerFileItem[]>([]);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    // Initialize chat session
    initializeSession();
  }, [projectId]);

  const initializeSession = async () => {
    try {
      const response = await fetch('/api/chatbot/session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({ 
          projectId,
          context: {
            terminalOutput,
            timestamp: new Date().toISOString()
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        setSessionId(data.data.sessionId);
        
        // Add welcome message
        const welcomeMessage: Message = {
          id: 'welcome',
          content: 'Hi! I\'m your AI assistant. I can help you resolve errors, debug issues, and provide coding guidance. You can attach project files using the @ button for more context.',
          sender: 'ai',
          timestamp: new Date(),
          type: 'text'
        };
        setMessages([welcomeMessage]);
      }
    } catch (error) {
      console.error('Failed to initialize chat session:', error);
    }
  };

  const openPicker = async () => {
    if (!projectId) return;
    setIsPickerOpen(true);
    setFilesError(null);
    setFilesLoading(true);
    try {
      const files = await apiClient.getProjectFiles(projectId) as any[];
      // Ensure array
      const normalized: PickerFileItem[] = Array.isArray(files) ? files : [];
      setProjectFiles(normalized);
    } catch (e: any) {
      setFilesError(e?.message || 'Failed to load files');
    } finally {
      setFilesLoading(false);
    }
  };

  const toggleSelectFile = (fileId: string) => {
    setSelectedFileIds(prev => prev.includes(fileId) ? prev.filter(id => id !== fileId) : [...prev, fileId]);
  };

  const clearAllSelections = () => setSelectedFileIds([]);

  const sendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputValue,
      sender: 'user',
      timestamp: new Date(),
      type: 'text'
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chatbot/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: JSON.stringify({
          query: userMessage.content,
          sessionId,
          projectId,
          attachments: selectedFileIds,
          context: {
            terminalOutput,
            timestamp: new Date().toISOString()
          }
        })
      });

      if (response.ok) {
        const data = await response.json();
        
        const aiMessage: Message = {
          id: Date.now().toString() + '_ai',
          content: data.data.response,
          sender: 'ai',
          timestamp: new Date(),
          type: data.data.responseType || 'text'
        };

        setMessages(prev => [...prev, aiMessage]);
      } else {
        throw new Error('Failed to get AI response');
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      const errorMessage: Message = {
        id: Date.now().toString() + '_error',
        content: 'Sorry, I encountered an error. Please try again.',
        sender: 'ai',
        timestamp: new Date(),
        type: 'error'
      };

      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    } else if (e.key === '@') {
      // Open picker on @ typing
      if (projectId) {
        openPicker();
      }
    }
  };

  const formatMessage = (message: Message) => {
    if (message.type === 'code') {
      return (
        <pre className="bg-gray-100 p-3 rounded-md overflow-x-auto text-sm">
          <code>{message.content}</code>
        </pre>
      );
    }
    
    return (
      <div className="whitespace-pre-wrap">
        {message.content}
      </div>
    );
  };

  const renderFileTree = (items: PickerFileItem[], depth = 0) => {
    return (
      <div className="space-y-1">
        {items.map(item => (
          <div key={item._id} className="flex items-center" style={{ paddingLeft: depth * 12 }}>
            {item.type === 'folder' ? (
              <FolderIcon className="w-4 h-4 text-gray-500 mr-2" />
            ) : (
              <FileIcon className="w-4 h-4 text-gray-500 mr-2" />
            )}
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              {item.type === 'file' ? (
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={selectedFileIds.includes(item._id)}
                  onChange={() => toggleSelectFile(item._id)}
                />
              ) : (
                <span className="inline-block w-4" />
              )}
              <span className="truncate max-w-[220px]" title={item.name}>{item.name}</span>
            </label>
          </div>
        ))}
        {items.map(item => (
          item.children && item.children.length > 0 ? (
            <div key={item._id + '_children'}>
              {renderFileTree(item.children, depth + 1)}
            </div>
          ) : null
        ))}
      </div>
    );
  };

  const content = (
    <>
      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] p-3 rounded-lg ${
                message.sender === 'user'
                  ? 'bg-blue-500 text-white'
                  : message.type === 'error'
                  ? 'bg-red-50 border border-red-200'
                  : 'bg-gray-100'
              }`}
            >
              {message.type && message.sender === 'ai' && (
                <Badge 
                  variant={message.type === 'error' ? 'destructive' : 'secondary'}
                  className="mb-2"
                >
                  {message.type}
                </Badge>
              )}
              {formatMessage(message)}
              <div className="text-xs opacity-70 mt-1">
                {message.timestamp.toLocaleTimeString()}
              </div>
            </div>
          </div>
        ))}
        
        {isLoading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 p-3 rounded-lg">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-gray-200">
        {/* Selected attachments chips */}
        {selectedFileIds.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {selectedFileIds.map(fid => {
              const f = (function find(items: PickerFileItem[]): PickerFileItem | undefined {
                for (const it of items) {
                  if (it._id === fid) return it;
                  if (it.children) {
                    const found = find(it.children);
                    if (found) return found;
                  }
                }
                return undefined;
              })(projectFiles);
              return (
                <span key={fid} className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 text-xs rounded-full border border-purple-200">
                  <FileIcon className="w-3 h-3" />
                  <span className="max-w-[160px] truncate" title={f?.name || fid}>{f?.name || fid}</span>
                  <button className="ml-1 hover:text-purple-900" onClick={() => toggleSelectFile(fid)}>
                    <XIcon className="w-3 h-3" />
                  </button>
                </span>
              );
            })}
            {selectedFileIds.length > 1 && (
              <button className="text-xs text-purple-700 hover:underline" onClick={clearAllSelections}>clear all</button>
            )}
          </div>
        )}
        <div className="flex items-center space-x-2">
          <Button 
            type="button"
            variant="outline"
            size="sm"
            className="text-gray-700"
            onClick={() => projectId ? openPicker() : null}
            disabled={!projectId}
            title={projectId ? 'Attach files (@)' : 'Open a project to attach files'}
          >
            <AtSign className="w-4 h-4 mr-1" /> Attach
          </Button>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask me about errors, debugging, or coding help... Use @ to attach files"
            disabled={isLoading}
            className="flex-1 text-sm"
          />
          <Button 
            onClick={sendMessage} 
            disabled={!inputValue.trim() || isLoading}
            size="sm"
            className="bg-purple-600 hover:bg-purple-700"
          >
            Send
          </Button>
        </div>
      </div>

      {/* Attachment Picker Modal */}
      {isPickerOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b">
              <div className="font-semibold">Attach files from project</div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => projectId && openPicker()} title="Refresh">
                  <RefreshCcw className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setIsPickerOpen(false)}>✕</Button>
              </div>
            </div>
            <div className="p-3 flex-1 overflow-auto">
              {!projectId && (
                <div className="text-sm text-gray-600">Open a project to attach files.</div>
              )}
              {filesLoading && (
                <div className="text-sm text-gray-600">Loading files...</div>
              )}
              {filesError && (
                <div className="text-sm text-red-600">{filesError}</div>
              )}
              {!filesLoading && !filesError && projectFiles.length === 0 && (
                <div className="text-sm text-gray-600">No files found in this project.</div>
              )}
              {!filesLoading && !filesError && projectFiles.length > 0 && (
                <div>
                  {renderFileTree(projectFiles)}
                </div>
              )}
            </div>
            <div className="p-3 border-t flex items-center justify-between">
              <div className="text-xs text-gray-500">Selected: {selectedFileIds.length}</div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={clearAllSelections} disabled={selectedFileIds.length === 0}>Clear</Button>
                <Button size="sm" className="bg-purple-600 hover:bg-purple-700" onClick={() => setIsPickerOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <div className="flex flex-col h-full">
        {content}
      </div>
    );
  }

  return (
    <Card className="flex flex-col h-96 w-full max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center space-x-2">
          <Avatar className="w-8 h-8">
            <div className="w-full h-full bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold">
              AI
            </div>
          </Avatar>
          <div>
            <h3 className="font-semibold">AI Assistant</h3>
            <p className="text-sm text-gray-500">Error Resolution & Code Help</p>
          </div>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            ×
          </Button>
        )}
      </div>
      {content}
    </Card>
  );
};

export default ChatInterface;