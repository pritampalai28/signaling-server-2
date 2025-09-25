const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Store active rooms and users
const rooms = new Map();
const users = new Map();

// Basic health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'WebRTC Signaling Server is running!',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    connectedUsers: users.size,
    activeRooms: rooms.size
  });
});

// Get STUN/TURN server configuration
app.get('/api/ice-servers', (req, res) => {
  const iceServers = [
    {
      urls: 'stun:stun.l.google.com:19302'
    },
    {
      urls: 'stun:stun1.l.google.com:19302'
    },
    {
      urls: 'stun:stun2.l.google.com:19302'
    }
  ];

  // Add TURN server if credentials are provided
  if (process.env.TURN_SERVER_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({
      urls: process.env.TURN_SERVER_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL
    });
  }

  res.json({ iceServers });
});

// Get server stats
app.get('/api/stats', (req, res) => {
  res.json({
    connectedUsers: users.size,
    activeRooms: rooms.size,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    timestamp: new Date().toISOString()
  });
});

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Handle joining a room
  socket.on('join-room', (roomId, userId) => {
    console.log(`User ${userId} joining room ${roomId}`);
    
    socket.join(roomId);
    users.set(socket.id, { userId, roomId });

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    const room = rooms.get(roomId);
    room.add(socket.id);

    // Notify others in the room that a new user joined
    socket.to(roomId).emit('user-joined', userId);

    // Send current users in the room to the new user
    const otherUsers = Array.from(room)
      .filter(id => id !== socket.id)
      .map(id => users.get(id)?.userId)
      .filter(Boolean);

    socket.emit('users-in-room', otherUsers);
    console.log(`Room ${roomId} now has ${room.size} users`);
  });

  // Handle WebRTC offer
  socket.on('offer', (data) => {
    const { targetUserId, offer } = data;
    const sender = users.get(socket.id);
    
    if (sender) {
      // Find the target user's socket
      const targetSocket = findSocketByUserId(targetUserId, sender.roomId);
      if (targetSocket) {
        io.to(targetSocket).emit('offer', {
          offer,
          callerUserId: sender.userId
        });
        console.log(`Offer sent from ${sender.userId} to ${targetUserId}`);
      }
    }
  });

  // Handle WebRTC answer
  socket.on('answer', (data) => {
    const { targetUserId, answer } = data;
    const sender = users.get(socket.id);
    
    if (sender) {
      const targetSocket = findSocketByUserId(targetUserId, sender.roomId);
      if (targetSocket) {
        io.to(targetSocket).emit('answer', {
          answer,
          answererUserId: sender.userId
        });
        console.log(`Answer sent from ${sender.userId} to ${targetUserId}`);
      }
    }
  });

  // Handle ICE candidates
  socket.on('ice-candidate', (data) => {
    const { targetUserId, candidate } = data;
    const sender = users.get(socket.id);
    
    if (sender) {
      const targetSocket = findSocketByUserId(targetUserId, sender.roomId);
      if (targetSocket) {
        io.to(targetSocket).emit('ice-candidate', {
          candidate,
          senderUserId: sender.userId
        });
        console.log(`ICE candidate sent from ${sender.userId} to ${targetUserId}`);
      }
    }
  });

  // Handle user leaving
  socket.on('leave-room', () => {
    handleUserLeave(socket);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    handleUserLeave(socket);
  });
});

function findSocketByUserId(userId, roomId) {
  for (const [socketId, userData] of users.entries()) {
    if (userData.userId === userId && userData.roomId === roomId) {
      return socketId;
    }
  }
  return null;
}

function handleUserLeave(socket) {
  const user = users.get(socket.id);
  if (user) {
    const { userId, roomId } = user;
    console.log(`User ${userId} leaving room ${roomId}`);
    
    // Remove from room
    const room = rooms.get(roomId);
    if (room) {
      room.delete(socket.id);
      if (room.size === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} deleted (empty)`);
      } else {
        // Notify others that user left
        socket.to(roomId).emit('user-left', userId);
        console.log(`Room ${roomId} now has ${room.size} users`);
      }
    }
    
    // Remove user data
    users.delete(socket.id);
    socket.leave(roomId);
  }
}

// Error handling
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled Rejection:', error);
});

server.listen(PORT, () => {
  console.log(`🚀 Signaling server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/`);
  console.log(`🧊 ICE servers: http://localhost:${PORT}/api/ice-servers`);
});
