const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const socketClient = require('socket.io-client');
const mediasoup = require('mediasoup');
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

// Connect to signaling server
const SIGNALING_SERVER_URL = process.env.SIGNALING_SERVER_URL || 'http://localhost:3001';
let signalingSocket = null;

// Mediasoup configuration
const mediasoupConfig = {
  worker: {
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
      'rtx',
      'bwe',
      'score',
      'simulcast',
      'svc'
    ]
  },
  router: {
    mediaCodecs: [
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000
        }
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000
        }
      }
    ]
  },
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: process.env.ANNOUNCED_IP || '127.0.0.1'
      }
    ],
    maxIncomingBitrate: 1500000,
    initialAvailableOutgoingBitrate: 1000000
  }
};

// Global mediasoup objects
let worker;
let router;

// Store rooms and their associated resources
const rooms = new Map();

class SFURoom {
  constructor(roomId) {
    this.id = roomId;
    this.producer = null; // The presenter's producer
    this.consumers = new Map(); // Map of socketId -> consumer
    this.transports = new Map(); // Map of socketId -> { send, recv } transports
  }

  addConsumer(socketId, consumer) {
    this.consumers.set(socketId, consumer);
    console.log(`Added consumer for ${socketId} in room ${this.id}`);
  }

  removeConsumer(socketId) {
    const consumer = this.consumers.get(socketId);
    if (consumer) {
      consumer.close();
      this.consumers.delete(socketId);
      console.log(`Removed consumer for ${socketId} in room ${this.id}`);
    }
  }

  setProducer(producer) {
    this.producer = producer;
    console.log(`Set producer for room ${this.id}`);
  }

  removeProducer() {
    if (this.producer) {
      this.producer.close();
      this.producer = null;
      console.log(`Removed producer for room ${this.id}`);
    }
  }

  addTransports(socketId, sendTransport, recvTransport) {
    this.transports.set(socketId, { send: sendTransport, recv: recvTransport });
    console.log(`Added transports for ${socketId} in room ${this.id}`);
  }

  removeTransports(socketId) {
    const transports = this.transports.get(socketId);
    if (transports) {
      transports.send.close();
      transports.recv.close();
      this.transports.delete(socketId);
      console.log(`Removed transports for ${socketId} in room ${this.id}`);
    }
  }

  cleanup() {
    // Close all consumers
    this.consumers.forEach(consumer => consumer.close());
    this.consumers.clear();
    
    // Close producer
    this.removeProducer();
    
    // Close all transports
    this.transports.forEach(({ send, recv }) => {
      send.close();
      recv.close();
    });
    this.transports.clear();
    
    console.log(`Cleaned up room ${this.id}`);
  }
}

async function initializeMediasoup() {
  try {
    // Create worker
    worker = await mediasoup.createWorker({
      rtcMinPort: mediasoupConfig.worker.rtcMinPort,
      rtcMaxPort: mediasoupConfig.worker.rtcMaxPort,
      logLevel: mediasoupConfig.worker.logLevel,
      logTags: mediasoupConfig.worker.logTags
    });

    console.log(`Mediasoup worker created with PID: ${worker.pid}`);

    worker.on('died', (error) => {
      console.error('Mediasoup worker died:', error);
      setTimeout(() => process.exit(1), 2000);
    });

    // Create router
    router = await worker.createRouter({
      mediaCodecs: mediasoupConfig.router.mediaCodecs
    });

    console.log('Mediasoup router created');

    return true;
  } catch (error) {
    console.error('Failed to initialize mediasoup:', error);
    return false;
  }
}

function connectToSignalingServer() {
  signalingSocket = socketClient(SIGNALING_SERVER_URL);
  
  signalingSocket.on('connect', () => {
    console.log('Connected to signaling server');
  });

  signalingSocket.on('disconnect', () => {
    console.log('Disconnected from signaling server');
  });

  signalingSocket.on('error', (error) => {
    console.error('Signaling server error:', error);
  });
}

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    worker: worker ? 'running' : 'not initialized',
    router: router ? 'created' : 'not created',
    rooms: rooms.size,
    timestamp: new Date().toISOString()
  });
});

app.get('/rooms', (req, res) => {
  const roomData = Array.from(rooms.entries()).map(([id, room]) => ({
    id,
    hasProducer: !!room.producer,
    consumerCount: room.consumers.size,
    transportCount: room.transports.size
  }));
  
  res.json({ rooms: roomData });
});

