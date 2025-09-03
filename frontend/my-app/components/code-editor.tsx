"use client"

import dynamic from "next/dynamic"
import { useEffect, useRef, useState, useCallback } from "react"
import { useSocket } from "@/lib/socket-context"
import { useAuth } from "@/lib/auth-context"
import { useStreamingCompletions, type CompletionRequest } from "@/lib/use-streaming-completions"
import type { editor, languages } from "monaco-editor"

const Monaco = dynamic(() => import("@monaco-editor/react"), { ssr: false })

export type CodeEditorProps = {
  value: string
  onChange: (value: string) => void
  language?: string
  path?: string // filename for model path and language inference
  readOnly?: boolean
  fileId?: string
  projectId?: string
}

function detectLanguageFromFilename(fileName?: string): string | undefined {
  if (!fileName) return undefined
  const ext = fileName.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "js":
    case "mjs":
    case "cjs":
      return "javascript"
    case "ts":
      return "typescript"
    case "jsx":
      return "javascript"
    case "tsx":
      return "typescript"
    case "json":
      return "json"
    case "css":
      return "css"
    case "scss":
      return "scss"
    case "html":
      return "html"
    case "md":
    case "markdown":
      return "markdown"
    case "yml":
    case "yaml":
      return "yaml"
    case "xml":
      return "xml"
    case "py":
      return "python"
    case "java":
      return "java"
    case "go":
      return "go"
    case "rb":
      return "ruby"
    case "php":
      return "php"
    case "sh":
    case "bash":
      return "shell"
    case "sql":
      return "sql"
    case "c":
      return "c"
    case "cpp":
    case "cc":
    case "cxx":
      return "cpp"
    case "cs":
      return "csharp"
    case "dockerfile":
    case "docker":
      return "dockerfile"
    default:
      return undefined
  }
}

// Helper function to calculate diff between two strings
function calculateDiff(oldStr: string, newStr: string): { start: number; deleted: number; inserted: string }[] {
  // Simple implementation - in a real app, you might want to use a more sophisticated diff algorithm
  if (oldStr === newStr) return []
  
  // Find the first difference
  let start = 0
  while (start < oldStr.length && start < newStr.length && oldStr[start] === newStr[start]) {
    start++
  }
  
  // Find the last difference
  let endOld = oldStr.length
  let endNew = newStr.length
  while (endOld > start && endNew > start && oldStr[endOld - 1] === newStr[endNew - 1]) {
    endOld--
    endNew--
  }
  
  return [{
    start,
    deleted: endOld - start,
    inserted: newStr.substring(start, endNew)
  }]
}

