const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "iptv-auth-"));
process.env.SETTINGS_DB_PATH = path.join(testDirectory, "settings.db");
process.env.AUTH_VIEWER_USERNAME = "friends";
process.env.AUTH_VIEWER_PASSWORD = "viewer-password";
process.env.AUTH_ADMIN_USERNAME = "site-owner";
process.env.AUTH_ADMIN_PASSWORD = "admin-password";

const authService = require("../services/auth/AuthService");
const authController = require("../controllers/AuthController");
const { SESSION_COOKIE_NAME } = require("../services/auth/AuthService");

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    send(value) {
      this.body = value;
      return this;
    },
  };
}

test("configured credentials authenticate viewer and admin roles", () => {
  assert.deepEqual(authService.authenticateCredentials("friends", "viewer-password"), {
    username: "friends",
    role: "viewer",
    isAdmin: false,
  });
  assert.deepEqual(authService.authenticateCredentials("site-owner", "admin-password"), {
    username: "site-owner",
    role: "admin",
    isAdmin: true,
  });
  assert.equal(authService.authenticateCredentials("friends", "wrong"), null);
});

test("opaque sessions resolve from the session cookie and can be revoked", () => {
  const user = authService.authenticateCredentials("friends", "viewer-password");
  const token = authService.createSession(user);
  const headers = { cookie: `theme=dark; ${SESSION_COOKIE_NAME}=${token}` };

  assert.deepEqual(authService.userFromHeaders(headers), user);
  authService.destroySession(token);
  assert.equal(authService.userFromHeaders(headers), null);
});

test("login sets an HttpOnly same-site cookie without returning its token", () => {
  const response = createResponse();
  authController.login(
    {
      body: { username: "site-owner", password: "admin-password" },
      headers: { host: "stream.test" },
      secure: false,
    },
    response
  );

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.user.role, "admin");
  assert.equal(Object.hasOwn(response.body, "token"), false);
  assert.match(response.headers["set-cookie"], /^iptv_session=/);
  assert.match(response.headers["set-cookie"], /HttpOnly/);
  assert.match(response.headers["set-cookie"], /SameSite=Strict/);
  assert.doesNotMatch(response.headers["set-cookie"], /Secure/);
});

test("HTTPS login marks the session cookie Secure", () => {
  const response = createResponse();
  authController.login(
    {
      body: { username: "friends", password: "viewer-password" },
      headers: { host: "stream.test", "x-forwarded-proto": "https" },
      secure: false,
    },
    response
  );
  assert.match(response.headers["set-cookie"], /; Secure$/);
});

test("request middleware reads identity from a valid session", () => {
  const user = authService.authenticateCredentials("site-owner", "admin-password");
  const token = authService.createSession(user);
  const request = { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } };
  let nextCalled = false;

  authController.attachUser(request, {}, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(request.user.role, "admin");
});

test("authentication middleware rejects missing sessions", () => {
  const response = createResponse();
  authController.requireAuthenticated(
    { user: null },
    response,
    () => assert.fail("unauthenticated request should not continue")
  );
  assert.equal(response.statusCode, 401);
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

test("origin middleware rejects cross-origin browser mutations", () => {
  const response = createResponse();
  authController.requireSameOrigin(
    { headers: { origin: "http://evil.test", host: "stream.test" } },
    response,
    () => assert.fail("cross-origin request should not continue")
  );
  assert.equal(response.statusCode, 403);
});

test.after(() => {
  fs.rmSync(testDirectory, { recursive: true, force: true });
});
