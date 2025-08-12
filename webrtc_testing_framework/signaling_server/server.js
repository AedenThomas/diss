const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"],
  methods: ["GET", "POST"],
  credentials: true
}));

const io = socketIo(server, {
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"],
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Store room information
const rooms = new Map();

// Room structure: { id: string, participants: Map<socketId, {role, mode, socketId}> }

class Room {
  constructor(id) {
    this.id = id;
    this.participants = new Map();
    this.presenter = null;
  }

  addParticipant(socketId, role, mode) {
    this.participants.set(socketId, { socketId, role, mode });
    
    if (role === 'presenter') {
      this.presenter = socketId;
    }

    console.log(`Participant ${socketId} joined room ${this.id} as ${role} in ${mode} mode`);
  }

  removeParticipant(socketId) {
    const participant = this.participants.get(socketId);
    if (participant) {
      this.participants.delete(socketId);
      
      if (participant.role === 'presenter') {
        this.presenter = null;
      }

      console.log(`Participant ${socketId} left room ${this.id}`);
    }
  }

  getParticipants() {
    return Array.from(this.participants.values());
  }

  getViewers() {
    return this.getParticipants().filter(p => p.role === 'viewer');
  }

  getPresenter() {
    return this.participants.get(this.presenter);
  }
}

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    rooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/rooms', (req, res) => {
  const roomData = Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    participantCount: room.participants.size,
    presenter: room.presenter ? 'present' : 'absent',
    participants: room.getParticipants().map(p => ({ role: p.role, mode: p.mode }))
  }));
  
  res.json({ rooms: roomData });
});

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('join-room', ({ roomId, role, mode }) => {
    try {
      // Leave any existing rooms
      socket.rooms.forEach(room => {
        if (room !== socket.id) {
          socket.leave(room);
          const existingRoom = rooms.get(room);
          if (existingRoom) {
            existingRoom.removeParticipant(socket.id);
            socket.to(room).emit('peer-left', socket.id);
          }
        }
      });

      // Join new room
      socket.join(roomId);

      // Get or create room
      if (!rooms.has(roomId)) {
        rooms.set(roomId, new Room(roomId));
      }

      const room = rooms.get(roomId);
      room.addParticipant(socket.id, role, mode);

      // Notify existing participants about new peer
      socket.to(roomId).emit('peer-joined', socket.id);

      // Send current room state to new participant
      const participants = room.getParticipants().filter(p => p.socketId !== socket.id);
      socket.emit('room-joined', {
        roomId,
        participants: participants.map(p => ({ id: p.socketId, role: p.role, mode: p.mode }))
      });

      console.log(`Socket ${socket.id} joined room ${roomId} as ${role} (${mode})`);
      console.log(`Room ${roomId} now has ${room.participants.size} participants`);

    } catch (error) {
      console.error('Error joining room:', error);
      socket.emit('error', { message: 'Failed to join room' });
    }
  });

  // WebRTC signaling events
  socket.on('offer', ({ offer, to, roomId }) => {
    console.log(`Forwarding offer from ${socket.id} to ${to} in room ${roomId}`);
    socket.to(to).emit('offer', { offer, from: socket.id });
  });

  socket.on('answer', ({ answer, to, roomId }) => {
    console.log(`Forwarding answer from ${socket.id} to ${to} in room ${roomId}`);
    socket.to(to).emit('answer', { answer, from: socket.id });
  });

  socket.on('ice-candidate', ({ candidate, to, roomId }) => {
    console.log(`Forwarding ICE candidate from ${socket.id} to ${to} in room ${roomId}`);
    socket.to(to).emit('ice-candidate', { candidate, from: socket.id });
  });

  // SFU specific signaling
  socket.on('sfu-offer', ({ offer, roomId }) => {
    console.log(`SFU offer from ${socket.id} in room ${roomId}`);
    // In a real implementation, this would go to the SFU server
    // For now, we'll emit it to the room for SFU server to pick up
    socket.to(roomId).emit('sfu-offer', { offer, from: socket.id });
  });

  socket.on('sfu-answer', ({ answer, to, roomId }) => {
    console.log(`SFU answer from ${socket.id} to ${to} in room ${roomId}`);
    socket.to(to).emit('sfu-answer', { answer, from: socket.id });
  });

  socket.on('sfu-ice-candidate', ({ candidate, to, roomId }) => {
    console.log(`SFU ICE candidate from ${socket.id} to ${to} in room ${roomId}`);
    socket.to(to).emit('sfu-ice-candidate', { candidate, from: socket.id });
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    
    // Clean up rooms
    socket.rooms.forEach(roomId => {
      if (roomId !== socket.id) {
        const room = rooms.get(roomId);
        if (room) {
          room.removeParticipant(socket.id);
          
          // Notify other participants
          socket.to(roomId).emit('peer-left', socket.id);
          
          // Remove empty rooms
          if (room.participants.size === 0) {
            rooms.delete(roomId);
            console.log(`Removed empty room: ${roomId}`);
          }
        }
      }
    });
  });

  // Error handling
  socket.on('error', (error) => {
    console.error(`Socket error from ${socket.id}:`, error);
  });
});

// Cleanup empty rooms periodically
setInterval(() => {
  const emptyRooms = Array.from(rooms.entries())
    .filter(([_, room]) => room.participants.size === 0)
    .map(([id, _]) => id);
    
  emptyRooms.forEach(roomId => {
    rooms.delete(roomId);
    console.log(`Cleaned up empty room: ${roomId}`);
  });
}, 60000); // Clean up every minute

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Room info: http://localhost:${PORT}/rooms`);
});