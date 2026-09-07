const ChatService = require('../services/ChatService');
module.exports = (io, socket) => {
    socket.emit('chat-history', ChatService.getMessages());

    socket.on('send-message', (payload = {}, acknowledge) => {
        const respond = typeof acknowledge === 'function' ? acknowledge : () => {};
        try {
            const chatMessage = ChatService.addMessage(payload.userName, payload.message);
            io.emit('chat-message', chatMessage);
            respond({ ok: true, messageId: chatMessage.id });
        } catch (error) {
            respond({ ok: false, error: error.message });
        }
    });
};
