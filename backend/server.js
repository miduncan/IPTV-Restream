const express = require('express');
const dotenv = require('dotenv');
const { Server } = require('socket.io');

const ChatSocketHandler = require('./socket/ChatSocketHandler');
const ChannelSocketHandler = require('./socket/ChannelSocketHandler');
const PlaylistSocketHandler = require('./socket/PlaylistSocketHandler');
const socketRoleMiddleware = require('./socket/middleware/roles');
const authService = require('./services/auth/AuthService');

const proxyController = require('./controllers/ProxyController');
const centralChannelController = require('./controllers/CentralChannelController');
const channelController = require('./controllers/ChannelController');
const authController = require('./controllers/AuthController');
const adminSettingsController = require('./controllers/AdminSettingsController');
const adminChannelController = require('./controllers/AdminChannelController');
const epgController = require('./controllers/EpgController');
const streamController = require('./services/restream/StreamController');
const RestreamIdleManager = require('./services/restream/RestreamIdleManager');
const ChannelService = require('./services/ChannelService');
const PlaylistUpdater = require('./services/PlaylistUpdater');

dotenv.config();

const app = express();
app.use(express.json());

function isAllowedSocketOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host || origin === process.env.CORS_ORIGIN;
  } catch {
    return false;
  }
}

function isAuthenticatedSocketRequest(req) {
  const user = authService.userFromHeaders(req.headers);
  return authService.hasRole(user, 'viewer');
}

// CORS middleware
app.use((req, res, next) => {
  const allowedOrigin = process.env.CORS_ORIGIN;
  if (allowedOrigin && req.headers.origin === allowedOrigin) {
    res.header('Access-Control-Allow-Origin', allowedOrigin);
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(authController.attachUser);

// Auth routes
const authRouter = express.Router();
authRouter.post('/login', authController.requireSameOrigin, authController.login);
authRouter.post('/logout', authController.requireSameOrigin, authController.logout);
authRouter.get('/admin-status', authController.requireAuthenticated, authController.checkAdminStatus);
authRouter.get('/verify', authController.requireAuthenticated, authController.verifySession);

app.use('/api/auth', authRouter);
app.use('/api', authController.requireAuthenticated);
app.use('/api', authController.requireSameOrigin);

// Admin settings routes
const adminRouter = express.Router();
adminRouter.use(authController.requireAdmin);
adminRouter.get('/settings', adminSettingsController.list);
adminRouter.put('/settings', adminSettingsController.replace);
adminRouter.get('/channels', adminChannelController.list);
adminRouter.post('/channels', adminChannelController.add);
adminRouter.delete('/channels/:channelId', adminChannelController.remove);
adminRouter.delete('/epg-cache', epgController.clear);
app.use('/api/admin', adminRouter);

// Channel routes
const apiRouter = express.Router();
apiRouter.get('/', channelController.getChannels);
apiRouter.get('/current', channelController.getCurrentChannel);
apiRouter.delete('/clear', authController.requireAdmin, channelController.clearChannels);
apiRouter.get('/playlist', centralChannelController.playlist);
apiRouter.get('/epg', epgController.list);
apiRouter.get('/:channelId', channelController.getChannel);
// Protected routes
apiRouter.delete('/:channelId', authController.requireAdmin, channelController.deleteChannel);
apiRouter.put('/:channelId', authController.requireAdmin, channelController.updateChannel);
apiRouter.post('/', authController.requireAdmin, channelController.addChannel);
app.use('/api/channels', apiRouter);

const proxyRouter = express.Router();
proxyRouter.use(authController.requireAuthenticated);
proxyRouter.get('/channel', proxyController.channel);
proxyRouter.get('/segment', proxyController.segment);
proxyRouter.get('/key', proxyController.key);
proxyRouter.get('/current', centralChannelController.currentChannel);
app.use('/proxy', proxyRouter);


const PORT = 5000;
const restreamIdleManager = new RestreamIdleManager({
  getCurrentChannel: () => ChannelService.getCurrentChannel(),
  streamController,
});
streamController.setStartAllowed(() => restreamIdleManager.isStreamingAllowed());

const server = app.listen(PORT, () => {
  console.log(`Server listening on Port ${PORT}`);
  PlaylistUpdater.startScheduler();
  PlaylistUpdater.registerChannelsPlaylist(ChannelService.getChannels());
});


// Web Sockets with explicit CORS configuration
const io = new Server(server, {
  allowRequest: (req, callback) => callback(
    null,
    isAllowedSocketOrigin(req) && isAuthenticatedSocketRequest(req)
  ),
  cors: {
    origin: process.env.CORS_ORIGIN || false,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  },
});
app.set('io', io);

io.use(socketRoleMiddleware);

const connectedUsers = {};

io.on('connection', socket => {
  console.log('New client connected');
  restreamIdleManager.viewerConnected(socket.id);

  socket.on('new-user', userId => {
    connectedUsers[socket.id] = userId;
    socket.broadcast.emit('user-connected', userId);
  })

  socket.on('disconnect', () => {
    restreamIdleManager.viewerDisconnected(socket.id);
    socket.broadcast.emit('user-disconnected', connectedUsers[socket.id]);
    delete connectedUsers[socket.id];
  })

  ChannelSocketHandler(io, socket);
  PlaylistSocketHandler(io, socket);
  ChatSocketHandler(io, socket);
})
