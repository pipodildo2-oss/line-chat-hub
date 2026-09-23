require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
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
const upsellRoutes = require('./routes/upsells');
const approvedLinkRoutes = require('./routes/approvedLinks');
const settingsRoutes = require('./routes/settings');
const telegramReportRoutes = require('./routes/telegramReport');
const { UPLOAD_DIR } = require('./lib/imageStorage');
const { setIo } = require('./services/socket.service');
const { startWorker } = require('./services/queue.service');
const { processLineEvent } = require('./services/line.service');
const { startTelegramReportScheduler } = require('./lib/telegramScheduler');
const { verifyAgentToken } = require('./middleware/auth');
const { canAccessChannel } = require('./lib/conversationQuery');

const prisma = new PrismaClient();
const app = express();

// Railway sits in front of the app behind a proxy (Hikari). Trusting it means
// req.ip reflects the real visitor IP instead of the proxy's — needed for
// rate limiting (below) to key off the right client instead of blocking everyone at once.
app.set('trust proxy', 1);

// Sets X-Frame-Options, X-Content-Type-Options, a Referrer-Policy, HSTS, etc.
// on every response — this app had NONE of these before, meaning it could be
// embedded in a hidden/disguised iframe on any other site (clickjacking) and
// tricked into e.g. sending a broadcast or deleting a channel via a click the
// logged-in agent never intended. contentSecurityPolicy is explicitly
// disabled here rather than left at helmet's default: a default CSP is
// notorious for silently breaking an existing app (blocking the very scripts/
// styles/connections — including this app's own Socket.io traffic — it
// doesn't already have an allowlist for), and getting that allowlist right
// needs deliberate testing rather than being turned on blind. The headers
// enabled here (frame/clickjacking protection, MIME-sniffing protection,
// HSTS) carry no such risk — they only restrict how OTHER sites can embed or
// misuse responses FROM this app, not what this app itself is allowed to load.
app.use(helmet({ contentSecurityPolicy: false }));

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
  // IMPORTANT: callback(null, false) — NOT callback(new Error(...)). Passing
  // an Error here makes the `cors` middleware call next(err), which Express's
  // default error handler turns into a 500 for the ENTIRE request before it
  // ever reaches a route — this took the whole app down in production the
  // first time, because the real deployed origin (Railway's domain) was
  // never added to allowedOrigins/FRONTEND_URL, so EVERY request got
  // rejected outright, not just genuinely cross-origin ones.
  // callback(null, false) just skips adding the Access-Control-Allow-Origin
  // response header — which only matters to the browser for a truly
  // cross-origin request; a same-origin request (the production frontend
  // served from this same backend) is completely unaffected either way,
  // since the browser never consults that header for same-origin fetches.
  callback(null, false);
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: corsOriginCheck, methods: ['GET', 'POST'] },
});

setIo(io);

