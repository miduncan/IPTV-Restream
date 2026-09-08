const assert = require('node:assert/strict');
const test = require('node:test');

const ViewerPresence = require('../socket/ViewerPresence');

test('viewer presence broadcasts every authenticated socket connection', () => {
  const counts = [];
  const presence = new ViewerPresence({
    emit(event, payload) {
      assert.equal(event, 'viewer-count');
      counts.push(payload.count);
    },
  });

  presence.connected('socket-1');
  presence.connected('socket-2');
  presence.disconnected('socket-1');
  presence.disconnected('socket-2');

  assert.deepEqual(counts, [1, 2, 1, 0]);
});

test('viewer presence does not double-count a repeated socket ID', () => {
  const counts = [];
  const presence = new ViewerPresence({ emit(_event, payload) { counts.push(payload.count); } });

  presence.connected('socket-1');
  presence.connected('socket-1');

  assert.deepEqual(counts, [1, 1]);
});
