require("dotenv").config();
const authService = require("../services/auth/AuthService");
const settingsService = require("../services/settings/SettingsService");

module.exports = {
  adminLogin(req, res) {
    if (!authService.isAdminEnabled()) {
      return res.status(403).json({
        success: false,
        message: "Admin mode is disabled on this server",
      });
    }

    const { password } = req.body;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required",
      });
    }

    if (authService.verifyAdminPassword(password)) {
      const token = authService.generateAdminToken();

      return res.json({
        success: true,
        token,
      });
    } else {
      return res.status(403).json({
        success: false,
        message: "Invalid password",
      });
    }
  },

  checkAdminStatus(req, res) {
    res.json({
      enabled: authService.isAdminEnabled(),
      channelSelectionRequiresAdmin: authService.channelSelectionRequiresAdmin(),
      streamSynchronizationEnabled: settingsService.shouldSynchronizePlayback(),
    });
  },

  verifyToken(req, res, next) {
    // If admin mode is disabled, allow all requests (skip authentication)
    if (!authService.isAdminEnabled()) {
      req.user = { isAdmin: false };
      return next();
    }

    // X-Admin-Authorization allows the outer Nginx Basic Auth gate to keep
    // ownership of the standard Authorization header. Keep the old header as
    // a fallback for clients that connect directly to the backend.
    const authorization =
      req.headers["x-admin-authorization"] || req.headers.authorization;
    const token = authorization?.split(" ")[1];

    if (!token) {
      return res.status(403).json({
        success: false,
        message: "Access denied. No token provided.",
      });
    }

    const decoded = authService.verifyToken(token);
    if (!decoded) {
      return res.status(403).json({
        success: false,
        message: "Invalid token.",
      });
    }

    req.user = decoded;
    next();
  },
};