// Socket.io had NO authentication at all — any anonymous client (no login,
// no browser even required) could open a connection, emit 'join' with any
// conversationId it wanted, and silently receive that conversation's live
// 'new_message' events forever, completely bypassing the channel-visibility
// restrictions the REST API enforces. This middleware runs during the
// handshake, before 'connection' fires: the frontend sends its JWT via
// `io('/', { auth: { token } })` (see SocketContext.jsx), and any socket that
// doesn't present a currently-valid one is rejected before it ever connects.
io.use(async (socket, next) => {
  try {
    const agent = await verifyAgentToken(socket.handshake.auth?.token);
    if (!agent) return next(new Error('unauthorized'));
    socket.agent = agent;
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

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

// Monthly "คะแนนอัพเซลล์" Telegram notification — see
// lib/telegramScheduler.js for why this is a plain setInterval rather than
// a BullMQ repeatable job. No-op every check until an admin actually
// enables it in Settings > "ระบบ".
startTelegramReportScheduler();

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
app.use('/api/upsells', upsellRoutes);
app.use('/api/approved-links', approvedLinkRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/settings/telegram', telegramReportRoutes);

// Serves agent-attached chat images and quick-reply images saved by
// imageStorage.saveBase64Image (see backend/src/lib/imageStorage.js). Must be
// registered before the SPA catch-all below, and intentionally has no `auth`
// middleware — LINE's own servers fetch these URLs directly.
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d' }));
// A stored file that isn't on disk must answer 404 here, not fall through to
// the SPA catch-all at the bottom of this file.
//
// Without this, express.static calls next() for a miss and the catch-all
// happily returns index.html with 200 OK and Content-Type: text/html. An <img>
// then receives a successful response full of HTML, fails to decode it, and
// renders as a broken image — while the access log records a clean 200. That
// combination is why missing images were effectively undebuggable from the
// server side: every investigation kept concluding "no 404s anywhere, the
// server is fine" when the 404s were real and being disguised as successes.
// It also lets a browser cache the HTML under the image's own url.
app.use('/uploads', (req, res) => res.status(404).end());

// Checks the process is alive AND can actually reach the database — a plain
// "process is running" check can stay green while the DB connection is dead.
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    // This endpoint is deliberately unauthenticated (a monitor/load-balancer
    // needs to hit it without a login) — so unlike an authenticated route,
    // the raw error can't be shown here at all. A Postgres connection error
    // typically includes the DB host/port, which is internal infra detail
    // that has no business reaching an anonymous caller. Full detail still
    // goes to the server log for whoever's actually debugging the outage.
    console.error('Health check failed:', err.message);
    res.status(503).json({ status: 'degraded', db: 'unreachable' });
  }
});

// Serve frontend static files (production)
const path = require('path');
const fs = require('fs');
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    // Only real navigations get the SPA shell. A request for something that
    // looks like a file (anything with an extension) which express.static
    // above couldn't find is a genuine 404, and answering it with index.html
    // and a 200 makes a missing asset indistinguishable from a working one —
    // see the /uploads guard above for how long that cost us on missing
    // images. A client-side route like /upsell/review has no extension and
    // still gets the shell, which is the whole point of this handler.
    if (path.extname(req.path)) return res.status(404).end();
    res.sendFile(path.join(distPath, 'index.html'));
  });
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

