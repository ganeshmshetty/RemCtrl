import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';

let PORT = Number(process.env.PORT || 3001);
if (isNaN(PORT) || PORT === 0) {
  PORT = 3001;
}
const PIN_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface Room {
  pin: string;
  hostSocketId: string;
  controllerSocketId: string | null;
  createdAt: number;
  ttlTimer: ReturnType<typeof setTimeout>;
}

const rooms = new Map<string, Room>();
const socketToPin = new Map<string, string>();

// ─── Server Setup ─────────────────────────────────────────────────────────────

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
    // credentials omitted: incompatible with wildcard origin, and not needed
    // (no cookies/auth headers are used — sessions are PIN-based)
  },
  transports: ['websocket'], // Force WebSocket to avoid XHR polling issues
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

// ─── Room Helpers ─────────────────────────────────────────────────────────────

function deleteRoom(pin: string, reason = 'Session expired') {
  const room = rooms.get(pin);
  if (!room) return;
  clearTimeout(room.ttlTimer);
  if (room.controllerSocketId) {
    io.to(room.controllerSocketId).emit('room:error', { message: reason });
    socketToPin.delete(room.controllerSocketId);
  }
  socketToPin.delete(room.hostSocketId);
  io.in(pin).socketsLeave(pin);
  rooms.delete(pin);
  console.log(`[server] Room ${pin} deleted — ${reason}`);
}

// ─── Socket Handlers ──────────────────────────────────────────────────────────

io.on('connection', (socket: Socket) => {
  console.log(`[server] Connected: ${socket.id}`);

  // ── Host: register PIN ──────────────────────────────────────────────────
  socket.on('host:register', (payload: { pin: string }, ack: (r: object) => void) => {
    const { pin } = payload ?? {};
    if (!pin || !/^\d{9}$/.test(pin)) {
      return ack({ success: false, error: 'Invalid PIN format' });
    }
    if (rooms.has(pin)) {
      return ack({ success: false, error: 'PIN already in use, try again' });
    }

    const ttlTimer = setTimeout(() => deleteRoom(pin), PIN_TTL_MS);
    rooms.set(pin, {
      pin,
      hostSocketId: socket.id,
      controllerSocketId: null,
      createdAt: Date.now(),
      ttlTimer,
    });
    socketToPin.set(socket.id, pin);

    socket.join(pin);
    console.log(`[server] Host ${socket.id} registered PIN ${pin}`);
    ack({ success: true });
  });

  // ── Controller: join PIN room ───────────────────────────────────────────
  socket.on('controller:join', (payload: { pin: string }, ack: (r: object) => void) => {
    const { pin } = payload ?? {};
    const room = rooms.get(pin);

    if (!room) return ack({ success: false, error: 'Session not found or expired' });
    if (room.controllerSocketId) return ack({ success: false, error: 'Session already has a controller' });

    room.controllerSocketId = socket.id;
    socketToPin.set(socket.id, pin);
    socket.join(pin);

    // Notify host
    io.to(room.hostSocketId).emit('controller:joined', { controllerId: socket.id });
    console.log(`[server] Controller ${socket.id} joined room ${pin}`);
    ack({ success: true, controllerId: socket.id });
  });

  // ── Host: approve controller ────────────────────────────────────────────
  socket.on('host:approve', (payload: { controllerId: string }) => {
    const { controllerId } = payload ?? {};
    io.to(controllerId).emit('host:approved');
    console.log(`[server] Host approved ${controllerId}`);
  });

  // ── Host: reject controller ─────────────────────────────────────────────
  socket.on('host:reject', (payload: { controllerId: string }) => {
    const { controllerId } = payload ?? {};
    io.to(controllerId).emit('host:rejected');
    
    // O(1) removal using socketToPin
    const pin = socketToPin.get(controllerId);
    if (pin) {
      const room = rooms.get(pin);
      if (room && room.controllerSocketId === controllerId) {
        room.controllerSocketId = null;
        socketToPin.delete(controllerId);
      }
    }
    
    console.log(`[server] Host rejected ${controllerId}`);
  });

  // ── WebRTC signal relay ─────────────────────────────────────────────────
  socket.on('webrtc:signal', (payload: { sender: string; signal: unknown }) => {
    const pin = socketToPin.get(socket.id);
    if (!pin) return;
    
    const room = rooms.get(pin);
    if (!room) return;

    if (room.hostSocketId === socket.id && room.controllerSocketId) {
      io.to(room.controllerSocketId).emit('webrtc:signal', payload);
    } else if (room.controllerSocketId === socket.id) {
      io.to(room.hostSocketId).emit('webrtc:signal', payload);
    }
  });

  // ── Disconnect cleanup ──────────────────────────────────────────────────
  socket.on('disconnect', () => {
    console.log(`[server] Disconnected: ${socket.id}`);
    
    const pin = socketToPin.get(socket.id);
    if (!pin) return;
    
    const room = rooms.get(pin);
    if (!room) return;

    if (room.hostSocketId === socket.id) {
      // Host left — kill the room, notify controller
      if (room.controllerSocketId) {
        io.to(room.controllerSocketId).emit('peer:disconnected');
        socketToPin.delete(room.controllerSocketId);
      }
      socketToPin.delete(socket.id);
      deleteRoom(pin, 'Host disconnected');
    } else if (room.controllerSocketId === socket.id) {
      // Controller left — notify host, keep room alive
      room.controllerSocketId = null;
      socketToPin.delete(socket.id);
      io.to(room.hostSocketId).emit('peer:disconnected');
      console.log(`[server] Controller left room ${pin}`);
    }
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[server] RemoteCtrl signaling server running on port ${PORT}`);
});
