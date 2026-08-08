require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const channelRoutes = require('./routes/channels');
const conversationRoutes = require('./routes/conversations');
const messageRoutes = require('./routes/messages');
const webhookRoutes = require('./routes/webhooks');
const analyticsRoutes = require('./routes/analytics');
const agentRoutes = require('./routes/agents');
const { setIo } = require('./services/socket.service');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

setIo(io);

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

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// TEMPORARY: create/reset admin user via HTTP
app.post('/api/setup-admin', async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client');
    const bcrypt = require('bcryptjs');
    const prisma = new PrismaClient();
    const password = await bcrypt.hash('admin1234', 10);
    const agent = await prisma.agent.upsert({
      where: { email: 'admin@example.com' },
      update: { password },
      create: { name: 'Admin', email: 'admin@example.com', password, role: 'admin' },
    });
    await prisma.$disconnect();
    res.json({ success: true, email: agent.email, message: 'Admin user created/reset. Login: admin@example.com / admin1234' });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
