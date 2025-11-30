const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const multer = require('multer'); 
const fs = require('fs');

// --- DATABASE IMPORT SAFEGUARD ---
let db, initializeDatabase;
try {
  db = require('./database/operations');
  const config = require('./database/config');
  initializeDatabase = config.initializeDatabase;
} catch (err) {
  console.error("❌ Database Import Error:", err.message);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- CRITICAL: PERSISTENT MEDIA STORAGE ---
// Azure stores persistent data in /home/site/wwwroot by default on Linux/Windows App Service
// But we must ensure the folders exist every time the app starts.
const MEDIA_ROOT = path.join(__dirname, 'public', 'Media');

function ensureDirectories() {
  // Ensure root exists
  if (!fs.existsSync(MEDIA_ROOT)) {
    console.log(`Creating Media Root: ${MEDIA_ROOT}`);
    fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  }
  
  const dirs = ['Header', 'Brochure', 'Map', 'Background', 'Links', 'Tournaments', 'Misc'];
  dirs.forEach(dir => {
    const p = path.join(MEDIA_ROOT, dir);
    if (!fs.existsSync(p)) {
      console.log(`Creating Subdirectory: ${p}`);
      fs.mkdirSync(p, { recursive: true });
    }
  });
}

// Run directory check immediately
try {
  ensureDirectories();
} catch (err) {
  console.error("⚠️ Failed to create directories:", err.message);
}

// --- Static Files ---
app.use(express.static(path.join(__dirname, 'guest/HTML')));
app.use('/CSS', express.static(path.join(__dirname, 'guest/CSS')));
app.use('/Scripts', express.static(path.join(__dirname, 'guest/Scripts')));
// Serve uploaded media
app.use('/Media', express.static(path.join(__dirname, 'public', 'Media')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'guest/HTML', 'index.html'));
});

// --- Upload Config ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    ensureDirectories(); // Double-check existence before saving
    
    const type = req.params.type ? req.params.type.toLowerCase() : 'misc';
    const typeMap = {
      'header': 'Header',
      'brochure': 'Brochure',
      'map': 'Map',
      'background': 'Background',
      'link': 'Links',
      'tournaments': 'Tournaments'
    };
    const folder = typeMap[type] || 'Misc';
    
    cb(null, path.join(MEDIA_ROOT, folder));
  },
  filename: function (req, file, cb) {
    // Use timestamp to prevent caching issues
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});
const upload = multer({ storage: storage });

// --- Routes ---

app.post('/api/upload/:type', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, msg: 'No file uploaded' });
  
  const type = req.params.type ? req.params.type.toLowerCase() : 'misc';
  const typeMap = {
      'header': 'Header',
      'brochure': 'Brochure',
      'map': 'Map',
      'background': 'Background',
      'link': 'Links',
      'tournaments': 'Tournaments'
  };
  const folder = typeMap[type] || 'Misc';

  // Return RELATIVE path so both Cloud and Electron can use it
  const fileUrl = `/Media/${folder}/${req.file.filename}`;
  console.log(`📂 File Uploaded Successfully: ${fileUrl}`);
  res.json({ ok: true, url: fileUrl });
});

app.post('/api/trigger', (req, res) => {
  const { event, data } = req.body;
  if (event) {
    io.emit(event, data);
    console.log(`📡 Trigger Event: ${event}`);
  }
  res.json({ ok: true });
});

// --- Socket & Database Sync ---
io.on('connection', async (socket) => {
  console.log(`✅ Client Connected: ${socket.id}`);

  if (db) {
    try {
      // Fetch all current data from Azure DB and send to new client
      const [
        attendance, tournaments, links, brochures, map, header, bgs
      ] = await Promise.all([
        db.getAllAttendance(),
        db.getAllTournaments(),
        db.getAllLinks(),
        db.getAllBrochures(),
        db.getLatestMap(),
        db.getSetting('header_image'),
        db.getPageBackgrounds()
      ]);

      socket.emit('attendanceSync', attendance);
      socket.emit('tournamentList', tournaments);
      socket.emit('linksUpdated', links);
      socket.emit('brochureUpdated', brochures);
      socket.emit('mapUpdated', map);
      socket.emit('headerUpdated', header);
      socket.emit('pageBackgroundsUpdated', bgs);
    } catch (err) {
      console.error("❌ Initial Data Sync Failed:", err.message);
    }
    
    // Handle specific requests
    socket.on('requestTournament', async (id) => {
        try {
          const t = await db.getTournamentById(id);
          if (t && t.mode === 'sequential') {
              socket.emit('performanceUpdate', await db.getPerformance(id));
          }
          // Bracket data is usually pushed by host, but you can add fetch here if needed
        } catch (e) { console.error(e); }
    });
  }

  socket.on('disconnect', () => {
    console.log(`❌ Client Disconnected: ${socket.id}`);
  });
});

// --- Start Server ---
if (initializeDatabase) {
  initializeDatabase().then(() => {
    server.listen(PORT, () => {
      console.log(`🌐 EventFlow Azure Server running on port ${PORT}`);
    });
  });
} else {
  console.warn('⚠️ Database module missing. Starting without DB.');
  server.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
}