require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const authRoutes = require('./routes/auth');
const channelRoutes = require('./routes/channels');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const webhookRoutes = require('./routes/webhooks');
const analyticsRoutes = require('./routes/analytics');
const agentRoutes = require('./routes/agents');
const tagRoutes = require('./routes/tags');
const { setIo } = require('./services/socket.service');
const { startWorker } = require('./services/queue.service');
const { processLineEvent } = require('./services/line.service');

const prisma = new PrismaClient();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

setIo(io);

// If REDIS_URL is set, attach the Redis adapter so multiple Railway replicas
// share Socket.io room broadcasts (required for safe horizontal scaling).
// Without it, Socket.io just uses in-memory state — fine for a single replica.
if (process.env.REDIS_URL) {
  (async () => {
    try {
      const { createAdapter } = require('@socket.io/redis-adapter');
      const { createClient } = require('redis');
      const pubClient = createClient({ url: process.env.REDIS_URL });
      const subClient = pubClient.duplicate();
      await Promise.all([pubClient.connect(), subClient.connect()]);
      io.adapter(createAdapter(pubClient, subClient));
      console.log('Socket.io: using Redis adapter (safe for multiple replicas)');
    } catch (err) {
      console.error('Socket.io Redis adapter failed to start, falling back to in-memory:', err.message);
    }
  })();
}

// Start the webhook queue worker: looks up the channel for each queued event
// and hands it to the same processing logic that used to run inline.
startWorker(async (channelId, event) => {
  const channel = await prisma.lineChannel.findUnique({ where: { id: channelId } });
  if (!channel) return;
  await processLineEvent(channel, event);
});

app.use(cors());
// Raw body for LINE signature verification (must come before express.json)
app.use('/api/webhooks/line', express.raw({ type: 'application/json' }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/tags', tagRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Serve frontend static files (production)
const path = require('path');
const fs = require('fs');
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// Socket.io
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('join', (conversationId) => socket.join(conversationId));
  socket.on('leave', (conversationId) => socket.leave(conversationId));
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
