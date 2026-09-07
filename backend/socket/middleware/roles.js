const authService = require("../../services/auth/AuthService");

/** Attach the Nginx-authenticated user and application role to each socket. */
function socketRoleMiddleware(socket, next) {
  socket.user = authService.userFromHeaders(socket.handshake.headers);
  next();
}

module.exports = socketRoleMiddleware;
