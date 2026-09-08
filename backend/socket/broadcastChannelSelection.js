const ChatService = require('../services/ChatService');

function broadcastChannelSelection(io, channel) {
  if (!io) return;

  io.emit('channel-selected', channel);
  if (!channel) return;

  const systemMessage = ChatService.addSystemMessage(`Switched to ${channel.name}'s stream`);
  io.emit('chat-message', systemMessage);
}

module.exports = broadcastChannelSelection;
