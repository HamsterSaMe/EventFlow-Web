const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const multer = require('multer'); // For handling file uploads
const fs = require('fs');
const db = require('./database/operations'); // Ensure you copied the database folder here
const { initializeDatabase } = require('./database/config');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// --- 1. Middleware & Static Files ---
app.use(cors());
app.use(express.json());

// Create media directories if they don't exist
const uploadDirs = ['Header', 'Brochure', 'Map', 'Background', 'Links', 'Tournaments'];
uploadDirs.forEach(dir => {
  const dirPath = path.join(__dirname, 'public', 'Media', dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

// Serve Guest HTML
app.use(express.static(path.join(__dirname, 'guest/HTML')));
app.use('/CSS', express.static(path.join(__dirname, 'guest/CSS')));
app.use('/Scripts', express.static(path.join(__dirname, 'guest/Scripts')));

// Serve Uploaded Media
app.use('/Media', express.static(path.join(__dirname, 'public', 'Media')));

// --- 2. File Upload Configuration (Multer) ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const type = req.params.type || 'Misc';
    // Map type to folder
    let folder = 'Misc';
    if(type === 'header') folder = 'Header';
    else if(type === 'brochure') folder = 'Brochure';
    else if(type === 'map') folder = 'Map';
    else if(type === 'background') folder = 'Background';
    else if(type === 'link') folder = 'Links';
    
    cb(null, path.join(__dirname, 'public', 'Media', folder));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});
const upload = multer({ storage: storage });

// --- 3. API Routes for Electron Host ---

// API: Upload File
app.post('/api/upload/:type', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, msg: 'No file uploaded' });
  
  // Construct the public URL
  // req.params.type matches the folder logic above
  let folder = 'Misc';
  if(req.params.type === 'header') folder = 'Header';
  else if(req.params.type === 'brochure') folder = 'Brochure';
  else if(req.params.type === 'map') folder = 'Map';
  else if(req.params.type === 'background') folder = 'Background';
  else if(req.params.type === 'link') folder = 'Links';

  const fileUrl = `/Media/${folder}/${req.file.filename}`;
  res.json({ ok: true, url: fileUrl, filename: req.file.filename });
});

// API: Trigger Real-time Event (Bridge from Electron)
app.post('/api/trigger', (req, res) => {
  const { event, data } = req.body;
  if(event) {
    io.emit(event, data); // Broadcast to all connected guests
    console.log(`📡 Host triggered event: ${event}`);
  }
  res.json({ ok: true });
});

// --- 4. Database & Socket Logic ---

io.on('connection', async (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  // Send initial data on connect
  try {
    const tournamentList = await db.getAllTournaments();
    const linksList = await db.getAllLinks();
    const brochuresList = await db.getAllBrochures();
    const currentMap = await db.getLatestMap();
    const headerImage = await db.getSetting('header_image');
    const pageBackgrounds = await db.getPageBackgrounds();

    socket.emit('tournamentList', tournamentList);
    socket.emit('linksUpdated', linksList);
    socket.emit('brochureUpdated', brochuresList);
    socket.emit('mapUpdated', currentMap);
    socket.emit('headerUpdated', headerImage);
    socket.emit('pageBackgroundsUpdated', pageBackgrounds);
  } catch (err) {
    console.error("Error fetching initial data", err);
  }

  // Handle Requests from Guest
  socket.on('requestTournament', async (id) => {
    const t = await db.getTournamentById(id);
    if (t) {
        if (t.mode === 'sequential') {
            const performance = await db.getPerformance(id);
            socket.emit('performanceUpdate', performance);
        } else {
            const matches = await db.getTournamentMatches(id);
            // Note: You need the 'formatBracketForFrontend' function here similar to main.js
            // For simplicity, we assume the host sends the processed bracket via 'bracketUpdate' event
            // or we move that logic to shared library. 
            // Minimal fix: Just send what we have, host usually triggers update.
        }
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// Initialize DB and Start
initializeDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`🌐 EventFlow Azure Server running on port ${PORT}`);
  });
});