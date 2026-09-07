const express = require('express');
const dotenv = require('dotenv');
const { Server } = require('socket.io');

const ChatSocketHandler = require('./socket/ChatSocketHandler');
const ChannelSocketHandler = require('./socket/ChannelSocketHandler');
const PlaylistSocketHandler = require('./socket/PlaylistSocketHandler');
const socketRoleMiddleware = require('./socket/middleware/roles');

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

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(authController.attachUser);

// Auth routes
const authRouter = express.Router();
authRouter.get('/admin-status', authController.checkAdminStatus);

app.use('/api/auth', authRouter);

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
  cors: {
    origin: "*", // Allow any origin in development
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
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
