const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Static hosting for guest site
app.use(express.static(path.join(__dirname, 'guest')));

// In-memory state
let attendanceList = [];
let bracket = null;

// ========== Attendance system ==========
io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id);
  socket.emit('attendanceList', attendanceList);
  socket.emit('bracketUpdated', bracket);

  socket.on('markAttendance', (name) => {
    const person = attendanceList.find(p => p.name === name);
    if (person) {
      person.attended = true;
      io.emit('attendanceList', attendanceList);
      console.log(`${name} marked attended`);
    }
  });

  socket.on('getAttendance', () => {
    socket.emit('attendanceList', attendanceList);
  });

  socket.on('updateAttendanceList', (list) => {
    attendanceList = list;
    io.emit('attendanceList', attendanceList);
    console.log('Updated attendance list');
  });

  // ========== Bracket updates ==========
  socket.on('updateBracket', (data) => {
    bracket = data;
    io.emit('bracketUpdated', bracket);
    console.log('Bracket updated');
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'Server running', attendanceCount: attendanceList.length });
});

server.listen(PORT, () => {
  console.log(`🌐 EventFlow Web running on port ${PORT}`);
});
