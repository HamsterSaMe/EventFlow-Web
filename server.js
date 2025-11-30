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
const MEDIA_ROOT = path.join(__dirname, 'public', 'Media');
function ensureDirectories() {
  if (!fs.existsSync(MEDIA_ROOT)) fs.mkdirSync(MEDIA_ROOT, { recursive: true });
  ['Header', 'Brochure', 'Map', 'Background', 'Links', 'Tournaments', 'Misc'].forEach(dir => {
    const p = path.join(MEDIA_ROOT, dir);
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
  });
}
try { ensureDirectories(); } catch (err) { console.error(err); }

// --- Static Files ---
app.use(express.static(path.join(__dirname, 'guest/HTML')));
app.use('/CSS', express.static(path.join(__dirname, 'guest/CSS')));
app.use('/Scripts', express.static(path.join(__dirname, 'guest/Scripts')));
app.use('/Media', express.static(path.join(__dirname, 'public', 'Media')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'guest/HTML', 'index.html')));

// --- Upload Config ---
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    ensureDirectories();
    const type = req.params.type ? req.params.type.toLowerCase() : 'misc';
    const typeMap = { 'header': 'Header', 'brochure': 'Brochure', 'map': 'Map', 'background': 'Background', 'link': 'Links', 'tournaments': 'Tournaments' };
    cb(null, path.join(MEDIA_ROOT, typeMap[type] || 'Misc'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}${ext}`);
  }
});
const upload = multer({ storage: storage });

app.post('/api/upload/:type', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, msg: 'No file' });
  const type = req.params.type ? req.params.type.toLowerCase() : 'misc';
  const typeMap = { 'header': 'Header', 'brochure': 'Brochure', 'map': 'Map', 'background': 'Background', 'link': 'Links', 'tournaments': 'Tournaments' };
  res.json({ ok: true, url: `/Media/${typeMap[type] || 'Misc'}/${req.file.filename}` });
});

app.post('/api/trigger', (req, res) => {
  const { event, data } = req.body;
  if (event) io.emit(event, data);
  res.json({ ok: true });
});

// --- Socket & Database Sync ---
io.on('connection', async (socket) => {
  console.log(`✅ Client: ${socket.id}`);
  if (db) {
    try {
      const [attendance, tournaments, links, brochures, map, header, bgs] = await Promise.all([
        db.getAllAttendance(), db.getAllTournaments(), db.getAllLinks(), db.getAllBrochures(), db.getLatestMap(), db.getSetting('header_image'), db.getPageBackgrounds()
      ]);
      socket.emit('attendanceSync', attendance);
      socket.emit('tournamentList', tournaments);
      socket.emit('linksUpdated', links);
      socket.emit('brochureUpdated', brochures);
      socket.emit('mapUpdated', map);
      socket.emit('headerUpdated', header);
      socket.emit('pageBackgroundsUpdated', bgs);
    } catch (err) { console.error("Sync Error:", err.message); }
    
    // --- BRACKET REQUEST HANDLER (Updated) ---
    socket.on('requestTournament', async (id) => {
        try {
          const t = await db.getTournamentById(id);
          if (t) {
             if (t.mode === 'sequential') {
                 socket.emit('performanceUpdate', await db.getPerformance(id));
             } else {
                 // 🔥 FETCH AND FORMAT BRACKET FOR CLIENT
                 const matches = await db.getTournamentMatches(id);
                 const bracket = await formatBracketForFrontend(matches);
                 socket.emit('bracketUpdate', { tournamentId: id, bracket: bracket });
             }
          }
        } catch (e) { console.error(e); }
    });
  }
});

if (initializeDatabase) {
  initializeDatabase().then(() => server.listen(PORT, () => console.log(`🌐 Server on port ${PORT}`)));
} else {
  server.listen(PORT, () => console.log(`🌐 Server (No DB) on port ${PORT}`));
}

// --- HELPER: Format Bracket (Same as Electron) ---
function nextPowerOfTwo(n) { return 2 ** Math.ceil(Math.log2(Math.max(1, n))); }
async function formatBracketForFrontend(matches) {
  if (!matches || matches.length === 0) return null;
  const matchMap = new Map(matches.map(m => [m.MatchID, m]));
  const childrenMap = new Map();
  let finalMatch = null;
  matches.forEach(m => {
    if (!m.NextMatchID) finalMatch = m;
    else {
      if (!childrenMap.has(m.NextMatchID)) childrenMap.set(m.NextMatchID, []);
      childrenMap.get(m.NextMatchID).push(m);
    }
  });
  if (!finalMatch) return null;

  function getDepth(matchId) {
    const children = childrenMap.get(matchId) || [];
    if (children.length === 0) return 0;
    return 1 + Math.max(...children.map(c => getDepth(c.MatchID)));
  }

  const maxDepth = getDepth(finalMatch.MatchID);
  const rounds = [];
  const queue = [{ match: finalMatch, round: maxDepth }];

  while (queue.length > 0) {
    const { match, round } = queue.shift();
    if (!rounds[round]) rounds[round] = [];
    rounds[round].push(match);
    (childrenMap.get(match.MatchID) || []).forEach(c => queue.push({ match: c, round: round - 1 }));
  }

  for (let r = maxDepth - 1; r >= 0; r--) {
    const nextRoundMap = new Map(rounds[r + 1].map((m, idx) => [m.MatchID, idx]));
    rounds[r].sort((a, b) => {
      const pA = nextRoundMap.get(a.NextMatchID), pB = nextRoundMap.get(b.NextMatchID);
      return (pA !== pB) ? pA - pB : (a.NextMatchSlot || 0) - (b.NextMatchSlot || 0);
    });
  }

  const formatted = rounds.map((matches, rIndex) => matches.map(m => {
    let next = null;
    if (m.NextMatchID) {
      const nextR = rounds[rIndex + 1];
      const idx = nextR.findIndex(nm => nm.MatchID === m.NextMatchID);
      if (idx !== -1) next = { round: rIndex + 1, index: idx, side: m.NextMatchSlot === 1 ? 'playerA' : 'playerB' };
    }
    return {
      id: m.MatchID, playerA: m.p1Name || null, playerB: m.p2Name || null, winner: m.winnerName || null,
      next, tournamentId: m.TournamentID, p1Id: m.Participant1_ID, p2Id: m.Participant2_ID, winnerId: m.Winner_ID
    };
  }));
  return { size: Math.pow(2, maxDepth), rounds: formatted, champion: finalMatch.winnerName };
}