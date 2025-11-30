const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const multer = require('multer'); 
const fs = require('fs');

// --- DATABASE IMPORT SAFEGUARD ---
// We try to import the database. If it fails, we log it but don't crash immediately
// so you can see the error in Azure logs.
let db, initializeDatabase;
try {
  db = require('./database/operations');
  const config = require('./database/config');
  initializeDatabase = config.initializeDatabase;
} catch (err) {
  console.error("❌ CRITICAL ERROR: Could not load database modules. Did you push the 'database' folder?", err);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;

// --- 1. Middleware ---
app.use(cors());
app.use(express.json());

// --- 2. Setup Upload Directories ---
// We use a try-catch here to ensure permission issues don't crash the app
try {
  const mediaRoot = path.join(__dirname, 'public', 'Media');
  const uploadDirs = ['Header', 'Brochure', 'Map', 'Background', 'Links', 'Tournaments', 'Misc'];
  
  if (!fs.existsSync(mediaRoot)) fs.mkdirSync(mediaRoot, { recursive: true });
  
  uploadDirs.forEach(dir => {
    const dirPath = path.join(mediaRoot, dir);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  });
} catch (err) {
  console.error("⚠️ Warning: Could not create upload directories.", err);
}

// --- 3. Serve Static Files ---
app.use(express.static(path.join(__dirname, 'guest/HTML')));
app.use('/CSS', express.static(path.join(__dirname, 'guest/CSS')));
app.use('/Scripts', express.static(path.join(__dirname, 'guest/Scripts')));
app.use('/Media', express.static(path.join(__dirname, 'public', 'Media')));

// Explicit Home Route (Fixes "Cannot show successfully" if index.html isn't auto-found)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'guest/HTML', 'index.html'));
});

// --- 4. File Upload Configuration ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const type = req.params.type ? req.params.type.toLowerCase() : 'misc';
    let folder = 'Misc';
    
    // Map API types to Folder names
    const typeMap = {
      'header': 'Header',
      'brochure': 'Brochure',
      'map': 'Map',
      'background': 'Background',
      'link': 'Links',
      'tournaments': 'Tournaments'
    };

    if (typeMap[type]) folder = typeMap[type];
    
    // Ensure directory exists before saving
    const dirPath = path.join(__dirname, 'public', 'Media', folder);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
    
    cb(null, dirPath);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});
const upload = multer({ storage: storage });

// --- 5. API Routes ---

app.post('/api/upload/:type', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, msg: 'No file uploaded' });
  
  // Reconstruct the folder name logic to return correct URL
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

  const fileUrl = `/Media/${folder}/${req.file.filename}`;
  console.log(`📂 File Uploaded: ${fileUrl}`);
  res.json({ ok: true, url: fileUrl });
});

app.post('/api/trigger', (req, res) => {
  const { event, data } = req.body;
  if (event) {
    io.emit(event, data);
    console.log(`📡 Event Triggered: ${event}`);
  }
  res.json({ ok: true });
});

// --- 6. Socket.IO & Database ---

io.on('connection', async (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);

  if (db) {
    try {
      // Send all initial data concurrently
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
      console.error("❌ DB Fetch Error:", err.message);
    }

    // Handle Tournament Requests
    socket.on('requestTournament', async (id) => {
        try {
            const t = await db.getTournamentById(id);
            if (t && t.mode === 'sequential') {
                socket.emit('performanceUpdate', await db.getPerformance(id));
            } else if (t) {
                const matches = await db.getTournamentMatches(id);
                // Note: The host usually broadcasts the full bracket structure.
                // Sending raw matches is okay if client handles it, otherwise Host syncs it.
            }
        } catch (e) { console.error(e); }
    });
  }

  socket.on('disconnect', () => {
    console.log(`❌ Disconnected: ${socket.id}`);
  });
});

// --- 7. Start Server ---
async function start() {
  if (initializeDatabase) {
    console.log('🔄 Connecting to Database...');
    await initializeDatabase();
  } else {
    console.warn('⚠️ Database module missing. Server starting without DB connection.');
  }

  server.listen(PORT, () => {
    console.log(`🌐 EventFlow Azure Server running on port ${PORT}`);
  });
}

start();