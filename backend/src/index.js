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
const quickReplyRoutes = require('./routes/quickReplies');
const channelCategoryRoutes = require('./routes/channelCategories');
const channelCategoryGroupRoutes = require('./routes/channelCategoryGroups');
const agentCategoryRoutes = require('./routes/agentCategories');
const reportRoutes = require('./routes/reports');
const broadcastRoutes = require('./routes/broadcasts');
const { UPLOAD_DIR } = require('./lib/imageStorage');
const { setIo } = require('./services/socket.service');
const { startWorker } = require('./services/queue.service');
const { processLineEvent } = require('./services/line.service');

const prisma = new PrismaClient();
const app = express();

// Railway sits in front of the app behind a proxy (Hikari). Trusting it means
// req.ip reflects the real visitor IP instead of the proxy's — needed for
// rate limiting (below) to key off the right client instead of blocking everyone at once.
app.set('trust proxy', 1);

// CORS was wide open (`origin: '*'`) on both the REST API and Socket.io —
// with the JWT sent via an Authorization header rather than a cookie, that
// didn't enable classic CSRF, but it meant zero defense-in-depth if a token
// ever leaked through some other channel (XSS, a log line, a referrer, etc.)
// — any page on the web could then read authenticated responses cross-origin.
// In production the frontend is served from THIS same backend (backend/dist,
// see the static-file block below), so real traffic is same-origin and never
// even hits this check — this only matters for local dev (frontend on a
// different Vite port) and FRONTEND_URL, for the rare case the frontend is
// ever deployed separately from this backend.
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
];
function corsOriginCheck(origin, callback) {
  // No Origin header = same-origin request, or a non-browser client (curl,
  // server-to-server) — neither is something CORS applies to anyway.
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  callback(new Error('Not allowed by CORS'));
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: corsOriginCheck, methods: ['GET', 'POST'] },
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

app.use(cors({ origin: corsOriginCheck }));
// Raw body for LINE signature verification (must come before express.json)
app.use('/api/webhooks/line', express.raw({ type: 'application/json' }));
// Default body limit (100kb) is too small once quick-reply images are base64-encoded
// into JSON — raised to cover LINE's own 10MB image message cap plus base64 overhead.
// 30mb (not 15mb) since a broadcast can carry up to 3 attached images in one request.
app.use(express.json({ limit: '30mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/channels', channelRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/webhooks', webhookRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/tags', tagRoutes);
app.use('/api/quick-replies', quickReplyRoutes);
app.use('/api/channel-categories', channelCategoryRoutes);
app.use('/api/channel-category-groups', channelCategoryGroupRoutes);
app.use('/api/agent-categories', agentCategoryRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/broadcasts', broadcastRoutes);

// Serves agent-attached chat images and quick-reply images saved by
// imageStorage.saveBase64Image (see backend/src/lib/imageStorage.js). Must be
// registered before the SPA catch-all below, and intentionally has no `auth`
// middleware — LINE's own servers fetch these URLs directly.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));

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

// Body-parser errors (e.g. payload too large, malformed JSON) otherwise reach the
// client as a bare non-JSON response, so axios can't read err.response.data.error
// and the UI just shows a generic "something went wrong" with no useful detail.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'ไฟล์ที่แนบใหญ่เกินไป (สูงสุด 15MB)' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'ข้อมูลที่ส่งไม่ถูกต้อง' });
  }
  next(err);
});

// Socket.io
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.on('join', (conversationId) => socket.join(conversationId));
  socket.on('leave', (conversationId) => socket.leave(conversationId));
  // Broadcast to every OTHER connected agent (not room-scoped, since an agent's
  // conversation list shows many conversations at once, not just the open one)
  // so a typing indicator can show up on the list itself — that's what actually
  // helps prevent two agents replying to the same customer at once.
  socket.on('typing', ({ conversationId, agentName }) => {
    if (!conversationId) return;
    socket.broadcast.emit('agent_typing', { conversationId, agentName });
  });
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
