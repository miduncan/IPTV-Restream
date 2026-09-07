import React, { useState, useEffect } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import socketService from '../../services/SocketService';
import { Channel, ChatMessage, RandomUser, User } from '../../types';
import SendMessage from './SendMessage';
import SystemMessage from './SystemMessage';
import ReceivedMessage from './ReceivedMessage';
import apiService from '../../services/ApiService';

function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [user, setUser] = useState<User>();

  useEffect(() => {

    // Use your own auth service instead of using randomized user
    apiService
      .request<RandomUser>('/api', 'GET', 'https://randomuser.me')
      .then((randomUser) => {
        const name = randomUser.results[0].name;
        const picture = randomUser.results[0].picture;
        setUser({
          name: `${name.first} ${name.last}`,
          avatar: picture.medium,
        });
      })
      .catch((error) => console.error('Error fetching random user:', error));

    const messageListener = (message: ChatMessage) => {
      setMessages((prevMessages) => [...prevMessages, message]);
    };
    socketService.subscribeToEvent('chat-message', messageListener);

    const channelSelectedListener = (selectedChannel: Channel) => {
      setMessages((prev) => [
        ...prev, 
        {
          id: prev.length ? prev[prev.length -1].id + 1 : 1,
          user: {
            name: 'System',
            avatar: '',
          },
          message: `Switched to ${selectedChannel.name}'s stream`,
          timestamp: new Date().toISOString(),
          userId: 'System',
        }
      ]);
    }
    socketService.subscribeToEvent('channel-selected', channelSelectedListener);

    return () => {
      socketService.unsubscribeFromEvent('chat-message', messageListener);
      socketService.unsubscribeFromEvent('channel-selected', channelSelectedListener);
    };
  }, []);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim() || !user) return;

    socketService.sendMessage(user.name, user.avatar, newMessage, new Date().toISOString());

    setMessages((prev) => [
      ...prev,
      {
        id: prev.length ? prev[prev.length -1].id + 1 : 1,
        user: user,
        message: newMessage,
        timestamp: new Date().toISOString(),
      },
    ]);
    setNewMessage('');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-[#233242] px-4 py-3 text-sm text-[#91A0AF]">
        <MessageSquare className="h-4 w-4 text-[#4EA1FF]" />
        Messages update live
      </div>

      <div className="min-h-[22rem] flex-1 space-y-4 overflow-y-auto p-4 scroll-container vertical-scroll-container lg:min-h-0">
        {messages.map((msg) => {
          if(msg.user.name === user?.name) {
            return <SendMessage key={msg.id} msg={msg}></SendMessage>;
          } else if(msg.user.name === 'System') {
            return <SystemMessage key={msg.id} msg={msg}></SystemMessage>;
          } else {
            return <ReceivedMessage key={msg.id} msg={msg}></ReceivedMessage>;
          }      
        })}
      </div>

      <form onSubmit={handleSendMessage} className="border-t border-[#233242] p-4">
        <div className="relative">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Write a message"
            aria-label="Chat message"
            className="admin-input w-full py-2.5 pl-3 pr-12 text-sm"
          />
          <button type="submit" aria-label="Send message" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-[#4EA1FF] p-1.5 text-[#07111B] transition-colors hover:bg-[#72B4FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8BC3FF]">
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </div>
  );
}

export default Chat;
