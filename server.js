// ==========================
//  EventFlow Cloud Backend
//  (Hosted on Azure)
// ==========================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // allow all origins (for Electron host & guests)
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

// Serve static guest website (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'guest')));
app.use(cors());

// ====== In-memory State ======
let attendanceList = [];
let bracket = null;

// ====== Socket.IO Connections ======
io.on('connection', (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  // Send current state to new client
  socket.emit('attendanceList', attendanceList);
  socket.emit('bracketUpdated', bracket);

  // --- Attendance handling ---
  socket.on('updateAttendanceList', (list) => {
    attendanceList = list;
    io.emit('attendanceList', attendanceList);
    console.log('🟢 Attendance list updated');
  });

  socket.on('markAttendance', (name) => {
    const person = attendanceList.find(p => p.name === name);
    if (person) {
      person.attended = true;
      io.emit('attendanceList', attendanceList);
      console.log(`✅ ${name} marked attended`);
    }
  });

  socket.on('getAttendance', () => {
    socket.emit('attendanceList', attendanceList);
  });

  // --- Bracket updates from host ---
  socket.on('updateBracket', (data) => {
    bracket = data;
    io.emit('bracketUpdated', bracket);
    console.log('🏆 Bracket updated');
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// ====== Basic API route for health check ======
app.get('/api/status', (req, res) => {
  res.json({
    status: '✅ EventFlow Azure Server Running',
    guests: io.engine.clientsCount,
    attendanceCount: attendanceList.length,
  });
});

// ====== Start Server ======
server.listen(PORT, () => {
  console.log(`🌐 EventFlow Cloud running on port ${PORT}`);
});
