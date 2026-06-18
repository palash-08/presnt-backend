import { Server as SocketServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';

let io: SocketServer;

/**
 * Initialize Socket.io server.
 * Authenticates connections via JWT token in the handshake query.
 */
export function initSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: '*', // Mobile apps don't have CORS restrictions, but allow all for dev
      methods: ['GET', 'POST'],
    },
  });

  // ─── Authentication middleware ─────────────────────────────────────
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token as string, env.JWT_SECRET) as { userId: string };
      (socket as any).userId = decoded.userId;
      next();
    } catch (err) {
      return next(new Error('Invalid token'));
    }
  });

  // ─── Connection handler ────────────────────────────────────────────
  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId;
    console.log(`🔌 User connected: ${userId} (socket: ${socket.id})`);

    // Join user's personal notification room
    socket.on('join-user', (uid: string) => {
      socket.join(`user:${uid}`);
    });

    // Join a group room (for real-time group events)
    socket.on('join-group', (groupId: string) => {
      socket.join(`group:${groupId}`);
    });

    // Leave a group room
    socket.on('leave-group', (groupId: string) => {
      socket.leave(`group:${groupId}`);
    });

    socket.on('disconnect', () => {
      console.log(`🔌 User disconnected: ${userId}`);
    });
  });

  return io;
}

/**
 * Get the Socket.io instance. Used by route handlers to emit events.
 *
 * Example usage in a route:
 *   getIO().to(`group:${groupId}`).emit('subjects-updated', { groupId });
 */
export function getIO(): SocketServer {
  if (!io) {
    throw new Error('Socket.io has not been initialized. Call initSocket() first.');
  }
  return io;
}
