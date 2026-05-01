// server.js — SmartQ Phase 4: AI-enhanced
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const cors     = require('cors');
require('dotenv').config();

const app    = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || 'http://localhost:3000',
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  },
});
app.set('io', io);

app.use(cors({ origin: process.env.CLIENT_URL || 'http://localhost:3000' }));
app.use(express.json());

// ── MongoDB ───────────────────────────────────────────────────────
mongoose
  .connect(process.env.MONGO_URI || 'mongodb://localhost:27017/smartq')
  .then(async () => {
    console.log('✅ MongoDB connected');

    // ── Phase 4: Initialise AI modules after DB is ready ─────────
    const { trainAll: trainWait, scheduleNightlyRetrain } = require('./ai/waitTimePredictor');
    const { trainAll: trainNoShow }                       = require('./ai/noShowPredictor');
    const { startMonitor }                                = require('./ai/congestionMonitor');

    // Train models on startup (non-blocking)
    Promise.all([trainWait(), trainNoShow()])
      .then(() => console.log('🤖 AI models initialised'))
      .catch((err) => console.warn('⚠️  AI model init warning:', err.message));

    // Schedule nightly retraining
    scheduleNightlyRetrain();

    // Start congestion monitor (60 s interval)
    startMonitor(io, 60_000);
  })
  .catch((err) => console.error('❌ MongoDB error:', err.message));

// ── Routes ────────────────────────────────────────────────────────
app.use('/api/queue',    require('./routes/queueRoutes'));
app.use('/api/counters', require('./routes/counterRoutes'));
app.use('/api/domains',  require('./routes/domainRoutes'));
app.use('/api/auth',     require('./routes/authRoutes'));
app.use('/api/ai',       require('./routes/aiRoutes'));   // Phase 4

app.get('/', (req, res) => res.json({ message: 'SmartQ API Phase 4 🚀🤖' }));

// ── Socket.io Events ──────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on('join_domain', (domain) => {
    socket.join(domain);
    console.log(`📌 ${socket.id} joined room: ${domain}`);
  });

  socket.on('call_next', async ({ domain, counterId }) => {
    try {
      const queueController = require('./controllers/queueController');
      const result = await queueController.callNextToken(domain, counterId);
      if (result) {
        io.to(domain).emit('token_called', result);
        io.to(domain).emit('queue_updated');
      }
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('mark_served', async ({ domain, tokenId }) => {
    try {
      const queueController = require('./controllers/queueController');
      await queueController.markServed(tokenId);
      io.to(domain).emit('queue_updated');
    } catch (err) {
      socket.emit('error', { message: err.message });
    }
  });

  socket.on('disconnect', () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 SmartQ server running on http://localhost:${PORT}`);
});
