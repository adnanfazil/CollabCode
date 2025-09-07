import React, { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card } from '../ui/card';
import { Avatar } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { apiClient } from '@/lib/api';
import { Paperclip, AtSign, X as XIcon, Folder as FolderIcon, File as FileIcon, RefreshCcw } from 'lucide-react';

// Lazy load Monaco DiffEditor for previewing edits
const DiffEditor = dynamic(() => import('@monaco-editor/react').then(m => m.DiffEditor), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-600">Loading diff preview...</div>
});

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  type?: 'text' | 'error' | 'code' | 'suggestion';
  aiEdits?: AiEditsPayload | null;
  // Optional parsed code blocks for convenience
  codeBlocks?: { language?: string; content: string }[];
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

// AI edits schema
type AiEditOperation =
  | { type: 'full_file_replace'; newContent: string }
  | { type: 'replace_range'; range: { start: Position; end: Position }; newText: string }
  | { type: 'insert_at'; position: Position; text: string }
  | { type: 'delete_range'; range: { start: Position; end: Position } };

interface Position { line: number; column: number }

interface AiEditsFileChange {
  fileId?: string;        // Preferred if known
  fileName?: string;      // Fallback match by name (best-effort)
  operations: AiEditOperation[];
}

interface AiEditsPayload {
  ai_edits: AiEditsFileChange[];
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

  // Review & Apply Edits modal state
  const [isEditsOpen, setIsEditsOpen] = useState(false);
  const [editsMessageId, setEditsMessageId] = useState<string | null>(null);
  const [editsPayload, setEditsPayload] = useState<AiEditsPayload | null>(null);
  const [activePreviewFile, setActivePreviewFile] = useState<string | null>(null); // resolved fileId or name key
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [originalContent, setOriginalContent] = useState<string>('');
  const [updatedContent, setUpdatedContent] = useState<string>('');
  const [applyStatus, setApplyStatus] = useState<string | null>(null);

  // Apply-from-code-block modal state
  const [isApplyFromCodeOpen, setIsApplyFromCodeOpen] = useState(false);
  const [applyFromCodeContent, setApplyFromCodeContent] = useState<string>('');
  const [applyFromCodeLanguage, setApplyFromCodeLanguage] = useState<string | undefined>(undefined);
  const [targetFileId, setTargetFileId] = useState<string | null>(null);
  const [applyPreviewOriginal, setApplyPreviewOriginal] = useState<string>('');
  const [applyPreviewLoading, setApplyPreviewLoading] = useState(false);
  const [applyPreviewError, setApplyPreviewError] = useState<string | null>(null);

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

  // Build instruction asking AI to include structured edits JSON when attachments exist
  const augmentQueryForEdits = (base: string) => {
    if (!selectedFileIds.length) return base;
    const instruction = `\n\nIf you propose specific code changes to any of the attached files, include at the very end a JSON code fence with ONLY this object (no extra commentary). Allowed operation types: full_file_replace, replace_range, insert_at, delete_range.\n\n\`\`\`json\n{\n  "ai_edits": [\n    {\n      "fileId": "<attached file id if known>",\n      "fileName": "<filename as shown>",\n      "operations": [\n        { "type": "full_file_replace", "newContent": "..." }\n      ]\n    }\n  ]\n}\n\`\`\`\n\nReturn your normal explanation first, then the JSON fence.`;
    return base + instruction;
  };

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
          query: augmentQueryForEdits(userMessage.content),
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
        const rawText: string = data.data.response;
        const parsedEdits = parseAiEditsFromText(rawText);
        const parsedBlocks = extractCodeBlocks(data.data.formattedResponse || rawText);
        