export default function CodeEditor({ value, onChange, language, path, readOnly, fileId, projectId }: CodeEditorProps) {
  const resolvedLanguage = language ?? detectLanguageFromFilename(path)
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const isReceivingChange = useRef(false)
  const isApplyingCompletion = useRef(false)
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null)
  const { sendCodeChange, sendCursorPosition, onCodeChange, onCursorUpdate, collaborators, startCodeTyping, stopCodeTyping, codeTypingUsers } = useSocket()
  const { user } = useAuth()
  const { requestCompletion, cancelCompletion, isLoading: isCompletionLoading, currentCompletion, error: completionError } = useStreamingCompletions()
  const decorationsRef = useRef<string[]>([])
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastSentValueRef = useRef<string>(value)
  const completionTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastCompletionRequestRef = useRef<string>('')
  const inlineCompletionProviderRef = useRef<any>(null)
  const currentCompletionRef = useRef<string>('')

  // Keep a ref in sync to avoid stale closures inside Monaco providers/commands
  useEffect(() => {
    currentCompletionRef.current = currentCompletion
  }, [currentCompletion])

  // Add multi-line ghost preview support via Monaco view zones
  const ghostZoneIdRef = useRef<string | null>(null)
  const ghostZoneDomRef = useRef<HTMLDivElement | null>(null)

  const clearGhostPreview = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return
    const zoneId = ghostZoneIdRef.current
    if (!zoneId) return
    try {
      editor.changeViewZones((accessor) => {
        accessor.removeZone(zoneId)
      })
    } catch {}
    ghostZoneIdRef.current = null
    ghostZoneDomRef.current = null
  }, [])

  const renderGhostPreview = useCallback(() => {
    const editor = editorRef.current
    if (!editor) return

    const latest = (currentCompletionRef.current || '')
    const lines = latest.split('\n')

    // Only render extra lines beyond the first line; the first line is handled by inlineSuggest ghost text
    if (lines.length <= 1) {
      clearGhostPreview()
      return
    }

    const extra = lines.slice(1).join('\n')
    const afterLineNumber = editor.getPosition()?.lineNumber || 1
    const heightInLines = Math.max(1, lines.length - 1)

    editor.changeViewZones((accessor) => {
      // Remove existing zone if present
      if (ghostZoneIdRef.current) {
        try { accessor.removeZone(ghostZoneIdRef.current) } catch {}
        ghostZoneIdRef.current = null
      }

      // Create DOM node for the preview
      const dom = document.createElement('div')
      dom.className = 'ghost-multiline-preview'
      dom.style.pointerEvents = 'none'
      dom.style.whiteSpace = 'pre'
      dom.textContent = extra

      const id = accessor.addZone({
        afterLineNumber,
        heightInLines,
        domNode: dom
      } as any)

      ghostZoneIdRef.current = id
      ghostZoneDomRef.current = dom
    })
  }, [clearGhostPreview])

  // Force Monaco to refresh inline completions when currentCompletion changes
  useEffect(() => {
    if (editorRef.current && currentCompletion) {
      console.log('🔄 Triggering Monaco inline completion refresh for:', currentCompletion.slice(0, 50))
      const monaco = (window as any).monaco
      if (monaco && monaco.editor) {
        // Trigger inline completions manually
        const editor = editorRef.current
        const position = editor.getPosition()
        if (position) {
          // Force Monaco to re-evaluate inline completions
          editor.trigger('ai-completion', 'editor.action.inlineSuggest.trigger', {})
        }
      }
    }
  }, [currentCompletion])

  // Keep the multi-line ghost preview in sync with streaming tokens
  useEffect(() => {
    renderGhostPreview()
  }, [currentCompletion, renderGhostPreview])

  // Handle incoming code changes from other users
  useEffect(() => {
    if (!fileId || !projectId) {
      return
    }
    
    const unsubscribe = onCodeChange?.((data) => {
      console.log('🔄 CodeEditor: Received code change:', {
        fromUser: data.user?.email,
        currentUser: user?.email,
        fromUserId: data.user?.id,
        currentUserId: user?.id,
        fileId: data.fileId,
        currentFileId: fileId
      })

      // Skip if this is an echo of our own change
      if (data.user?.id === user?.id || data.user?.email === user?.email) {
        console.log('🚫 CodeEditor: Skipping own change')
        return
      }

      if (data.fileId === fileId && editorRef.current) {
        console.log('📝 CodeEditor: Applying remote change from', data.user?.email)

        // Set flag to prevent local change handling during remote update
        isReceivingChange.current = true

        try {
          const editor = editorRef.current
          const model = editor.getModel()

          if (model && data.changes && data.changes.length > 0 && data.changes[0].text !== undefined) {
            const newContent = data.changes[0].text as string
            const currentValue = model.getValue()

            if (currentValue !== newContent) {
              // Save current cursor position
              const position = editor.getPosition()
              console.log('💾 CodeEditor: Saving cursor position:', position)

              // Apply the change
              model.setValue(newContent)

              // Restore cursor position
              if (position) {
                setTimeout(() => {
                  editor.setPosition(position)
                  console.log('📍 CodeEditor: Restored cursor position:', position)
                }, 10)
              }
            }
          }
        } catch (error) {
          console.error('CodeEditor: Error applying remote changes:', error)
        } finally {
          // Reset flag after a longer delay to ensure all change events are processed
          setTimeout(() => {
            isReceivingChange.current = false
            console.log('🔓 CodeEditor: Remote change processing complete')
          }, 200)
        }
      }
    })

    return unsubscribe
  }, [fileId, projectId, onCodeChange, onChange, user?.id])

  // Handle cursor position updates from other users
  useEffect(() => {
    if (!fileId || !projectId || !editorRef.current) return

    const unsubscribe = onCursorUpdate?.((data) => {
      if (data.fileId === fileId && editorRef.current) {
        updateCollaboratorCursors()
      }
    })

    return unsubscribe
  }, [fileId, projectId, onCursorUpdate])

  // Cleanup timeouts and providers on unmount
  useEffect(() => {
    return () => {
      if (typingTimeout) {
        clearTimeout(typingTimeout)
        if (projectId && fileId) {
          stopCodeTyping?.(projectId, fileId)
        }
      }
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current)
      }
      if (completionTimeoutRef.current) {
        clearTimeout(completionTimeoutRef.current)
      }
      if (inlineCompletionProviderRef.current) {
        inlineCompletionProviderRef.current.dispose()
      }
      // Remove any ghost preview and cancel ongoing completion
      clearGhostPreview()
      // Cancel any ongoing completion requests
      cancelCompletion()
    }
  }, [typingTimeout, projectId, stopCodeTyping, cancelCompletion])

  const updateCollaboratorCursors = () => {
    if (!editorRef.current) return

    // Clear existing decorations
    decorationsRef.current = editorRef.current.deltaDecorations(decorationsRef.current, [])

    // Add cursor decorations for each collaborator
    const newDecorations = collaborators
      .filter(collaborator => collaborator.cursor && collaborator.id !== user?.id) // Filter out current user
      .map(collaborator => {
        const isTyping = codeTypingUsers?.some(typingUser => 
          typingUser.id === collaborator.id && typingUser.fileId === fileId
        )
        
        return {
          range: new (window as any).monaco.Range(
            collaborator.cursor!.line,
            collaborator.cursor!.column,
            collaborator.cursor!.line,
            collaborator.cursor!.column + 1
          ),
          options: {
            className: `collaborator-cursor ${isTyping ? 'typing' : ''}`,
            beforeContentClassName: 'collaborator-cursor-before',
            afterContentClassName: 'collaborator-cursor-after',
            stickiness: 1,
            hoverMessage: { 
              value: `${collaborator.name}'s cursor${isTyping ? ' (typing...)' : ''}` 
            }
          }
        }
      })

    decorationsRef.current = editorRef.current.deltaDecorations([], newDecorations)
  }

  // Debounced completion request function
  const requestCompletionDebounced = useCallback(async (editor: editor.IStandaloneCodeEditor, force: boolean = false) => {
    console.log('🎯 requestCompletionDebounced called', { fileId, projectId, readOnly, force })
    
    if (!editor || !fileId || !projectId || readOnly) {
      console.log('❌ Early return from completion request:', { editor: !!editor, fileId, projectId, readOnly })
      return
    }

    const model = editor.getModel()
    if (!model) {
      console.log('❌ No model available')
      return
    }

    const position = editor.getPosition()
    if (!position) {
      console.log('❌ No position available')
      return
    }

    const code = model.getValue()
    const currentLine = model.getLineContent(position.lineNumber)
    const textBeforeCursor = currentLine.substring(0, position.column - 1)
    
    console.log('📝 Completion context:', {
      codeLength: code.length,
      currentLine,
      textBeforeCursor,
      position: { line: position.lineNumber, column: position.column },
      language: resolvedLanguage
    })
    
    // Determine context flags
    const emptyText = !textBeforeCursor.trim()
    const atBeginning = position.column <= 1
    const inString = /["'`]/.test(textBeforeCursor.slice(-1))
    const inComment = /\/\//.test(textBeforeCursor) || /\/\*/.test(textBeforeCursor)

    // Skip only for non-forced requests
    if (!force && (emptyText || atBeginning || inString || inComment)) {
      console.log('🚫 Skipping completion request:', { emptyText, atBeginning, inString, inComment })
      return
    }

    if (force) {
      console.log('🔁 Forcing completion despite context:', { emptyText, atBeginning, inString, inComment })
    }

    const requestKey = `${code.length}-${position.lineNumber}-${position.column}`
    if (!force && requestKey === lastCompletionRequestRef.current) {
      console.log('🔄 Duplicate request, skipping:', requestKey)
      return
    }
    lastCompletionRequestRef.current = requestKey

    try {
      const completionRequest: CompletionRequest = {
        code,
        language: resolvedLanguage || 'javascript',
        cursorPosition: {
          line: position.lineNumber,
          column: position.column // Keep 1-based column to match backend expectations
        },
        maxTokens: 100,
        temperature: 0.3,
        context: {
          fileId,
          projectId,
          fileName: path
        }
      }

      console.log('🚀 Sending completion request:', completionRequest)
      // Reset any existing completion/preview before starting a new one
      try { cancelCompletion() } catch {}
      clearGhostPreview()
      await requestCompletion(completionRequest)
      console.log('✅ Completion request sent successfully')
    } catch (error) {
      console.error('❌ Error requesting completion:', error)
    }
  }, [fileId, projectId, readOnly, resolvedLanguage, path, requestCompletion])

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor) => {
    editorRef.current = editor

    // Register inline completions provider
    const monaco = (window as any).monaco
    if (monaco && monaco.languages) {
      // Dispose existing provider if any
      if (inlineCompletionProviderRef.current) {
        inlineCompletionProviderRef.current.dispose()
      }

      // Register new inline completions provider
      inlineCompletionProviderRef.current = monaco.languages.registerInlineCompletionsProvider(
        resolvedLanguage || 'javascript',
        {
          provideInlineCompletions: async (
            model: any,
            position: any,
            context: any,
            token: any
          ) => {
            const latest = currentCompletionRef.current || ''
            console.log('🎯 Monaco requesting inline completions:', {
              hasCompletion: !!latest.trim(),
              completionLength: latest.length,
              completionPreview: latest.slice(0, 50),
              readOnly,
              position: { line: position.lineNumber, column: position.column }
            })

            // Don't provide completions if we're in read-only mode or no current completion
            if (readOnly || !latest.trim()) {
              return { items: [] }
            }

            // Get current cursor position
            const currentPosition = editor.getPosition()
            if (!currentPosition || 
                currentPosition.lineNumber !== position.lineNumber ||
                currentPosition.column !== position.column) {
              return { items: [] }
            }

            // Create completion item
            const completionItem = {
              insertText: latest,
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              ),
              command: {
                id: 'ai-completion-accepted',
                title: 'AI Completion Accepted'
              },
              completeBracketPairs: true
            }

            console.log('✨ Providing inline completion item:', {
              insertText: completionItem.insertText.slice(0, 50),
              range: completionItem.range
            })

            return {
              items: [completionItem],
              enableForwardStability: true
            }
          },
          freeInlineCompletions: () => {
            // Cleanup when completions are no longer needed
          }
        }
      )
    }

    // Track cursor position changes
    editor.onDidChangeCursorPosition((e) => {
      if (fileId && projectId && !isReceivingChange.current) {
        sendCursorPosition?.(fileId, projectId, {
          line: e.position.lineNumber,
          column: e.position.column
        })

        // Request completion after cursor movement (debounced)
        if (completionTimeoutRef.current) {
          clearTimeout(completionTimeoutRef.current)
        }
        completionTimeoutRef.current = setTimeout(() => {
          requestCompletionDebounced(editor)
        }, 500) // 500ms delay for completion requests
      }
    })

    // Add keyboard shortcuts for completion acceptance
    editor.addCommand(
      (window as any).monaco.KeyMod.CtrlCmd | (window as any).monaco.KeyCode.RightArrow,
      () => {
        // Accept current completion with Ctrl/Cmd + Right Arrow
        const latest = currentCompletionRef.current || ''
        if (latest.trim()) {
          const position = editor.getPosition()
          if (position) {
            isApplyingCompletion.current = true
            editor.executeEdits('ai-completion', [{
              range: new (window as any).monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              ),
              text: latest
            }])
            // Clear completion after acceptance
            cancelCompletion()
            clearGhostPreview()
            editor.trigger('ai-completion', 'editor.action.inlineSuggest.hide', {})
            setTimeout(() => {
              isApplyingCompletion.current = false
            }, 100)
          }
        }
      }
    )

    // Add Alt+\ to trigger inline AI completion request immediately
    editor.addCommand(
      (window as any).monaco.KeyMod.Alt | (((window as any).monaco.KeyCode && (window as any).monaco.KeyCode.US_BACKSLASH) ?? (window as any).monaco.KeyCode.Backslash),
      () => {
        // Cancel any pending debounce and trigger completion now
        if (completionTimeoutRef.current) {
          clearTimeout(completionTimeoutRef.current)
          completionTimeoutRef.current = null
        }
        // Fire an immediate request using current editor context (force bypass duplicate check)
        requestCompletionDebounced(editor, true)
        // Also prompt Monaco to show inline suggestions UI
        editor.trigger('ai-completion', 'editor.action.inlineSuggest.trigger', {})
      }
    )

    // Add Tab key for completion acceptance (alternative)
    editor.addCommand(
      (window as any).monaco.KeyCode.Tab,
      () => {
        // Accept current completion with Tab (only if there's a completion)
        const latest = currentCompletionRef.current || ''
        if (latest.trim()) {
          const position = editor.getPosition()
          if (position) {
            isApplyingCompletion.current = true
            editor.executeEdits('ai-completion', [{
              range: new (window as any).monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column
              ),
              text: latest
            }])
            // Clear completion after acceptance
            cancelCompletion()
            clearGhostPreview()
            editor.trigger('ai-completion', 'editor.action.inlineSuggest.hide', {})
            setTimeout(() => {
              isApplyingCompletion.current = false
            }, 100)
            return true // Prevent default Tab behavior
          }
        }
        return false // Allow default Tab behavior if no completion
      }
    )

    // Add Escape key to dismiss completions
    editor.addCommand(
      (window as any).monaco.KeyCode.Escape,
      () => {
        if (currentCompletion.trim()) {
          cancelCompletion()
          clearGhostPreview()
          editor.trigger('ai-completion', 'editor.action.inlineSuggest.hide', {})
          return true
        }
        return false // Allow default Escape behavior if no completion
      }
    )

    // Track content changes for collaborative editing
    editor.onDidChangeModelContent((e) => {
      if (isReceivingChange.current) return // Prevent infinite loops from remote changes
      // If user types, hide ghost preview (it will re-render during new stream)
      clearGhostPreview()
      editor.trigger('ai-completion', 'editor.action.inlineSuggest.hide', {})
      // Handle typing indicators
      if (fileId && projectId) {
        // Start code typing indicator
        startCodeTyping?.(projectId, fileId)
        
        // Clear existing timeout
        if (typingTimeout) {
          clearTimeout(typingTimeout)
        }
        
        // Set new timeout to stop typing indicator
        const timeout = setTimeout(() => {
          stopCodeTyping?.(projectId, fileId)
        }, 1000) // Stop typing after 1 second of inactivity
        
        setTypingTimeout(timeout)
      }

      // Send code changes to other users with proper debouncing
      if (fileId && projectId) {
        // Clear existing debounce timeout
        if (debounceTimeoutRef.current) {
          clearTimeout(debounceTimeoutRef.current)
        }
        
        // Set new debounce timeout
        debounceTimeoutRef.current = setTimeout(() => {
          const currentValue = editor.getValue()
          if (currentValue !== lastSentValueRef.current) {
            // Send the full content for better synchronization
            sendCodeChange?.(fileId, projectId, [{ text: currentValue }], 0)
            lastSentValueRef.current = currentValue
            // Note: Don't call onChange here as Monaco's onChange prop handles parent updates
          }
        }, 300) // Debounce time for responsive collaboration
      }

      // Request completion on typing (debounced)
      if (fileId && projectId && !isReceivingChange.current && !isApplyingCompletion.current) {
        // Only cancel completion if user is actively typing (not applying completion or receiving tokens)
        if (currentCompletion.trim() && !isCompletionLoading) {
          console.log('🛑 Cancelling completion due to user typing')
          cancelCompletion()
        }

        // Clear existing completion timeout
        if (completionTimeoutRef.current) {
          clearTimeout(completionTimeoutRef.current)
        }
        
        // Only request new completion if not currently loading
        if (!isCompletionLoading) {
          // Set new completion timeout
          completionTimeoutRef.current = setTimeout(() => {
            requestCompletionDebounced(editor)
          }, 800) // Longer delay for typing-triggered completions
        }
      }
    })

    // Add custom CSS for collaborator cursors
    const style = document.createElement('style')
    style.textContent = `
      .collaborator-cursor {
        border-left: 2px solid #ff6b6b;
        background-color: rgba(255, 107, 107, 0.1);
      }
      .collaborator-cursor.typing {
        border-left: 2px solid #4ade80;
        background-color: rgba(74, 222, 128, 0.1);
        animation: typing-pulse 1s infinite;
      }
      .collaborator-cursor-before::before {
        content: '';
        position: absolute;
        top: -2px;
        left: -1px;
        width: 0;
        height: 0;
        border-left: 4px solid transparent;
        border-right: 4px solid transparent;
        border-top: 4px solid #ff6b6b;
      }
      .collaborator-cursor.typing .collaborator-cursor-before::before {
        border-top: 4px solid #4ade80;
      }
      @keyframes typing-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      .ghost-multiline-preview {
        color: rgba(255, 255, 255, 0.35);
        font-family: inherit;
        font-size: inherit;
        line-height: inherit;
        white-space: pre;
      }
    `
    document.head.appendChild(style)
  }

  // Update collaborator cursors when typing users change to reflect typing indicators
  useEffect(() => {
    updateCollaboratorCursors()
  }, [codeTypingUsers])

  // Update lastSentValueRef when value prop changes
  useEffect(() => {
    lastSentValueRef.current = value
  }, [value])

  // Preserve cursor position on external value updates (e.g., auto-save)
  useEffect(() => {
    if (!editorRef.current) return

    const editor = editorRef.current
    const model = editor.getModel()
    if (!model) return

    const currentValue = model.getValue()

    console.log('🔄 CodeEditor: Value prop changed:', {
      valueLength: value.length,
      currentValueLength: currentValue.length,
      valuesEqual: value === currentValue,
      isReceivingChange: isReceivingChange.current
    })

    // Only apply if incoming value differs and we are not currently applying a remote change
    if (value !== currentValue && !isReceivingChange.current) {
      console.log('📝 CodeEditor: Applying external value change with cursor preservation')
      const selection = editor.getSelection()
      console.log('💾 CodeEditor: Current selection:', selection)

      // Replace full content while keeping undo stack intact
      editor.pushUndoStop()
      model.pushEditOperations(
        [],
        [
          {
            range: model.getFullModelRange(),
            text: value
          }
        ],
        () => null
      )
      editor.pushUndoStop()

      // Restore previous cursor/selection
      if (selection) {
        editor.setSelection(selection)
        editor.revealPositionInCenter(selection.getPosition())
        console.log('📍 CodeEditor: Restored selection:', selection)
      }
    } else if (value === currentValue) {
      console.log('✅ CodeEditor: Values are equal, no update needed')
    } else if (isReceivingChange.current) {
      console.log('🚫 CodeEditor: Skipping update - currently receiving remote change')
    }
  }, [value])

  // Custom onChange handler that respects the isReceivingChange flag
  const handleChange = (newValue: string | undefined) => {
    if (isReceivingChange.current) {
      console.log('🚫 CodeEditor: Ignoring onChange during remote update')
      return
    }

    const value = newValue || ''
    console.log('📝 CodeEditor: Local change detected, calling parent onChange')
    onChange(value)
  }

  return (
    <Monaco
      value={value}
      onChange={handleChange}
      onMount={handleEditorMount}
      language={resolvedLanguage}
      theme="vs-dark"
      height="100%"
      path={path}
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        tabSize: 2,
        insertSpaces: true,
        smoothScrolling: true,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        readOnly: !!readOnly,
        wordWrap: "on",
        lineNumbers: "on",
        folding: true,
        renderLineHighlight: "all",
        suggestOnTriggerCharacters: true,
        acceptSuggestionOnCommitCharacter: true,
        acceptSuggestionOnEnter: "on",
        accessibilitySupport: "auto",
        autoClosingBrackets: "languageDefined",
        autoClosingDelete: "auto",
        autoClosingOvertype: "auto",
        autoClosingQuotes: "languageDefined",
        autoIndent: "full",
        automaticLayout: true,
        codeLens: true,
        colorDecorators: true,
        contextmenu: true,
        copyWithSyntaxHighlighting: true,
        cursorBlinking: "blink",
        cursorSmoothCaretAnimation: "on",
        dragAndDrop: true,
        fixedOverflowWidgets: true,
        foldingHighlight: true,
        foldingStrategy: "auto",
        fontLigatures: true,
        formatOnPaste: true,
        formatOnType: true,
        glyphMargin: true,
        hideCursorInOverviewRuler: false,
        highlightActiveIndentGuide: true,
        links: true,
        mouseWheelZoom: true,
        multiCursorMergeOverlapping: true,
        multiCursorModifier: "alt",
        overviewRulerBorder: true,
        overviewRulerLanes: 3,
        quickSuggestions: true,
        quickSuggestionsDelay: 100,
        renderControlCharacters: false,
        renderIndentGuides: true,
        renderWhitespace: "none",
        revealHorizontalRightPadding: 30,
        roundedSelection: true,
        scrollbar: {
          vertical: "visible",
          horizontal: "visible",
          verticalScrollbarSize: 14,
          horizontalScrollbarSize: 14,
          verticalSliderSize: 6,
          horizontalSliderSize: 6
        },
        selectOnLineNumbers: true,
        selectionClipboard: true,
        selectionHighlight: true,
        showFoldingControls: "mouseover",
        showUnused: true,
        snippetSuggestions: "inline",
        stablePeek: true,
        inlineSuggest: {
          enabled: true,
          mode: 'prefix',
          keepOnBlur: true,
          showToolbar: 'onHover',
          suppressSuggestions: false
        },
        suggest: {
          showClasses: true,
          showColors: true,
          showConstants: true,
          showConstructors: true,
          showCustomcolors: true,
          showDeprecated: true,
          showEnumMembers: true,
          showEnums: true,
          showEvents: true,
          showFields: true,
          showFiles: true,
          showFolders: true,
          showFunctions: true,
          showIcons: true,
          showInterfaces: true,
          showIssues: true,
          showKeywords: true,
          showMethods: true,
          showModules: true,
          showOperators: true,
          showProperties: true,
          showReferences: true,
          showSnippets: true,
          showStructs: true,
          showTypeParameters: true,
          showUnits: true,
          showUsers: true,
          showValues: true,
          showVariables: true,
          showWords: true
        },
        suggestFontSize: 14,
        suggestLineHeight: 20,
        suggestOnTriggerCharacters: true,
        suggestSelection: "first",
        tabCompletion: "on",
        unfoldOnClickAfterEndOfLine: true,
        unicodeHighlight: {
          ambiguousCharacters: true,
          invisibleCharacters: true,
          nonBasicASCII: true
        },
        useTabStops: true,
        wordBasedSuggestions: true,
        wordSeparators: "`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?",
        wordWrapBreakAfterCharacters: " \t})]?|&,;!",
        wordWrapBreakBeforeCharacters: "{([+",
        wordWrapColumn: 80,
        wordWrapMinified: true,
        wrappingIndent: "same",
        wrappingStrategy: "simple"
      }}
    />
  )
}