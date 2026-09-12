const assert = require("node:assert/strict");
const test = require("node:test");

const ClockSocketHandler = require("../socket/ClockSocketHandler");

test("clock synchronization returns the backend wall clock", () => {
  let handler;
  const socket = {
    on(event, callback) {
      if (event === "sync-clock") handler = callback;
    },
  };

  ClockSocketHandler(socket, () => 1_725_000_000_123);

  let response;
  handler((payload) => { response = payload; });
  assert.deepEqual(response, { serverTimeMs: 1_725_000_000_123 });
});

test("clock synchronization ignores requests without an acknowledgement", () => {
  let handler;
  const socket = {
    on(_event, callback) {
      handler = callback;
    },
  };

  ClockSocketHandler(socket);
  assert.doesNotThrow(() => handler());
});