        const aiMessage: Message = {
          id: Date.now().toString() + '_ai',
          content: data.data.formattedResponse || rawText,
          sender: 'ai',
          timestamp: new Date(),
          type: parsedEdits ? 'suggestion' : (data.data.responseType || 'text'),
          aiEdits: parsedEdits,
          codeBlocks: parsedBlocks
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
          <div key={item._id}>
            <div className="flex items-center" style={{ paddingLeft: depth * 12 }}>
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
            {item.children && item.children.length > 0 && (
              <div>
                {renderFileTree(item.children, depth + 1)}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  // Extract code blocks from text (looks for ```language ... ``` blocks)
  function extractCodeBlocks(text: string): { language?: string; content: string }[] {
    const blocks: { language?: string; content: string }[] = [];
    const fenceRegex = /```(\w+)?\n([\s\S]*?)```/gi;
    let match;
    while ((match = fenceRegex.exec(text))) {
      const language = match[1] || undefined;
      const content = match[2].trim();
      if (content) {
        blocks.push({ language, content });
      }
    }
    return blocks;
  }

  // Parse ai_edits JSON from AI text (looks for a ```json ...``` block with ai_edits)
  function parseAiEditsFromText(text: string): AiEditsPayload | null {
    try {
      // Prefer fenced json blocks
      const fenceRegex = /```json([\s\S]*?)```/gi;
      let match;
      let lastJsonWithEdits: AiEditsPayload | null = null;
      while ((match = fenceRegex.exec(text))) {
        const block = match[1].trim();
        const obj = JSON.parse(block);
        if (obj && obj.ai_edits && Array.isArray(obj.ai_edits)) {
          lastJsonWithEdits = obj as AiEditsPayload;
        }
      }
      if (lastJsonWithEdits) return lastJsonWithEdits;

      // Fallback: try to find a raw JSON object in text
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const obj = JSON.parse(jsonMatch[0]);
        if (obj && obj.ai_edits && Array.isArray(obj.ai_edits)) {
          return obj as AiEditsPayload;
        }
      }
    } catch (e) {
      // ignore parse errors
    }
    return null;
  }

  // Helpers to apply operations
  function posToIndex(src: string, pos: Position): number {
    const lines = src.split('\n');
    const lineIdx = Math.max(0, Math.min(pos.line - 1, lines.length - 1));
    const colIdx = Math.max(0, pos.column - 1);
    let idx = 0;
    for (let i = 0; i < lineIdx; i++) idx += lines[i].length + 1; // +1 for \n
    return Math.min(idx + colIdx, src.length);
  }

  function applyOperationsToContent(src: string, operations: AiEditOperation[]): string {
    let content = src;
    // Apply range-based edits from end to start to preserve indices
    const ops = [...operations];
    // First handle full file replace if present (takes precedence)
    const fullReplace = ops.find(o => o.type === 'full_file_replace') as any;
    if (fullReplace) {
      return fullReplace.newContent;
    }

    // Otherwise, apply granular edits; convert to index ranges
    type IndexedOp = { start?: number; end?: number; text?: string; kind: 'replace' | 'insert' | 'delete' };
    const indexed: IndexedOp[] = [];
    for (const op of ops) {
      if (op.type === 'replace_range') {
        indexed.push({ kind: 'replace', start: posToIndex(content, op.range.start), end: posToIndex(content, op.range.end), text: op.newText });
      } else if (op.type === 'insert_at') {
        indexed.push({ kind: 'insert', start: posToIndex(content, op.position), text: op.text });
      } else if (op.type === 'delete_range') {
        indexed.push({ kind: 'delete', start: posToIndex(content, op.range.start), end: posToIndex(content, op.range.end) });
      }
    }
    // Sort so that edits with larger start come first to avoid shifting
    indexed.sort((a, b) => (b.start ?? 0) - (a.start ?? 0));

    for (const op of indexed) {
      if (op.kind === 'replace' && op.start !== undefined && op.end !== undefined && op.text !== undefined) {
        content = content.slice(0, op.start) + op.text + content.slice(op.end);
      } else if (op.kind === 'insert' && op.start !== undefined && op.text !== undefined) {
        content = content.slice(0, op.start) + op.text + content.slice(op.start);
      } else if (op.kind === 'delete' && op.start !== undefined && op.end !== undefined) {
        content = content.slice(0, op.start) + content.slice(op.end);
      }
    }

    return content;
  }

  // Validate likely Mongo ObjectId (24 hex chars)
  function isLikelyObjectId(id?: string | null): boolean {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
  }

  // Resolve fileId by matching provided name against loaded projectFiles (best-effort)
  function resolveFileId(fileChange: AiEditsFileChange): string | null {
    if (isLikelyObjectId(fileChange.fileId)) return fileChange.fileId!;
    if (!fileChange.fileName) return null;
    // DFS search name match
    const stack: PickerFileItem[] = [...projectFiles];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.type === 'file' && node.name === fileChange.fileName) return node._id;
      if (node.children) stack.push(...node.children);
    }
    return null;
  }

