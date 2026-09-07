require("dotenv").config();
const authService = require("../services/auth/AuthService");
const settingsService = require("../services/settings/SettingsService");

module.exports = {
  attachUser(req, _res, next) {
    req.user = authService.userFromHeaders(req.headers);
    next();
  },

  checkAdminStatus(req, res) {
    res.json({
      username: req.user.username,
      role: req.user.role,
      isAdmin: req.user.isAdmin,
      channelSelectionRequiresAdmin: authService.channelSelectionRequiresAdmin(),
      streamSynchronizationEnabled: settingsService.shouldSynchronizePlayback(),
    });
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
