const assert = require('node:assert/strict');
const test = require('node:test');

const ChatService = require('../services/ChatService');
const ChatSocketHandler = require('../socket/ChatSocketHandler');

test.beforeEach(() => {
  ChatService.messages = [];
});

test('chat messages normalize display names and use a server timestamp', () => {
  const message = ChatService.addMessage('  Maya Chen  ', '  Great stream!  ');

  assert.equal(message.user.name, 'Maya Chen');
  assert.equal(message.kind, 'chat');
  assert.equal(message.message, 'Great stream!');
  assert.equal(Number.isNaN(Date.parse(message.timestamp)), false);
  assert.deepEqual(Object.keys(message.user), ['name']);
});

test('chat rejects invalid display names and messages', () => {
  assert.throws(() => ChatService.addMessage('x', 'Hello'), /2–24 characters/);
  assert.throws(() => ChatService.addMessage('Viewer', '   '), /Write a message/);
  assert.throws(() => ChatService.addMessage('Viewer', 'x'.repeat(501)), /up to 500/);
});

test('chat retains only the latest 200 messages', () => {
  for (let index = 0; index < 201; index += 1) {
    ChatService.addMessage('Viewer', `Message ${index}`);
  }

  assert.equal(ChatService.getMessages().length, 200);
  assert.equal(ChatService.getMessages()[0].message, 'Message 1');
});

test('chat socket confirms delivery and broadcasts the server message to every client', () => {
  let listener;
  let broadcast;
  let acknowledgement;
  const socket = {
    emit(event, messages) {
      assert.equal(event, 'chat-history');
      assert.deepEqual(messages, []);
    },
    on(event, callback) {
      assert.equal(event, 'send-message');
      listener = callback;
    },
  };
  const io = {
    emit(event, message) {
      broadcast = { event, message };
    },
  };

  ChatSocketHandler(io, socket);
  listener({ userName: 'Jordan Lee', message: 'Hello!' }, (response) => {
    acknowledgement = response;
  });

  assert.deepEqual(acknowledgement, { ok: true, messageId: broadcast.message.id });
  assert.equal(broadcast.event, 'chat-message');
  assert.equal(broadcast.message.user.name, 'Jordan Lee');
  assert.equal(broadcast.message.message, 'Hello!');
});

test('chat socket rejects invalid payloads without broadcasting', () => {
  let listener;
  let broadcastCount = 0;
  let acknowledgement;
  const socket = {
    emit(event, messages) {
      assert.equal(event, 'chat-history');
      assert.deepEqual(messages, []);
    },
    on(_event, callback) { listener = callback; },
  };
  const io = { emit() { broadcastCount += 1; } };

  ChatSocketHandler(io, socket);
  listener({ userName: 'x', message: 'Hello!' }, (response) => {
    acknowledgement = response;
  });

  assert.equal(acknowledgement.ok, false);
  assert.match(acknowledgement.error, /2–24 characters/);
  assert.equal(broadcastCount, 0);
});
