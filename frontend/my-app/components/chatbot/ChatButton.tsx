import React, { useState } from 'react';
import { Button } from '../ui/button';
import ChatInterface from './ChatInterface';

interface ChatButtonProps {
  projectId?: string;
  terminalOutput?: string;
  className?: string;
}

const ChatButton: React.FC<ChatButtonProps> = ({ 
  projectId, 
  terminalOutput, 
  className = '' 
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-4 right-4 rounded-full w-12 h-12 shadow-lg hover:shadow-xl transition-shadow ${className}`}
        title="AI Assistant"
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-6 h-6"
        >
          <path
            d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 1H5C3.89 1 3 1.89 3 3V19C3 20.1 3.9 21 5 21H11V19H5V3H13V9H21ZM14 15.5C14 14.1 15.1 13 16.5 13S19 14.1 19 15.5V16H20V22H13V16H14V15.5ZM16.5 15C15.7 15 15 15.7 15 16.5V17H18V16.5C18 15.7 17.3 15 16.5 15Z"
            fill="currentColor"
          />
        </svg>
      </Button>

      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-2xl">
            <ChatInterface
              projectId={projectId}
              terminalOutput={terminalOutput}
              onClose={() => setIsOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
};

export default ChatButton;