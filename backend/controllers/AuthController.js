const authService = require("../services/auth/AuthService");
const settingsService = require("../services/settings/SettingsService");
const {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} = require("../services/auth/AuthService");

function isSecureRequest(req) {
  return req.secure || req.headers["x-forwarded-proto"] === "https";
}

function sessionCookie(token, req) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isSecureRequest(req)) attributes.push("Secure");
  return attributes.join("; ");
}

function expiredSessionCookie(req) {
  const attributes = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Max-Age=0",
  ];
  if (isSecureRequest(req)) attributes.push("Secure");
  return attributes.join("; ");
}

module.exports = {
  attachUser(req, _res, next) {
    req.user = authService.userFromHeaders(req.headers);
    next();
  },

  requireSameOrigin(req, res, next) {
    const origin = req.headers.origin;
    if (!origin) return next();
    const protocol = req.headers["x-forwarded-proto"] || req.protocol || "http";
    const expectedOrigin = `${protocol}://${req.headers.host}`;
    if (origin === expectedOrigin || origin === process.env.CORS_ORIGIN) return next();
    return res.status(403).json({ message: "Cross-origin request rejected." });
  },

  login(req, res) {
    if (!authService.isAuthenticationEnabled()) {
      return res.status(503).json({
        message: "Authentication credentials are not configured on the backend.",
      });
    }

    const { username, password } = req.body || {};
    const user = authService.authenticateCredentials(username, password);
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password." });
    }

    const token = authService.createSession(user);
    res.setHeader("Set-Cookie", sessionCookie(token, req));
    res.setHeader("Cache-Control", "no-store");
    return res.json({ user });
  },

  logout(req, res) {
    authService.destroySession(authService.sessionTokenFromHeaders(req.headers));
    res.setHeader("Set-Cookie", expiredSessionCookie(req));
    res.setHeader("Cache-Control", "no-store");
    return res.status(204).send();
  },

  checkAdminStatus(req, res) {
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      username: req.user.username,
      role: req.user.role,
      isAdmin: req.user.isAdmin,
      channelSelectionRequiresAdmin: authService.channelSelectionRequiresAdmin(),
      streamSynchronizationEnabled: settingsService.shouldSynchronizePlayback(),
    });
  },

  verifySession(_req, res) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(204).send();
  },

  requireAuthenticated(req, res, next) {
    if (!authService.hasRole(req.user, "viewer")) {
      return res.status(401).json({ message: "Authentication required." });
    }
    next();
  },

  requireAdmin(req, res, next) {
    if (!authService.hasRole(req.user, "admin")) {
      return res.status(403).json({
        success: false,
        message: "Admin access required.",
      });
    }
    next();
  },
};
