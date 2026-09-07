const authService = require("../../services/auth/AuthService");

/** Attach the Nginx-authenticated user and application role to each socket. */
function socketRoleMiddleware(socket, next) {
  socket.user = authService.userFromHeaders(socket.handshake.headers);
  if (!authService.hasRole(socket.user, "viewer")) {
    return next(new Error("Authentication required."));
  }
  next();
}

module.exports = socketRoleMiddleware;
