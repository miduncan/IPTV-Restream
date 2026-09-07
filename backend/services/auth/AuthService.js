require("dotenv").config();

/**
 * Maps the identity authenticated by Nginx to an application role.
 */
class AuthService {
  constructor() {
    this.CHANNEL_SELECTION_REQUIRES_ADMIN =
      process.env.CHANNEL_SELECTION_REQUIRES_ADMIN === "true";
  }

  /**
   * Check if channel selection needs admin
   * @returns {boolean}
   */
  channelSelectionRequiresAdmin() {
    return this.CHANNEL_SELECTION_REQUIRES_ADMIN;
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

  userFromHeaders(headers = {}) {
    return this.userForIdentity(
      headers["x-authenticated-user"],
      headers["x-authenticated-role"]
    );
  }

  hasRole(user, requiredRole) {
    if (requiredRole === "viewer") return Boolean(user?.username);
    if (requiredRole === "admin") return user?.role === "admin";
    return false;
  }
}

module.exports = new AuthService();
