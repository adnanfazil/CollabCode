# Terminal Enhancement Test Guide

## Features Added

### 1. Enhanced Scrolling
- **Increased scrollback buffer**: From 1,000 to 10,000 lines
- **Scroll sensitivity**: Enhanced mouse wheel scrolling
- **Fast scroll**: Shift + mouse wheel for faster scrolling
- **Auto-scroll**: Automatically scrolls to bottom on user input
- **Scroll position indicator**: Shows current scroll position in header

### 2. Keyboard Shortcuts
- **Ctrl+C**: Interrupt current process (enhanced with dual signal method)
- **Ctrl+D**: Send EOF signal / exit
- **Ctrl+Shift+C**: Copy selected text
- **Ctrl+Shift+V**: Paste from clipboard
- **Ctrl+L**: Clear terminal screen
- **Page Up/Down**: Scroll up/down by pages
- **Ctrl+Home**: Scroll to top
- **Ctrl+End**: Scroll to bottom
- **Alt+Click**: Move cursor to clicked position

### 3. Process Interruption
- **Enhanced Ctrl+C**: Works with both containerized and local processes
- **Dual signal method**: Sends both Ctrl+C character and SIGINT signal
- **Graceful handling**: Proper error handling and logging

## Testing Instructions

### Test Scrolling
1. Open terminal in CollabCode
2. Run a command that produces lots of output: `ls -la` or `dir` (Windows)
3. Try scrolling with mouse wheel
4. Test Page Up/Down keys
5. Test Ctrl+Home and Ctrl+End
6. Check scroll position indicator in header

### Test Process Interruption
1. Run a long-running process: `ping google.com` or `python -c "import time; [time.sleep(1) for _ in range(100)]"`
2. Press Ctrl+C to interrupt
3. Verify the process stops and you get a new prompt
4. Check terminal logs for proper interrupt handling

### Test Keyboard Shortcuts
1. Type some text and select it
2. Press Ctrl+Shift+C to copy
3. Press Ctrl+Shift+V to paste
4. Press Ctrl+L to clear terminal
5. Test other shortcuts as listed above

### Test Copy/Paste
1. Select text in terminal
2. Use Ctrl+Shift+C to copy
3. Use Ctrl+Shift+V to paste
4. Verify clipboard integration works

## Expected Behavior

- Terminal should handle all keyboard shortcuts smoothly
- Scrolling should be responsive and show position indicator
- Ctrl+C should reliably stop running processes
- Copy/paste should work with system clipboard
- All features should work in both containerized and local terminal modes

## Troubleshooting

If Ctrl+C doesn't work:
- Check browser console for errors
- Verify WebSocket connection is active
- Check backend logs for interrupt signal handling

If scrolling is not smooth:
- Check if terminal has focus (click on terminal area)
- Verify scroll position updates in header

If copy/paste doesn't work:
- Ensure browser has clipboard permissions
- Try using right-click context menu as fallback