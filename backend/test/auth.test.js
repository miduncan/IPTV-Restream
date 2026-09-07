const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "iptv-auth-"));
process.env.SETTINGS_DB_PATH = path.join(testDirectory, "settings.db");
const authService = require("../services/auth/AuthService");
const authController = require("../controllers/AuthController");

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test("trusted proxy identities carry viewer and admin roles", () => {
  assert.deepEqual(authService.userForIdentity("friends", "viewer"), {
    username: "friends",
    role: "viewer",
    isAdmin: false,
  });
  assert.deepEqual(authService.userForIdentity("site-owner", "admin"), {
    username: "site-owner",
    role: "admin",
    isAdmin: true,
  });
});

test("request middleware trusts the identity supplied by the reverse proxy", () => {
  const request = {
    headers: {
      "x-authenticated-user": "site-owner",
      "x-authenticated-role": "admin",
    },
  };
  let nextCalled = false;

  authController.attachUser(request, {}, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(request.user.role, "admin");
});

test("admin middleware rejects viewers and permits admins", () => {
  const viewerResponse = createResponse();
  authController.requireAdmin(
    { user: authService.userForIdentity("friends", "viewer") },
    viewerResponse,
    () => assert.fail("viewer should not reach admin handler")
  );
  assert.equal(viewerResponse.statusCode, 403);

  let nextCalled = false;
  authController.requireAdmin(
    { user: authService.userForIdentity("site-owner", "admin") },
    createResponse(),
    () => { nextCalled = true; }
  );
  assert.equal(nextCalled, true);
});

test.after(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
