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
      if (payload.channelId !== undefined
        && (!Number.isSafeInteger(payload.channelId) || payload.channelId <= 0)) {
        throw new Error('Reaction channel is invalid.');
      }

      let playback;
      if (payload.playback !== undefined) {
        const { segmentSequence, segmentOffset } = payload.playback || {};
        if (!Number.isSafeInteger(segmentSequence) || segmentSequence < 0) {
          throw new Error('Reaction segment is invalid.');
        }
        if (!Number.isFinite(segmentOffset) || segmentOffset < 0 || segmentOffset > 120) {
          throw new Error('Reaction segment offset is invalid.');
        }
        playback = { segmentSequence, segmentOffset };
      }

      const reaction = {
        id: crypto.randomUUID(),
        emoji: payload.emoji,
        user: { name: userName },
        timestamp: new Date().toISOString(),
        ...(payload.channelId === undefined ? {} : { channelId: payload.channelId }),
        ...(playback ? { playback } : {}),
      };

      socket.broadcast.emit('video-reaction', reaction);
      respond({ ok: true, reactionId: reaction.id });
    } catch (error) {
      respond({ ok: false, error: error.message });
    }
  });
};
