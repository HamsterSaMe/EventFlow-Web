const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const multer = require('multer'); 
const fs = require('fs');

// --- DATABASE IMPORT ---
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

// --- CRITICAL: Ensure Media Directory Exists ---
// In Azure, we must ensure this path is persistent.
// We will use a check here to recreate the structure if Azure wiped it.
const MEDIA_ROOT = path.join(__dirname, 'public', 'Media');

function ensureDirectories() {
  const dirs = ['Header', 'Brochure', 'Map', 'Background', 'Links', 'Tournaments', 'Misc'];
  if (!fs.existsSync(MEDIA_ROOT)) fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  
  dirs.forEach(dir => {
    const p = path.join(MEDIA_ROOT, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
}
ensureDirectories(); // Run on startup

// --- Static Files ---
app.use(express.static(path.join(__dirname, 'guest/HTML')));
app.use('/CSS', express.static(path.join(__dirname, 'guest/CSS')));
app.use('/Scripts', express.static(path.join(__dirname, 'guest/Scripts')));
app.use('/Media', express.static(path.join(__dirname, 'public', 'Media')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'guest/HTML', 'index.html'));
});

// --- Upload Config ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    ensureDirectories(); // Double check before saving
    const type = req.params.type ? req.params.type.toLowerCase() : 'misc';
    let folder = 'Misc';
    
    const typeMap = {
      'header': 'Header',
      'brochure': 'Brochure',
      'map': 'Map',
      'background': 'Background',
      'link': 'Links',
      'tournaments': 'Tournaments'
    };

    if (typeMap[type]) folder = typeMap[type];
    cb(null, path.join(MEDIA_ROOT, folder));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});
const upload = multer({ storage: storage });

// --- Routes ---
app.post('/api/upload/:type', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, msg: 'No file' });
  
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

  // Return relative path
  const fileUrl = `/Media/${folder}/${req.file.filename}`;
  console.log(`📂 Uploaded: ${fileUrl}`);
  res.json({ ok: true, url: fileUrl });
});

app.post('/api/trigger', (req, res) => {
  const { event, data } = req.body;
  if (event) {
    io.emit(event, data);
    console.log(`📡 Trigger: ${event}`);
  }
  res.json({ ok: true });
});

// --- Socket & Start ---
io.on('connection', async (socket) => {
  console.log(`✅ Client: ${socket.id}`);
  if (db) {
    try {
      // Send initial data to ensure consistency on reconnect/refresh
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
      console.error("Sync Error:", err.message);
    }
    
    // Listen for requests
    socket.on('requestTournament', async (id) => {
        const t = await db.getTournamentById(id);
        if (t) {
             if (t.mode === 'sequential') {
                 socket.emit('performanceUpdate', await db.getPerformance(id));
             } else {
                 const matches = await db.getTournamentMatches(id);
                 // Note: Ideally host sends bracket structure, but we can send matches if needed
                 // Or we rely on the host pushing updates.
             }
        }
    });
  }
  socket.on('disconnect', () => console.log(`❌ Disconnected: ${socket.id}`));
});

if (initializeDatabase) {
  initializeDatabase().then(() => {
    server.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
  });
} else {
  server.listen(PORT, () => console.log(`🌐 Server running (No DB) on port ${PORT}`));
}