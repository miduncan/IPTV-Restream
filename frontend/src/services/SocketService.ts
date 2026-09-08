import { io, Socket } from 'socket.io-client';
import { Channel, ChannelMode } from '../types';

class SocketService {
  private socket: Socket | null = null;
  private listeners: Map<string, ((data: unknown) => void)[]> = new Map();

  connect() {
    if (this.socket?.connected) {
      return;
    }

    if (this.socket) {
      if (!this.socket.active) this.socket.connect();
      return;
    }

    console.log('Connecting to WebSocket server');

    this.socket = io(import.meta.env.VITE_BACKEND_URL, {
      withCredentials: true,
    });

    this.socket.on('connect', () => {
      console.log('Connected to WebSocket server');

      // Re-apply listeners to new socket connection
      this.reapplyListeners();
      this.notifyListeners('socket-connected');
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
      this.notifyListeners('socket-disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.notifyListeners('socket-connect-error');
      if (error.message === 'Authentication required.') {
        window.dispatchEvent(new Event('auth-expired'));
      }
    });

    this.socket.on('app-error', (error) => {
      console.error('Socket error:', error);
    });

    // Listen for incoming custom events
    this.socket.onAny((event: string, data: unknown) => {
      this.notifyListeners(event, data);
    });
  }

  private notifyListeners(event: string, data?: unknown) {
    const eventListeners = this.listeners.get(event);
    if (eventListeners) eventListeners.forEach((listener) => listener(data));
  }

  // Re-apply all event listeners to the new socket connection
  private reapplyListeners() {
    // Nothing needed here as Socket.IO automatically handles event listeners
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  isConnected() {
    return Boolean(this.socket?.connected);
  }

  private waitUntilConnected(timeoutMs: number = 10_000): Promise<Socket> {
    if (this.socket?.connected) return Promise.resolve(this.socket);

    this.connect();
    const socket = this.socket;
    if (!socket) return Promise.reject(new Error('Socket could not be created.'));

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timer);
        socket.off('connect', onConnect);
        socket.off('connect_error', onError);
      };
      const onConnect = () => {
        cleanup();
        resolve(socket);
      };
      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error('The connection timed out. Try again.'));
      }, timeoutMs);

      socket.once('connect', onConnect);
      socket.once('connect_error', onError);
    });
  }

  subscribeToEvent<T>(event: string, listener: (data: T) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    const eventListeners = this.listeners.get(event);
    const normalizedListener = listener as unknown as (data: unknown) => void;
    // Avoid duplicate listeners
    if (eventListeners && !eventListeners.includes(normalizedListener)) {
      eventListeners.push(normalizedListener);
    }
  }

  // Unsubscribe from event
  unsubscribeFromEvent<T>(event: string, listener: (data: T) => void) {
    const eventListeners = this.listeners.get(event);
    const normalizedListener = listener as unknown as (data: unknown) => void;
    if (eventListeners) {
      this.listeners.set(
        event,
        eventListeners.filter(
          (existingListener) => existingListener !== normalizedListener
        )
      );
    }
  }

  // Send chat message
  sendMessage(userName: string, message: string): Promise<string> {
    if (!this.socket?.connected) {
      return Promise.reject(new Error('Chat is reconnecting. Try again in a moment.'));
    }

    return new Promise((resolve, reject) => {
      this.socket?.timeout(5000).emit(
        'send-message',
        { userName, message },
        (timeoutError: Error | null, response?: { ok: boolean; error?: string; messageId?: string }) => {
          if (timeoutError) {
            reject(new Error('The message timed out. Try again.'));
          } else if (!response?.ok) {
            reject(new Error(response?.error || 'Message could not be sent.'));
          } else if (typeof response.messageId !== 'string') {
            reject(new Error('The server returned an invalid message response.'));
          } else {
            resolve(response.messageId);
          }
        }
      );
    });
  }

  // Add channel
  addChannel(
    name: string,
    url: string,
    avatar: string,
    mode: ChannelMode,
    headersJson: string,
  ) {
    if (!this.socket || !this.socket.connected) {
      this.connect();

      if (!this.socket || !this.socket.connected) {
        throw new Error('Socket is not connected.');
      }
    }

    this.socket.emit('add-channel', { name, url, avatar, mode, headersJson });
  }

  // Set current channel
  async setCurrentChannel(id: number): Promise<void> {
    let socket: Socket;
    try {
      socket = await this.waitUntilConnected();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Channel could not be changed.';
      this.notifyListeners('app-error', { message });
      throw error;
    }

    return new Promise((resolve, reject) => {
      socket.timeout(15_000).emit(
        'set-current-channel',
        id,
        (timeoutError: Error | null, response?: { ok: boolean; error?: string }) => {
          if (timeoutError) {
            const error = new Error('The channel change timed out. Try again.');
            this.notifyListeners('app-error', { message: error.message });
            reject(error);
          } else if (!response?.ok) {
            reject(new Error(response?.error || 'Channel could not be changed.'));
          } else {
            resolve();
          }
        }
      );
    });
  }

  // Delete channel
  deleteChannel(id: number) {
    if (!this.socket || !this.socket.connected) {
      this.connect();

      if (!this.socket || !this.socket.connected) {
        throw new Error('Socket is not connected.');
      }
    }

    this.socket.emit('delete-channel', id);
  }

  // Update channel
  updateChannel(id: number, updatedAttributes: Partial<Channel>) {
    if (!this.socket || !this.socket.connected) {
      this.connect();

      if (!this.socket || !this.socket.connected) {
        throw new Error('Socket is not connected.');
      }
    }

    this.socket.emit('update-channel', { id, updatedAttributes });
  }

  // Add playlist
  addPlaylist(
    playlist: string,
    playlistName: string,
    mode: ChannelMode,
    playlistUpdate: boolean,
    headers: string,
  ) {
    if (!this.socket || !this.socket.connected) {
      this.connect();

      if (!this.socket || !this.socket.connected) {
        throw new Error('Socket is not connected.');
      }
    }

    this.socket.emit('add-playlist', {
      playlist,
      playlistName,
      mode,
      playlistUpdate,
      headers,
    });
  }

  // Update playlist
  updatePlaylist(
    playlist: string,
    updatedAttributes: Partial<Channel>,
  ) {
    if (!this.socket || !this.socket.connected) {
      this.connect();

      if (!this.socket || !this.socket.connected) {
        throw new Error('Socket is not connected.');
      }
    }

    this.socket.emit('update-playlist', { playlist, updatedAttributes });
  }

  // Delete playlist
  deletePlaylist(playlist: string) {
    if (!this.socket || !this.socket.connected) {
      this.connect();

      if (!this.socket || !this.socket.connected) {
        throw new Error('Socket is not connected.');
      }
    }

    this.socket.emit('delete-playlist', playlist);
  }

}

const socketService = new SocketService();
export default socketService;