io.on('connection', (socket) => {
  console.log(`SFU client connected: ${socket.id}`);
  let currentRoom = null;

  socket.on('join-sfu-room', async ({ roomId }) => {
    try {
      console.log(`${socket.id} joining SFU room: ${roomId}`);
      
      currentRoom = roomId;
      socket.join(roomId);

      // Create room if it doesn't exist
      if (!rooms.has(roomId)) {
        rooms.set(roomId, new SFURoom(roomId));
      }

      const room = rooms.get(roomId);

      // Send router RTP capabilities
      socket.emit('router-rtp-capabilities', {
        rtpCapabilities: router.rtpCapabilities
      });

    } catch (error) {
      console.error('Error joining SFU room:', error);
      socket.emit('error', { message: 'Failed to join SFU room' });
    }
  });

  socket.on('create-webrtc-transport', async ({ producing, consuming, roomId }) => {
    try {
      const room = rooms.get(roomId);
      if (!room) {
        throw new Error('Room not found');
      }

      const transport = await router.createWebRtcTransport(mediasoupConfig.webRtcTransport);

      console.log(`Created WebRTC transport ${transport.id} for ${socket.id} (producing: ${producing}, consuming: ${consuming})`);

      transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
          transport.close();
        }
      });

      transport.on('close', () => {
        console.log(`Transport ${transport.id} closed for ${socket.id}`);
      });

      // Store transport
      const existingTransports = room.transports.get(socket.id) || {};
      if (producing) {
        existingTransports.send = transport;
      } else {
        existingTransports.recv = transport;
      }
      room.transports.set(socket.id, existingTransports);

      socket.emit('webrtc-transport-created', {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters
      });

    } catch (error) {
      console.error('Error creating WebRTC transport:', error);
      socket.emit('error', { message: 'Failed to create transport' });
    }
  });

  socket.on('connect-webrtc-transport', async ({ transportId, dtlsParameters }) => {
    try {
      const room = rooms.get(currentRoom);
      if (!room) {
        throw new Error('Room not found');
      }

      const transports = room.transports.get(socket.id);
      let transport = null;

      if (transports) {
        transport = transports.send?.id === transportId ? transports.send : transports.recv;
      }

      if (!transport) {
        throw new Error('Transport not found');
      }

      await transport.connect({ dtlsParameters });
      console.log(`Transport ${transportId} connected for ${socket.id}`);

      socket.emit('webrtc-transport-connected');

    } catch (error) {
      console.error('Error connecting WebRTC transport:', error);
      socket.emit('error', { message: 'Failed to connect transport' });
    }
  });

  socket.on('produce', async ({ transportId, kind, rtpParameters }) => {
    try {
      const room = rooms.get(currentRoom);
      if (!room) {
        throw new Error('Room not found');
      }

      const transports = room.transports.get(socket.id);
      const transport = transports?.send;

      if (!transport || transport.id !== transportId) {
        throw new Error('Send transport not found');
      }

      const producer = await transport.produce({ kind, rtpParameters });

      console.log(`Producer created: ${producer.id} for ${socket.id}`);

      producer.on('transportclose', () => {
        console.log(`Producer ${producer.id} transport closed`);
        producer.close();
      });

      // Set as room producer (assuming single presenter)
      room.setProducer(producer);

      socket.emit('produced', { id: producer.id });

      // Notify existing consumers about new producer
      socket.to(currentRoom).emit('new-producer', { producerId: producer.id });

    } catch (error) {
      console.error('Error producing:', error);
      socket.emit('error', { message: 'Failed to produce' });
    }
  });

  socket.on('consume', async ({ producerId, rtpCapabilities }) => {
    try {
      const room = rooms.get(currentRoom);
      if (!room) {
        throw new Error('Room not found');
      }

      if (!router.canConsume({ producerId, rtpCapabilities })) {
        console.error(`Cannot consume producer ${producerId}`);
        return;
      }

      const transports = room.transports.get(socket.id);
      const transport = transports?.recv;

      if (!transport) {
        throw new Error('Receive transport not found');
      }

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: true
      });

      console.log(`Consumer created: ${consumer.id} for ${socket.id}`);

      consumer.on('transportclose', () => {
        console.log(`Consumer ${consumer.id} transport closed`);
        consumer.close();
      });

      consumer.on('producerclose', () => {
        console.log(`Consumer ${consumer.id} producer closed`);
        consumer.close();
        socket.emit('consumer-closed', { consumerId: consumer.id });
      });

      room.addConsumer(socket.id, consumer);

      socket.emit('consumed', {
        id: consumer.id,
        producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters
      });

    } catch (error) {
      console.error('Error consuming:', error);
      socket.emit('error', { message: 'Failed to consume' });
    }
  });

  socket.on('resume-consumer', async ({ consumerId }) => {
    try {
      const room = rooms.get(currentRoom);
      if (!room) {
        throw new Error('Room not found');
      }

      const consumer = room.consumers.get(socket.id);
      if (!consumer || consumer.id !== consumerId) {
        throw new Error('Consumer not found');
      }

      await consumer.resume();
      console.log(`Consumer ${consumerId} resumed for ${socket.id}`);

    } catch (error) {
      console.error('Error resuming consumer:', error);
      socket.emit('error', { message: 'Failed to resume consumer' });
    }
  });

  socket.on('disconnect', () => {
    console.log(`SFU client disconnected: ${socket.id}`);

    if (currentRoom) {
      const room = rooms.get(currentRoom);
      if (room) {
        // Clean up this client's resources
        room.removeConsumer(socket.id);
        room.removeTransports(socket.id);

        // If this was the producer, clean up the producer too
        if (room.producer && room.transports.size === 0) {
          room.removeProducer();
        }

        // Remove empty rooms
        if (room.transports.size === 0) {
          room.cleanup();
          rooms.delete(currentRoom);
          console.log(`Removed empty SFU room: ${currentRoom}`);
        }
      }
    }
  });

  socket.on('error', (error) => {
    console.error(`SFU socket error from ${socket.id}:`, error);
  });
});

// Initialize and start server
async function start() {
  const mediasoupReady = await initializeMediasoup();
  if (!mediasoupReady) {
    console.error('Failed to initialize mediasoup');
    process.exit(1);
  }

  connectToSignalingServer();

  const PORT = process.env.PORT || 3002;
  server.listen(PORT, () => {
    console.log(`SFU server running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    console.log(`Room info: http://localhost:${PORT}/rooms`);
  });
}

start().catch(console.error);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down SFU server...');
  if (worker) {
    worker.close();
  }
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down SFU server...');
  if (worker) {
    worker.close();
  }
  process.exit(0);
});