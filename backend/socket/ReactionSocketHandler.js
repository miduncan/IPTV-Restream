const crypto = require('node:crypto');
const ChatService = require('../services/ChatService');

const ALLOWED_REACTIONS = new Set(['🏈', '🙌', '😬', '👏', '🚩', '👎']);

module.exports = (_io, socket) => {
  socket.on('send-reaction', (payload = {}, acknowledge) => {
    const respond = typeof acknowledge === 'function' ? acknowledge : () => {};

    try {
      const userName = ChatService.validateUserName(payload.userName);
      if (!ALLOWED_REACTIONS.has(payload.emoji)) {
        throw new Error('Choose one of the available reactions.');
      }

      const reaction = {
        id: crypto.randomUUID(),
        emoji: payload.emoji,
        user: { name: userName },
        timestamp: new Date().toISOString(),
      };

      socket.broadcast.emit('video-reaction', reaction);
      respond({ ok: true, reactionId: reaction.id });
    } catch (error) {
      respond({ ok: false, error: error.message });
    }
  });
};
