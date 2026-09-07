const { ChatMessage, User } = require('../models/ChatMessage');

class ChatService {
    constructor() {
        this.messages = [];
    }

    addMessage(userName, message) {
        const newChatMessage = new ChatMessage(
            new User(this.validateUserName(userName)),
            this.validateMessage(message),
            new Date().toISOString()
        );
        this.messages.push(newChatMessage);
        if (this.messages.length > 200) this.messages.shift();
        return newChatMessage;
    }

    validateUserName(userName) {
        if (typeof userName !== 'string') throw new Error('Choose a username before chatting.');
        const normalized = userName.trim();
        if (normalized.length < 2 || normalized.length > 24) {
            throw new Error('Username must be 2–24 characters.');
        }
        if (/[\u0000-\u001F\u007F]/.test(normalized)) {
            throw new Error('Username contains unsupported characters.');
        }
        return normalized;
    }

    validateMessage(message) {
        if (typeof message !== 'string') throw new Error('Write a message before sending.');
        const normalized = message.trim();
        if (!normalized) throw new Error('Write a message before sending.');
        if (normalized.length > 500) throw new Error('Messages can be up to 500 characters.');
        return normalized;
    }

    getMessages() {
        return this.messages;
    }
}

module.exports = new ChatService();
