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

// Railway sits in front of the app behind a proxy (Hikari). Trusting it means
// req.ip reflects the real visitor IP instead of the proxy's — needed for
// rate limiting (below) to key off the right client instead of blocking everyone at once.
app.set('trust proxy', 1);

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
const worker = startWorker(async (channelId, event) => {
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

// Checks the process is alive AND can actually reach the database — a plain
// "process is running" check can stay green while the DB connection is dead.
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', db: 'unreachable', error: err.message });
  }
});

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

// Graceful shutdown: when Railway redeploys, it sends SIGTERM before killing the
// process. Without this, in-flight HTTP requests and the queue worker get cut
// off mid-work. Draining them first means a redeploy doesn't drop customer messages.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);
  const timeout = setTimeout(() => {
    console.warn('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10000);

  try {
    if (worker) await worker.close();
    await new Promise((resolve) => httpServer.close(resolve));
    await prisma.$disconnect();
    clearTimeout(timeout);
    console.log('Shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err.message);
    process.exit(1);
  }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
