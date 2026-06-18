import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { env } from './config/env';
import { initSocket } from './socket';
import { errorHandler } from './middleware/errorHandler';

// Route imports
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import groupRoutes from './routes/groups';
import subjectRoutes from './routes/subjects';
import scheduleRoutes from './routes/schedule';
import attendanceRoutes from './routes/attendance';
import reportRoutes from './routes/reports';
import notificationRoutes from './routes/notifications';

// ─── Express App ─────────────────────────────────────────────────────────────
const app = express();
const httpServer = createServer(app);

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' })); // Mobile apps don't use CORS, so allow all
app.use(express.json({ limit: '10mb' })); // Generous limit for attendance payloads

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/notifications', notificationRoutes);

// ─── Error Handler ───────────────────────────────────────────────────────────
app.use(errorHandler);

// ─── Socket.io ───────────────────────────────────────────────────────────────
initSocket(httpServer);

// ─── Start Server ────────────────────────────────────────────────────────────
httpServer.listen(env.PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════╗
  ║   🚀 Presnt Backend running on port ${env.PORT}    ║
  ║   📡 WebSocket server ready                  ║
  ║   🔗 http://localhost:${env.PORT}                  ║
  ╚══════════════════════════════════════════════╝
  `);
});

export default app;
