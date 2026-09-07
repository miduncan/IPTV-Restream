const crypto = require("node:crypto");
const sessionStore = require("./SessionStore");

require("dotenv").config();

const SESSION_COOKIE_NAME = "iptv_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** Authenticate shared accounts and manage opaque, revocable sessions. */
class AuthService {
  constructor() {
    this.channelSelectionRequiresAdminValue =
      process.env.CHANNEL_SELECTION_REQUIRES_ADMIN === "true";
    this.credentials = [
      {
        username: process.env.AUTH_VIEWER_USERNAME || "",
        password: process.env.AUTH_VIEWER_PASSWORD || "",
        role: "viewer",
      },
      {
        username: process.env.AUTH_ADMIN_USERNAME || "",
        password: process.env.AUTH_ADMIN_PASSWORD || "",
        role: "admin",
      },
    ];

    const values = this.credentials.flatMap(({ username, password }) => [username, password]);
    const configuredCount = values.filter(Boolean).length;
    if (configuredCount !== 0 && configuredCount !== values.length) {
      throw new Error("Both viewer and admin credentials must be fully configured.");
    }
    if (configuredCount > 0 && this.credentials[0].username === this.credentials[1].username) {
      throw new Error("Viewer and admin usernames must be different.");
    }
    this.authenticationEnabled = configuredCount > 0;
  }

  channelSelectionRequiresAdmin() {
    return this.channelSelectionRequiresAdminValue;
  }

  isAuthenticationEnabled() {
    return this.authenticationEnabled;
  }

  userForIdentity(username, role) {
    const authenticatedUsername = typeof username === "string" ? username : "";
    const authenticatedRole = role === "admin" ? "admin" : "viewer";
    return {
      username: authenticatedUsername || null,
      role: authenticatedRole,
      isAdmin: authenticatedRole === "admin",
    };
  }

  anonymousUser() {
    return this.userForIdentity(null, "viewer");
  }

  safeEqual(left, right) {
    const leftBuffer = Buffer.from(String(left));
    const rightBuffer = Buffer.from(String(right));
    if (leftBuffer.length !== rightBuffer.length) return false;
    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }

  authenticateCredentials(username, password) {
    if (!this.authenticationEnabled) return null;
    const match = this.credentials.find((credential) =>
      this.safeEqual(username, credential.username) &&
      this.safeEqual(password, credential.password)
    );
    return match ? this.userForIdentity(match.username, match.role) : null;
  }

  createSession(user) {
    sessionStore.deleteExpired();
    const token = crypto.randomBytes(32).toString("base64url");
    sessionStore.create({
      tokenHash: this.hashToken(token),
      username: user.username,
      role: user.role,
      expiresAt: Date.now() + SESSION_TTL_MS,
    });
    return token;
  }

  destroySession(token) {
    if (token) sessionStore.delete(this.hashToken(token));
  }

  hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  parseCookies(cookieHeader = "") {
    return cookieHeader.split(";").reduce((cookies, pair) => {
      const separator = pair.indexOf("=");
      if (separator < 0) return cookies;
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      if (!name) return cookies;
      try {
        cookies[name] = decodeURIComponent(value);
      } catch {
        cookies[name] = value;
      }
      return cookies;
    }, {});
  }

  sessionTokenFromHeaders(headers = {}) {
    return this.parseCookies(headers.cookie || "")[SESSION_COOKIE_NAME] || null;
  }

  userFromSessionToken(token) {
    if (!token) return null;
    const tokenHash = this.hashToken(token);
    const session = sessionStore.get(tokenHash);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessionStore.delete(tokenHash);
      return null;
    }
    return this.userForIdentity(session.username, session.role);
  }

  userFromHeaders(headers = {}) {
    const sessionUser = this.userFromSessionToken(this.sessionTokenFromHeaders(headers));
    if (sessionUser) return sessionUser;

    return this.authenticationEnabled ? null : this.anonymousUser();
  }

  hasRole(user, role) {
    if (role === "viewer") {
      return !this.authenticationEnabled || Boolean(user?.username);
    }
    return user?.role === "admin";
  }
}

const authService = new AuthService();

module.exports = authService;
module.exports.AuthService = AuthService;
module.exports.SESSION_COOKIE_NAME = SESSION_COOKIE_NAME;
module.exports.SESSION_TTL_MS = SESSION_TTL_MS;
