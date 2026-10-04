const assert = require('node:assert/strict');
const test = require('node:test');

const ReactionSocketHandler = require('../socket/ReactionSocketHandler');

function setup() {
  const listeners = {};
  const broadcasts = [];
  const socket = {
    on(event, callback) { listeners[event] = callback; },
    broadcast: {
      emit(event, payload) { broadcasts.push({ event, payload }); },
    },
  };

  ReactionSocketHandler({}, socket);
  return { listener: listeners['send-reaction'], broadcasts };
}

test('reactions normalize the username and broadcast to other viewers', () => {
  const { listener, broadcasts } = setup();
  let acknowledgement;

  listener({ userName: '  Maya Chen  ', emoji: '🏈' }, (response) => {
    acknowledgement = response;
  });

  assert.equal(acknowledgement.ok, true);
  assert.equal(typeof acknowledgement.reactionId, 'string');
  assert.equal(broadcasts[0].event, 'video-reaction');
  assert.equal(broadcasts[0].payload.id, acknowledgement.reactionId);
  assert.equal(broadcasts[0].payload.user.name, 'Maya Chen');
  assert.equal(broadcasts[0].payload.emoji, '🏈');
  assert.equal(Number.isNaN(Date.parse(broadcasts[0].payload.timestamp)), false);
});

test('reactions reject invalid usernames and unsupported emoji', () => {
  const invalidName = setup();
  let invalidNameResponse;
  invalidName.listener({ userName: 'x', emoji: '🏈' }, (response) => {
    invalidNameResponse = response;
  });

  assert.equal(invalidNameResponse.ok, false);
  assert.match(invalidNameResponse.error, /2–24 characters/);
  assert.equal(invalidName.broadcasts.length, 0);

  const invalidEmoji = setup();
  let invalidEmojiResponse;
  invalidEmoji.listener({ userName: 'Maya', emoji: '🔥' }, (response) => {
    invalidEmojiResponse = response;
  });

  assert.equal(invalidEmojiResponse.ok, false);
  assert.match(invalidEmojiResponse.error, /available reactions/);
  assert.equal(invalidEmoji.broadcasts.length, 0);
});