// Socket.io — every socket reaching here has already passed the io.use()
// handshake check above, so socket.agent is always a real, currently-valid
// agent record.
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id, 'agent:', socket.agent.id);
  // Joining a conversation's room is what actually grants access to its live
  // 'new_message' events (see socket.service.js's emitToConversation) — the
  // handshake check above only proves the caller is SOME logged-in agent, not
  // that they're allowed to see THIS conversation. A channel-restricted agent
  // must be blocked from joining a room for a conversation outside their
  // assigned channels, the same way the REST routes already check
  // canAccessChannel() before returning conversation-scoped data.
  socket.on('join', async (conversationId) => {
    if (typeof conversationId !== 'string' || !conversationId) return;
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { channelId: true },
      });
      if (!conversation) return;
      if (!(await canAccessChannel(socket.agent, conversation.channelId))) return;
      socket.join(conversationId);
    } catch (err) {
      console.error('socket join failed:', err.message);
    }
  });
  socket.on('leave', (conversationId) => socket.leave(conversationId));
  // Broadcast to every OTHER connected agent (not room-scoped, since an agent's
  // conversation list shows many conversations at once, not just the open one)
  // so a typing indicator can show up on the list itself — that's what actually
  // helps prevent two agents replying to the same customer at once. Uses
  // socket.agent.name (from the verified handshake) instead of trusting
  // whatever agentName the client claims — otherwise any logged-in agent could
  // broadcast a typing indicator under a co-worker's name.
  socket.on('typing', ({ conversationId }) => {
    if (!conversationId) return;
    socket.broadcast.emit('agent_typing', { conversationId, agentName: socket.agent.name });
  });
  socket.on('disconnect', () => console.log('Client disconnected:', socket.id));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  // Fire-and-forget, only AFTER the server is already listening — this used
  // to run inline in prisma/seed.js (which blocks this very listen() call
  // from ever happening) and once took the whole app down when a LINE API
  // call it made hung with no timeout: seed.js never finished, so
  // `node src/index.js` never even started. Kept here now specifically so a
  // bug in this background task can never again stop the app from serving
  // real traffic. See imageBackfill.js's own comment for the full story.
  require('../src/lib/imageBackfill').backfillMissingImageStorage()
    // Always logged, including the all-zero case: "the sweep found nothing to
    // do" and "the sweep never ran" used to look identical in the deploy logs
    // (both printed nothing at all), which made it impossible to tell whether
    // a blank-image report meant the recovery was still catching up or had
    // quietly no-opped.
    .then(({ scanned, recovered, expired, retryable }) => {
      console.log(`Image recovery finished: scanned ${scanned}, recovered ${recovered} into permanent storage, ${expired} already expired on LINE's side (marked, won't be retried), ${retryable} to retry next start.`);
    })
    .then(() => require('../src/lib/storageHealth').checkStorageHealth())
    .catch(err => console.error('Image backfill failed:', err.message));

  // Detach already-sent quick-reply images from the template they came from,
  // so editing or deleting a quick reply can't keep erasing sent history —
  // see quickReplyImageOwnership.js. Runs before the audit below so the audit
  // reports the state after the repair, not before it.
  require('../src/lib/quickReplyImageOwnership').giveQuickReplyImagesToTheirMessages()
    .then(({ scanned, adopted, quickReplyGone, imageGone, fileMissing }) => {
      console.log(`Quick-reply image ownership: scanned ${scanned}, gave ${adopted} message(s) their own copy reference, ${quickReplyGone} whose quick reply is already deleted, ${imageGone} whose image slot is gone, ${fileMissing} whose file is already off disk.`);
      // Read-only; see storageAudit.js for why this exists. Same fire-and-forget
      // placement as the recovery sweep above, for the same reason — nothing
      // that touches the filesystem or the database on a schedule belongs
      // anywhere it could delay the server starting.
      return require('../src/lib/storageAudit').auditImageStorage();
    })
    // Same picture as the ตรวจสอบ page, per submitting agent — which is what
    // gets asked for when a broken thumbnail is reported, and answering it by
    // opening each agent in the UI one at a time both misses submissions and
    // can't tell the two causes apart. See upsellImageReport.js.
    .then(() => require('../src/lib/upsellImageReport').reportUpsellImageHealth())
    // Settles whether claiming a message for an upsell is what makes its image
    // disappear — see imageLossAnalysis.js. Compares claimed against never-
    // claimed images directly rather than reasoning from the claimed ones
    // alone, which are the only ones anyone looks at twice.
    .then(() => require('../src/lib/imageLossAnalysis').analyseImageLoss())
    // Also on startup, not only on the six-hourly timer. Waiting a full cycle
    // to find out whether object storage is even reachable is no way to verify
    // a change — the first run should happen while someone is still watching
    // the deploy. It archives one modest batch and is harmless to repeat:
    // anything already archived is skipped, and nothing is deleted unless
    // ARCHIVE_DELETE_LOCAL says so.
    .then(() => require('../src/lib/imageArchive').archiveOldImages())
    .catch(err => console.error('Quick-reply image ownership repair failed:', err.message));

  // Storing a customer's image at ingestion is deliberately best-effort — a
  // failure there must never stop the message itself being recorded (see
  // line.service.js) — so a disk hiccup, a slow LINE response or a restart
  // mid-download leaves a message with no local copy. Until now the only thing
  // that ever retried those was a deploy. Nothing guarantees a deploy happens
  // inside LINE's ~2 week retention window, and once that passes the image is
  // gone for good: exactly how the first ~47,000 were lost.
  //
  // So the recovery sweep also runs on a timer. Repeat runs are cheap because
  // anything already stored, or confirmed gone, is skipped outright — a full
  // 91,000-message pass takes about five seconds and makes zero LINE calls
  // when there is nothing new to fetch. The storage check rides along so
  // filling the volume can't creep up unnoticed between deploys either.
  const MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
  setInterval(() => {
    require('../src/lib/imageBackfill').backfillMissingImageStorage()
      .then(({ scanned, recovered, expired, retryable }) => {
        // Only worth a line when it actually did something; a quiet no-op every
        // six hours would just bury the runs that matter.
        if (recovered > 0 || expired > 0 || retryable > 0) {
          console.log(`Image recovery (scheduled): scanned ${scanned}, recovered ${recovered}, expired on LINE ${expired}, will retry ${retryable}.`);
        }
      })
      .catch(err => console.error('Scheduled image recovery failed:', err.message))
      // Moves images past the retention window to R2 — see imageArchive.js.
      // Does nothing at all until the R2 credentials are set, and even then
      // only ADDS a copy until ARCHIVE_DELETE_LOCAL is turned on separately.
      // Runs in modest batches rather than all at once: there's no deadline,
      // and it shares this volume with live traffic.
      .then(() => require('../src/lib/imageArchive').archiveOldImages())
      .catch(err => console.error('Scheduled image archive failed:', err.message))
      .then(() => require('../src/lib/storageHealth').checkStorageHealth())
      .catch(err => console.error('Scheduled storage health check failed:', err.message));
  }, MAINTENANCE_INTERVAL_MS).unref();
});

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