  // Open apply-from-code modal
  function openApplyFromCode(block: { language?: string; content: string }) {
    setApplyFromCodeContent(block.content);
    setApplyFromCodeLanguage(block.language);
    setIsApplyFromCodeOpen(true);
  }

  // Ensure files are available when opening the apply-from-code modal
  useEffect(() => {
    (async () => {
      if (!isApplyFromCodeOpen) return;
      if (projectFiles.length === 0 && projectId) {
        try {
          const files = await apiClient.getProjectFiles(projectId) as any[];
          const normalized: PickerFileItem[] = Array.isArray(files) ? files : [];
          setProjectFiles(normalized);
        } catch (e) {
          console.error('Failed to load project files for apply-from-code:', e);
        }
      }
    })();
  }, [isApplyFromCodeOpen, projectId]);

  // Load original content for diff when a target file is selected
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isApplyFromCodeOpen || !targetFileId) {
        setApplyPreviewOriginal('');
        setApplyPreviewError(null);
        setApplyPreviewLoading(false);
        return;
      }
      try {
        setApplyPreviewError(null);
        setApplyPreviewLoading(true);
        const resp = await apiClient.getFileContent(targetFileId);
        const orig = typeof resp?.data?.content === 'string' ? resp.data.content : (resp?.content || '');
        if (!cancelled) setApplyPreviewOriginal(orig);
      } catch (e: any) {
        if (!cancelled) setApplyPreviewError(e?.message || 'Failed to load original file content');
      } finally {
        if (!cancelled) setApplyPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [isApplyFromCodeOpen, targetFileId]);

  async function loadPreviewForChange(change: AiEditsFileChange) {
    setPreviewError(null);
    setPreviewLoading(true);
    setOriginalContent('');
    setUpdatedContent('');
    try {
      const resolvedId = resolveFileId(change) || change.fileId || change.fileName || '';
      setActivePreviewFile(resolvedId);
      const fileId = resolveFileId(change);
      if (!fileId) {
        // If we cannot resolve an ID, we can only show the proposed new content if it's a full replace
        const full = change.operations.find(op => op.type === 'full_file_replace') as any;
        if (full) {
          setOriginalContent('// Unknown original file content');
          setUpdatedContent(full.newContent);
        } else {
          throw new Error('Cannot preview changes: file not resolvable without fileId and no full_file_replace provided');
        }
      } else {
        const fileContentResp = await apiClient.getFileContent(fileId);
        const orig = typeof fileContentResp?.data?.content === 'string' ? fileContentResp.data.content : (fileContentResp?.content || '');
        const updated = applyOperationsToContent(orig, change.operations);
        setOriginalContent(orig);
        setUpdatedContent(updated);
      }
    } catch (e: any) {
      setPreviewError(e?.message || 'Failed to load preview');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function applyAllChanges() {
    if (!editsPayload) return;
    setApplyStatus(null);
    try {
      // Ensure we have files list loaded to resolve names (without opening picker UI)
      if (projectId && projectFiles.length === 0) {
        try {
          const files = await apiClient.getProjectFiles(projectId as string) as any[];
          const normalized = Array.isArray(files) ? files : [];
          setProjectFiles(normalized);
        } catch {}
      }

      for (const change of editsPayload.ai_edits) {
        const fileId = resolveFileId(change);
        if (!fileId) {
          throw new Error(`Cannot apply changes for ${change.fileName || 'unknown file'}: missing fileId`);
        }
        // Fetch latest content to avoid drift
        const fileContentResp = await apiClient.getFileContent(fileId);
        const orig = typeof fileContentResp?.data?.content === 'string' ? fileContentResp.data.content : (fileContentResp?.content || '');
        const updated = applyOperationsToContent(orig, change.operations);
        await apiClient.updateFile(fileId, { content: updated });
      }
      setApplyStatus('Changes applied successfully.');
    } catch (e: any) {
      setApplyStatus(`Failed to apply changes: ${e?.message || 'Unknown error'}`);
    }
  }

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
              {message.sender === 'ai' && message.aiEdits && (
                <div className="mt-2">
                  <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => {
                    setEditsMessageId(message.id);
                    setEditsPayload(message.aiEdits || null);
                    setIsEditsOpen(true);
                    const first = message.aiEdits?.ai_edits?.[0];
                    if (first) loadPreviewForChange(first);
                  }}>
                    Review & Apply Edits
                  </Button>
                </div>
              )}
              {/* Fallback: if message contains code blocks, allow applying from code */}
              {extractCodeBlocks(message.content).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {extractCodeBlocks(message.content).map((block, idx) => (
                    <Button key={idx} size="sm" variant="outline" onClick={() => openApplyFromCode(block)}>
                      Review & Apply Full Code
                    </Button>
                  ))}
                </div>
              )}
              {message.sender === 'ai' && message.aiEdits && (
                <div className="mt-2">
                  <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => {
                    setEditsMessageId(message.id);
                    setEditsPayload(message.aiEdits || null);
                    setIsEditsOpen(true);
                    // Preload first change preview if any
                    const first = message.aiEdits?.ai_edits?.[0];
                    if (first) loadPreviewForChange(first);
                  }}>
                    Review & Apply Edits
                  </Button>
                </div>
              )}
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

      {/* Review & Apply Edits Modal */}
      {isEditsOpen && editsPayload && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b">
              <div className="font-semibold">Review AI-proposed edits</div>
              <div className="flex items-center gap-2">
                {applyStatus && <span className="text-xs text-gray-600">{applyStatus}</span>}
                <Button variant="ghost" size="sm" onClick={() => { setIsEditsOpen(false); setApplyStatus(null); }}>✕</Button>
              </div>
            </div>
            <div className="flex-1 flex min-h-0">
              {/* Left: files list */}
              <div className="w-64 border-r p-3 overflow-auto">
                <div className="text-xs text-gray-500 mb-2">Files with changes</div>
                <div className="space-y-1">
                  {editsPayload.ai_edits.map((change, idx) => {
                    const resolvedId = resolveFileId(change);
                    const label = change.fileName || (function findName(items: PickerFileItem[], id?: string): string | null {
                      for (const it of items) {
                        if (id && it._id === id) return it.name;
                        if (it.children) {
                          const found = findName(it.children, id);
                          if (found) return found;
                        }
                      }
                      return null;
                    })(projectFiles, resolvedId || change.fileId || undefined) || change.fileId || `Change ${idx+1}`;

                    const key = resolvedId || change.fileId || change.fileName || `change_${idx}`;
                    return (
                      <button
                        key={key}
                        className={`w-full text-left px-2 py-1 rounded hover:bg-gray-100 ${activePreviewFile === key ? 'bg-gray-100' : ''}`}
                        onClick={() => loadPreviewForChange(change)}
                      >
                        <div className="flex items-center gap-2 text-sm">
                          <FileIcon className="w-4 h-4 text-gray-500" />
                          <span className="truncate" title={label}>{label}</span>
                        </div>
                        <div className="text-[10px] text-gray-500 mt-0.5">{change.operations.length} operation(s)</div>
                      </button>
                    );
                  })}
                </div>
                <div className="mt-3">
                  <Button size="sm" className="w-full bg-green-600 hover:bg-green-700" onClick={applyAllChanges}>Apply All Changes</Button>
                </div>
              </div>

              {/* Right: preview */}
              <div className="flex-1 p-3 overflow-auto min-h-0">
                {previewLoading && <div className="text-sm text-gray-600">Preparing preview...</div>}
                {previewError && <div className="text-sm text-red-600">{previewError}</div>}
                {!previewLoading && !previewError && (
                  originalContent || updatedContent ? (
                    <div className="h-[60vh]">
                      {/* @ts-ignore - DiffEditor is loaded dynamically */}
                      <DiffEditor
                        original={originalContent}
                        modified={updatedContent}
                        options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false } }}
                        language={guessLanguageFromName(activePreviewFile || '')}
                      />
                    </div>
                  ) : (
                    <div className="text-sm text-gray-600">Select a file to preview changes.</div>
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Apply From Code Block Modal */}
      {isApplyFromCodeOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-3 border-b">
              <div className="font-semibold">Review & Apply Full Code</div>
              <Button variant="ghost" size="sm" onClick={() => setIsApplyFromCodeOpen(false)}>✕</Button>
            </div>
            <div className="p-4 flex-1 overflow-auto">
              <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Select target file:</label>
                <select 
                  className="w-full p-2 border rounded"
                  value={targetFileId || ''}
                  onChange={(e) => setTargetFileId(e.target.value || null)}
                >
                  <option value="">Choose a file...</option>
                  {(function flattenFiles(items: PickerFileItem[]): PickerFileItem[] {
                    const result: PickerFileItem[] = [];
                    for (const item of items) {
                      if (item.type === 'file') result.push(item);
                      if (item.children) result.push(...flattenFiles(item.children));
                    }
                    return result;
                  })(projectFiles).map(file => (
                    <option key={file._id} value={file._id}>{file.name}</option>
                  ))}
                </select>
              </div>

              {/* Preview: if no file chosen, show raw code; else show diff */}
              {!targetFileId ? (
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Code to apply:</label>
                  <pre className="bg-gray-100 p-3 rounded border text-sm overflow-auto max-h-60">
                    <code>{applyFromCodeContent}</code>
                  </pre>
                </div>
              ) : (
                <div className="mb-4">
                  <label className="block text-sm font-medium mb-2">Preview changes:</label>
                  <div className="h-[60vh] border rounded overflow-hidden">
                    {applyPreviewLoading ? (
                      <div className="w-full h-full flex items-center justify-center text-sm text-gray-600">Loading current file content…</div>
                    ) : applyPreviewError ? (
                      <div className="p-3 text-sm text-red-600">{applyPreviewError}</div>
                    ) : (
                      // @ts-ignore - DiffEditor is loaded dynamically
                      <DiffEditor
                        original={applyPreviewOriginal}
                        modified={applyFromCodeContent}
                        options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false } }}
                        language={(function() {
                          const sel = (function find(items: PickerFileItem[]): PickerFileItem | undefined {
                            for (const it of items) {
                              if (it._id === targetFileId) return it;
                              if (it.children) {
                                const found = find(it.children);
                                if (found) return found;
                              }
                            }
                            return undefined;
                          })(projectFiles);
                          return guessLanguageFromName(sel?.name || '') || applyFromCodeLanguage || undefined;
                        })()}
                      />
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button 
                  disabled={!targetFileId}
                  onClick={async () => {
                    try {
                      if (!targetFileId) return;
                      await apiClient.updateFile(targetFileId, { content: applyFromCodeContent });
                      setIsApplyFromCodeOpen(false);
                      setTargetFileId(null);
                      setApplyFromCodeContent('');
                      setApplyPreviewOriginal('');
                    } catch (error) {
                      console.error('Error applying code:', error);
                    }
                  }}
                  className="bg-green-600 hover:bg-green-700"
                >
                  Apply to File
                </Button>
                <Button variant="outline" onClick={() => setIsApplyFromCodeOpen(false)}>
                  Cancel
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

function guessLanguageFromName(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.md')) return 'markdown';
  return undefined;
}

export default ChatInterface;