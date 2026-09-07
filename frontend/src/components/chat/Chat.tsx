import { FormEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import socketService from '../../services/SocketService';
import { Channel, ChatMessage } from '../../types';
import ChatMessageItem from './ChatMessageItem';
import SystemMessage from './SystemMessage';
import UsernameModal from './UsernameModal';

const USERNAME_STORAGE_KEY = 'streamhub.chat.username';

function readStoredUsername() {
  try {
    const value = window.localStorage.getItem(USERNAME_STORAGE_KEY)?.trim();
    return value && value.length >= 2 && value.length <= 24 ? value : '';
  } catch {
    return '';
  }
}

function Chat({ isActive }: { isActive: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [username, setUsername] = useState(readStoredUsername);
  const [isUsernameModalOpen, setIsUsernameModalOpen] = useState(false);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [sendError, setSendError] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isConnected, setIsConnected] = useState(() => socketService.isConnected());
  const composerRef = useRef<HTMLInputElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const shouldFollowMessagesRef = useRef(true);

  useEffect(() => {
    const messageListener = (message: ChatMessage) => {
      setMessages((previous) => previous.some(({ id }) => id === message.id)
        ? previous
        : [...previous, message]);
    };
    const historyListener = (history: ChatMessage[]) => {
      setMessages((previous) => {
        const previousIds = new Set(previous.map(({ id }) => id));
        return [...history.filter(({ id }) => !previousIds.has(id)), ...previous];
      });
    };
    const channelSelectedListener = (selectedChannel: Channel) => {
      setMessages((previous) => [
        ...previous,
        {
          id: `system-${Date.now()}`,
          kind: 'system',
          user: { name: 'System' },
          message: `Switched to ${selectedChannel.name}'s stream`,
          timestamp: new Date().toISOString(),
        },
      ]);
    };
    const connectedListener = () => {
      setIsConnected(true);
      setSendError('');
    };
    const disconnectedListener = () => setIsConnected(false);

    socketService.subscribeToEvent('chat-message', messageListener);
    socketService.subscribeToEvent('chat-history', historyListener);
    socketService.subscribeToEvent('channel-selected', channelSelectedListener);
    socketService.subscribeToEvent('socket-connected', connectedListener);
    socketService.subscribeToEvent('socket-disconnected', disconnectedListener);
    socketService.subscribeToEvent('socket-connect-error', disconnectedListener);
    return () => {
      socketService.unsubscribeFromEvent('chat-message', messageListener);
      socketService.unsubscribeFromEvent('chat-history', historyListener);
      socketService.unsubscribeFromEvent('channel-selected', channelSelectedListener);
      socketService.unsubscribeFromEvent('socket-connected', connectedListener);
      socketService.unsubscribeFromEvent('socket-disconnected', disconnectedListener);
      socketService.unsubscribeFromEvent('socket-connect-error', disconnectedListener);
    };
  }, []);

  useLayoutEffect(() => {
    const messageList = messageListRef.current;
    if (!isActive || !messageList || !shouldFollowMessagesRef.current) return;
    messageList.scrollTop = messageList.scrollHeight;
  }, [isActive, messages]);

  const openUsernameModal = useCallback((editing = false) => {
    setIsEditingUsername(editing);
    setIsUsernameModalOpen(true);
  }, []);

  const requireUsername = () => {
    if (!username) openUsernameModal(false);
  };

  const saveUsername = (nextUsername: string) => {
    try {
      window.localStorage.setItem(USERNAME_STORAGE_KEY, nextUsername);
    } catch {
      // The username still works for this session when storage is unavailable.
    }
    setUsername(nextUsername);
    setIsUsernameModalOpen(false);
    setSendError('');
    window.requestAnimationFrame(() => composerRef.current?.focus());
  };

  const handleSendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const message = newMessage.trim();
    if (!username) {
      openUsernameModal(false);
      return;
    }
    if (!message || isSending) return;

    setIsSending(true);
    setSendError('');
    try {
      await socketService.sendMessage(username, message);
      setNewMessage('');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Message could not be sent.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-[#233242] px-4 py-3 text-xs text-[#91A0AF]">
        <span className={`status-light ${isConnected ? 'bg-[#44D492] text-[#44D492]' : 'bg-[#D7A94B] text-[#D7A94B]'}`} aria-hidden="true" />
        {isConnected ? 'Messages update live' : 'Chat is reconnecting'}
      </div>

      <div
        ref={messageListRef}
        className="min-h-[22rem] flex-1 space-y-4 overflow-y-auto p-4 scroll-container vertical-scroll-container lg:min-h-0"
        onScroll={(event) => {
          const messageList = event.currentTarget;
          const distanceFromBottom = messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight;
          shouldFollowMessagesRef.current = distanceFromBottom <= 48;
        }}
        aria-live="polite"
        aria-label="Live chat messages"
      >
        {messages.length === 0 && (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
            <MessageSquare className="h-6 w-6 text-[#4EA1FF]" />
            <p className="mt-3 text-sm font-medium text-[#DCE6EF]">The chat is quiet</p>
            <p className="mt-1 text-xs leading-5 text-[#718396]">Start the conversation while you watch.</p>
          </div>
        )}
        {messages.map((msg) => msg.kind === 'system' || msg.user.name === 'System'
          ? <SystemMessage key={msg.id} msg={msg} />
          : <ChatMessageItem key={msg.id} msg={msg} isCurrentUser={msg.user.name === username} />)}
      </div>

      <form onSubmit={handleSendMessage} className="border-t border-[#233242] p-4">
        <div className="relative">
          <input
            ref={composerRef}
            type="text"
            value={newMessage}
            onChange={(event) => setNewMessage(event.target.value)}
            onFocus={requireUsername}
            onClick={requireUsername}
            readOnly={!username}
            maxLength={500}
            placeholder={username ? 'Write a message' : 'Choose a username to chat'}
            aria-label="Chat message"
            aria-describedby={sendError ? 'chat-send-error' : undefined}
            className="admin-input w-full py-2.5 pl-3 pr-12 text-sm"
          />
          <button
            type="submit"
            disabled={!newMessage.trim() || isSending || !isConnected}
            aria-label="Send message"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-[#4EA1FF] p-1.5 text-[#07111B] transition-colors hover:bg-[#72B4FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BC3FF] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        {sendError && <p id="chat-send-error" role="alert" className="mt-2 text-xs text-[#FF8B8B]">{sendError}</p>}
        {username && (
          <div className="mt-2 flex items-center justify-between gap-3 text-xs text-[#718396]">
            <span className="truncate">Chatting as <strong className="font-medium text-[#B8C5D1]">{username}</strong></span>
            <button
              type="button"
              onClick={() => openUsernameModal(true)}
              className="shrink-0 text-[#8BC3FF] hover:text-[#B5D8FF] focus-visible:outline-none focus-visible:underline"
            >
              Change username
            </button>
          </div>
        )}
      </form>

      {isUsernameModalOpen && (
        <UsernameModal
          initialUsername={isEditingUsername ? username : ''}
          isEditing={isEditingUsername}
          onCancel={() => setIsUsernameModalOpen(false)}
          onSave={saveUsername}
        />
      )}
    </div>
  );
}

export default Chat;
