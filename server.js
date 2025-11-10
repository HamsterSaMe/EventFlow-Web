const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// ===== Serve static files =====
app.use(express.static(path.join(__dirname, 'guest/HTML')));
app.use('/CSS', express.static(path.join(__dirname, 'guest/CSS')));
app.use('/Scripts', express.static(path.join(__dirname, 'guest/Scripts')));
app.use(cors());

// ===== In-memory State =====
let attendanceList = [];
let bracket = null;

// ===== Socket.IO =====
io.on('connection', (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  socket.emit('attendanceList', attendanceList);
  socket.emit('bracketUpdated', bracket);

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

  socket.on('updateBracket', (data) => {
    bracket = data;
    io.emit('bracketUpdated', bracket);
    console.log('🏆 Bracket updated');
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// ===== Default routes =====
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'guest/HTML', 'index.html'));
});

app.get('/api/status', (req, res) => {
  res.json({
    status: '✅ EventFlow Azure Server Running',
    guests: io.engine.clientsCount,
    attendanceCount: attendanceList.length,
  });
});

// ===== Start Server =====
server.listen(PORT, () => {
  console.log(`🌐 EventFlow Cloud running on port ${PORT}`);
});
