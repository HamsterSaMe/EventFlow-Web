const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ---------- STATIC HOSTING SETUP ----------
app.use('/CSS', express.static(path.join(__dirname, 'guest/CSS')));
app.use('/Scripts', express.static(path.join(__dirname, 'guest/Scripts')));
app.use('/HTML', express.static(path.join(__dirname, 'guest/HTML')));
app.use('/socket.io', express.static(path.join(__dirname, 'node_modules/socket.io/client-dist')));

// Serve the main guest page by default
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'guest/HTML/Index.html'));
});

// Optional: direct route for tournament page
app.get('/bracket.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'guest/HTML/bracket.html'));
});

// ---------- IN-MEMORY STATE ----------
let attendanceList = [];
let bracket = null;

// ---------- SOCKET.IO LOGIC ----------
io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id);
  socket.emit('attendanceList', attendanceList);
  socket.emit('bracketUpdated', bracket);

  // Attendance logic
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

  // Bracket logic
  socket.on('updateBracket', (data) => {
    bracket = data;
    io.emit('bracketUpdated', bracket);
    console.log('Bracket updated');
  });

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });
});

// ---------- API STATUS ----------
app.get('/api/status', (req, res) => {
  res.json({ status: 'Server running', attendanceCount: attendanceList.length });
});

// ---------- START SERVER ----------
server.listen(PORT, () => {
  console.log(`🌐 EventFlow Web running on port ${PORT}`);
});
