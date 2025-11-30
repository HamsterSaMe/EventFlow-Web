const { getPool } = require('./config');

/* ------------------------------------------------------------------
   Attendance Operations
------------------------------------------------------------------ */

async function getAllAttendance() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM attendance ORDER BY name ASC');
  return rows.map(row => ({
    id: row.id,
    ticket_name: row.ticket_name || null,
    name: row.name,
    status: row.status ?? (row.attended === true ? 'present' : 'absent'),
    remark: row.remark || null,
    date_scanned: row.date_scanned || null,
    // Back-compat flag for any consumers still using attended
    attended: (row.status ? row.status === 'present' : Boolean(row.attended))
  }));
}

async function addAttendanceName(name, ticketName = null) {
  const pool = getPool();
  try {
    const [result] = await pool.query(
      'INSERT INTO attendance (name, ticket_name, status, remark) VALUES (?, ?, ?, ?)',
      [name, ticketName, 'absent', null]
    );
    return { ok: true, id: result.insertId };
  } catch (error) {
    console.error('addAttendanceName error:', error);
    throw error;
  }
}

async function markAttendance(id) {
  const pool = getPool();
  try {
    // Stamp scan time when marking present by ID
    // If you need explicit MYT, use:
    //   date_scanned = CONVERT_TZ(NOW(), @@session.time_zone, 'Asia/Kuala_Lumpur')
    const [res] = await pool.query(
      `UPDATE attendance
       SET status = 'present',
           date_scanned = NOW()
       WHERE id = ?`,
      [id]
    );
    return res.affectedRows > 0;
  } catch (err) {
    console.error('markAttendance error:', err);
    return false;
  }
}

async function resetAttendance() {
  const pool = getPool();
  await pool.query("UPDATE attendance SET status = 'absent', date_scanned = NULL");
  return { ok: true };
}

async function clearAllAttendance() {
  const pool = getPool();
  await pool.query('DELETE FROM attendance');
  return { ok: true };
}

async function updateRemark(id, remark) {
  const pool = getPool();
  await pool.query('UPDATE attendance SET remark = ? WHERE id = ?', [remark || null, id]);
  return { ok: true };
}

async function updateTicketName(id, ticketName) {
  const pool = getPool();
  await pool.query('UPDATE attendance SET ticket_name = ? WHERE id = ?', [ticketName || null, id]);
  return { ok: true };
}

/* ------------------------------------------------------------------
   Tournament Operations (New Schema)
------------------------------------------------------------------ */

async function getAllTournaments() {
  const pool = getPool();
  const query = `
    SELECT 
      t.TournamentID AS id,
      t.Name AS name,
      t.BackgroundPath AS backgroundPath,
      t.Mode AS mode,
      COUNT(DISTINCT m.MatchID) AS matchCount,
      COUNT(DISTINCT tp.PerformerID) AS performerCount
    FROM Tournaments t
    LEFT JOIN Matches m ON m.TournamentID = t.TournamentID
    LEFT JOIN TournamentPerformers tp ON tp.TournamentID = t.TournamentID
    GROUP BY t.TournamentID
    ORDER BY t.TournamentID DESC
  `;
  const [rows] = await pool.query(query);
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    backgroundPath: row.backgroundPath,
    mode: row.mode || 'elimination',
    bracket: row.matchCount > 0 ? true : null,
    performance: row.performerCount > 0 ? true : null
  }));
}

async function getTournamentById(id) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT TournamentID as id, Name as name, BackgroundPath as backgroundPath, Mode as mode FROM Tournaments WHERE TournamentID = ?', [id]);
  if (rows.length === 0) return null;

  const t = rows[0];
  const [matches] = await pool.query('SELECT COUNT(*) as count FROM Matches WHERE TournamentID = ?', [id]);
  t.bracket = matches[0].count > 0 ? true : null;
  const [perfCount] = await pool.query('SELECT COUNT(*) as count FROM TournamentPerformers WHERE TournamentID = ?', [id]);
  t.performance = perfCount[0].count > 0 ? true : null;
  t.mode = t.mode || 'elimination';
  return t;
}

async function createTournament(tournamentData) {
  const pool = getPool();
  const { name, savedBackgroundPath, mode } = tournamentData;
  const tournamentMode = (mode && mode.trim()) ? mode.trim() : 'elimination';
  const [result] = await pool.query(
    'INSERT INTO Tournaments (Name, BackgroundPath, Mode) VALUES (?, ?, ?)',
    [name, savedBackgroundPath || null, tournamentMode]
  );
  return { ok: true, id: result.insertId, mode: tournamentMode };
}

async function deleteTournament(id) {
  const pool = getPool();
  await pool.query('DELETE FROM Tournaments WHERE TournamentID = ?', [id]);
  return { ok: true };
}

/* ------------------------------------------------------------------
   Bracket & Match Operations
------------------------------------------------------------------ */

async function addParticipant(name) {
  const pool = getPool();
  const [result] = await pool.query('INSERT INTO Participants (Name) VALUES (?)', [name]);
  return result.insertId;
}

async function createMatch(matchData) {
  const pool = getPool();
  const { tournamentId, p1, p2, nextMatchId, nextMatchSlot } = matchData;
  const [result] = await pool.query(
    `INSERT INTO Matches 
    (TournamentID, Participant1_ID, Participant2_ID, NextMatchID, NextMatchSlot) 
    VALUES (?, ?, ?, ?, ?)`,
    [tournamentId, p1 || null, p2 || null, nextMatchId || null, nextMatchSlot || null]
  );
  return result.insertId;
}

async function getTournamentMatches(tournamentId) {
  const pool = getPool();
  const query = `
    SELECT 
      m.MatchID, m.TournamentID, 
      m.Participant1_ID, p1.Name as p1Name,
      m.Participant2_ID, p2.Name as p2Name,
      m.Winner_ID, w.Name as winnerName,
      m.Score1, m.Score2,
      m.NextMatchID, m.NextMatchSlot
    FROM Matches m
    LEFT JOIN Participants p1 ON m.Participant1_ID = p1.ParticipantID
    LEFT JOIN Participants p2 ON m.Participant2_ID = p2.ParticipantID
    LEFT JOIN Participants w ON m.Winner_ID = w.ParticipantID
    WHERE m.TournamentID = ?
    ORDER BY m.MatchID ASC
  `;
  const [rows] = await pool.query(query, [tournamentId]);
  return rows;
}

async function updateMatchResult(matchId, winnerId, score1, score2) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Step 1: Record Result
    await connection.query(
      `UPDATE Matches SET Winner_ID = ?, Score1 = ?, Score2 = ? WHERE MatchID = ?`,
      [winnerId, score1, score2, matchId]
    );

    // Step 2: Look Ahead
    const [rows] = await connection.query(
      `SELECT NextMatchID, NextMatchSlot FROM Matches WHERE MatchID = ?`,
      [matchId]
    );
    
    if (rows.length > 0) {
      const { NextMatchID, NextMatchSlot } = rows[0];

      // Step 3: Advance
      if (NextMatchID) {
        let fieldToUpdate = NextMatchSlot === 1 ? 'Participant1_ID' : 'Participant2_ID';
        await connection.query(
          `UPDATE Matches SET ${fieldToUpdate} = ? WHERE MatchID = ?`,
          [winnerId, NextMatchID]
        );
      }
    }

    await connection.commit();
    return { ok: true };
  } catch (error) {
    await connection.rollback();
    console.error(error);
    return { ok: false, msg: error.message };
  } finally {
    connection.release();
  }
}

async function updateMatchParticipant(matchId, slot, participantId) {
    const pool = getPool();
    const field = slot === 1 ? 'Participant1_ID' : 'Participant2_ID';
    await pool.query(`UPDATE Matches SET ${field} = ? WHERE MatchID = ?`, [participantId, matchId]);
    return { ok: true };
}

async function clearTournamentMatches(tournamentId) {
    const pool = getPool();
    await pool.query('DELETE FROM Matches WHERE TournamentID = ?', [tournamentId]);
    return { ok: true };
}

/* ------------------------------------------------------------------
   Link Operations
------------------------------------------------------------------ */

async function getAllLinks() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM links ORDER BY created_at DESC');
  return rows.map(row => ({
    id: Number(row.id),
    title: row.title,
    url: row.url,
    iconPath: row.icon_path,
    backgroundPath: row.background_path
  }));
}

async function addLink(linkData) {
  const pool = getPool();
  const { id, title, url, iconPath, backgroundPath } = linkData;
  await pool.query(
    'INSERT INTO links (id, title, url, icon_path, background_path) VALUES (?, ?, ?, ?, ?)',
    [id, title, url, iconPath, backgroundPath]
  );
  return { ok: true };
}

async function deleteLink(id) {
  const pool = getPool();
  await pool.query('DELETE FROM links WHERE id = ?', [id]);
  return { ok: true };
}

/* ------------------------------------------------------------------
   Brochure Operations
------------------------------------------------------------------ */

async function getAllBrochures() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM brochures ORDER BY created_at DESC');
  return rows.map(row => ({
    id: row.id,
    type: row.type,
    path: row.file_path,
    url: row.url,
    name: row.name,
    createdAt: row.created_at
  }));
}

async function addBrochure(brochureData) {
  const pool = getPool();
  const { type, path, url, name } = brochureData;
  const [result] = await pool.query(
    'INSERT INTO brochures (type, file_path, url, name) VALUES (?, ?, ?, ?)',
    [type, path, url, name]
  );
  return { ok: true, id: result.insertId };
}

async function deleteBrochure(id) {
  const pool = getPool();
  // Get file path first to return it for cleanup
  const [rows] = await pool.query('SELECT file_path FROM brochures WHERE id = ?', [id]);
  if (rows.length === 0) return { ok: false, msg: 'Brochure not found' };
  
  await pool.query('DELETE FROM brochures WHERE id = ?', [id]);
  return { ok: true, filePath: rows[0].file_path };
}

/* ------------------------------------------------------------------
   Map Operations
------------------------------------------------------------------ */

async function getLatestMap() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM maps ORDER BY created_at DESC LIMIT 1');
  if (rows.length === 0) return null;
  
  const row = rows[0];
  return {
    id: row.id,
    type: row.type,
    path: row.file_path,
    url: row.url,
    name: row.name,
    createdAt: row.created_at
  };
}

async function addMap(mapData) {
  const pool = getPool();
  const { type, path, url, name } = mapData;
  const [result] = await pool.query(
    'INSERT INTO maps (type, file_path, url, name) VALUES (?, ?, ?, ?)',
    [type, path, url, name]
  );
  return { ok: true, id: result.insertId };
}

async function deleteMap(id) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT file_path FROM maps WHERE id = ?', [id]);
  if (rows.length === 0) return { ok: false, msg: 'Map not found' };
  
  await pool.query('DELETE FROM maps WHERE id = ?', [id]);
  return { ok: true, filePath: rows[0].file_path };
}

async function deleteAllMaps() {
    const pool = getPool();
    const [rows] = await pool.query('SELECT file_path FROM maps');
    await pool.query('DELETE FROM maps');
    return { ok: true, filePaths: rows.map(r => r.file_path).filter(p => p) };
}

/* ------------------------------------------------------------------
   Settings Operations
------------------------------------------------------------------ */

async function getSetting(key) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT setting_value FROM settings WHERE setting_key = ?', [key]);
  if (rows.length === 0) return null;
  return rows[0].setting_value;
}

async function setSetting(key, value) {
  const pool = getPool();
  await pool.query(
    'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
    [key, value, value]
  );
  return { ok: true };
}

/* ------------------------------------------------------------------
   Background Operations
------------------------------------------------------------------ */

async function getAllBackgrounds() {
  const pool = getPool();
  const [rows] = await pool.query('SELECT * FROM backgrounds ORDER BY created_at DESC');
  return rows.map(row => ({
    id: row.id,
    path: row.file_path,
    url: row.url,
    name: row.name,
    createdAt: row.created_at
  }));
}

async function addBackground(bgData) {
  const pool = getPool();
  const { path, url, name } = bgData;
  const [result] = await pool.query(
    'INSERT INTO backgrounds (file_path, url, name) VALUES (?, ?, ?)',
    [path, url, name]
  );
  return { ok: true, id: result.insertId };
}

async function deleteBackground(id) {
  const pool = getPool();
  const [rows] = await pool.query('SELECT file_path FROM backgrounds WHERE id = ?', [id]);
  if (rows.length === 0) return { ok: false, msg: 'Background not found' };
  
  await pool.query('DELETE FROM backgrounds WHERE id = ?', [id]);
  // Also clear from page_backgrounds if used
  await pool.query('UPDATE page_backgrounds SET background_id = NULL WHERE background_id = ?', [id]);
  
  return { ok: true, filePath: rows[0].file_path };
}

async function setPageBackground(pageName, backgroundId) {
  const pool = getPool();
  if (pageName === 'all') {
    // Update all known pages
    const pages = ['index', 'bracket', 'brochure', 'map', 'link', 'tournament'];
    for (const p of pages) {
      await pool.query(
        'INSERT INTO page_backgrounds (page_name, background_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE background_id = ?',
        [p, backgroundId, backgroundId]
      );
    }
  } else {
    await pool.query(
      'INSERT INTO page_backgrounds (page_name, background_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE background_id = ?',
      [pageName, backgroundId, backgroundId]
    );
  }
  return { ok: true };
}

async function getPageBackgrounds() {
  const pool = getPool();
  const [rows] = await pool.query(`
    SELECT pb.page_name, b.url 
    FROM page_backgrounds pb 
    LEFT JOIN backgrounds b ON pb.background_id = b.id
  `);
  
  const result = {};
  rows.forEach(row => {
    result[row.page_name] = row.url;
  });
  return result;
}


/* ------------------------------------------------------------------
   Sequential Performance Operations
------------------------------------------------------------------ */

function mapPerformers(rows) {
  return rows.map(r => ({
    id: r.PerformerID,
    displayName: r.DisplayName,
    orderIndex: r.OrderIndex,
    totalScore: Number(r.TotalScore),
    isSelectedWinner: r.IsSelectedWinner === 1
  }));
}

async function ensurePerformanceState(pool, tournamentId) {
  await pool.query(
    'INSERT IGNORE INTO PerformanceState (TournamentID) VALUES (?)',
    [tournamentId]
  );
}

async function getPerformance(tournamentId) {
  const pool = getPool();
  await ensurePerformanceState(pool, tournamentId);
  const [perfRows] = await pool.query(
    'SELECT * FROM TournamentPerformers WHERE TournamentID = ? ORDER BY OrderIndex ASC',
    [tournamentId]
  );
  const [stateRows] = await pool.query(
    'SELECT * FROM PerformanceState WHERE TournamentID = ?',
    [tournamentId]
  );
  const [tRows] = await pool.query(
    'SELECT Name, Mode FROM Tournaments WHERE TournamentID = ?',[tournamentId]
  );
  const tournamentName = tRows.length ? tRows[0].Name : null;
  const mode = tRows.length ? (tRows[0].Mode || 'elimination') : 'elimination';
  const state = stateRows[0];
  return {
    tournamentId,
    tournamentName,
    mode,
    maxWinners: state.MaxWinners,
    showView: state.ShowView,
    currentIndex: state.CurrentIndex,
    scoringEnabled: state.ScoringEnabled === 1,
    finalized: state.Finalized === 1,
    performers: mapPerformers(perfRows),
    winners: mapPerformers(perfRows.filter(p => p.IsSelectedWinner === 1)).map(p => p.id)
  };
}

async function setPerformanceRoster(tournamentId, names) {
  const pool = getPool();
  await ensurePerformanceState(pool, tournamentId);
  await pool.query('DELETE FROM TournamentPerformers WHERE TournamentID = ?', [tournamentId]);
  let idx = 0;
  for (const raw of names) {
    const name = raw ? raw.trim() : '';
    if (!name) continue;
    await pool.query(
      'INSERT INTO TournamentPerformers (TournamentID, DisplayName, OrderIndex) VALUES (?, ?, ?)',
      [tournamentId, name, idx++]
    );
  }
  return getPerformance(tournamentId);
}

async function addPerformer(tournamentId, name) {
  const pool = getPool();
  await ensurePerformanceState(pool, tournamentId);
  const trimmed = name.trim();
  const [maxRow] = await pool.query(
    'SELECT COALESCE(MAX(OrderIndex), -1) as maxIdx FROM TournamentPerformers WHERE TournamentID = ?',
    [tournamentId]
  );
  const nextIndex = maxRow[0].maxIdx + 1;
  await pool.query(
    'INSERT INTO TournamentPerformers (TournamentID, DisplayName, OrderIndex) VALUES (?, ?, ?)',
    [tournamentId, trimmed, nextIndex]
  );
  return getPerformance(tournamentId);
}

async function reorderPerformers(tournamentId, fromIndex, toIndex) {
  if (fromIndex === toIndex) return getPerformance(tournamentId);
  const pool = getPool();
  const [rows] = await pool.query(
    'SELECT PerformerID, OrderIndex FROM TournamentPerformers WHERE TournamentID = ? ORDER BY OrderIndex ASC',
    [tournamentId]
  );
  if (fromIndex < 0 || toIndex < 0 || fromIndex >= rows.length || toIndex >= rows.length) {
    return getPerformance(tournamentId);
  }
  const moved = rows[fromIndex];
  rows.splice(fromIndex, 1);
  rows.splice(toIndex, 0, moved);
  // Reassign order indexes
  for (let i = 0; i < rows.length; i++) {
    await pool.query('UPDATE TournamentPerformers SET OrderIndex = ? WHERE PerformerID = ?', [i, rows[i].PerformerID]);
  }
  return getPerformance(tournamentId);
}

async function removePerformer(tournamentId, performerId) {
  const pool = getPool();
  await pool.query('DELETE FROM TournamentPerformers WHERE TournamentID = ? AND PerformerID = ?', [tournamentId, performerId]);
  // Re-pack order indices
  const [rows] = await pool.query('SELECT PerformerID FROM TournamentPerformers WHERE TournamentID = ? ORDER BY OrderIndex ASC', [tournamentId]);
  for (let i = 0; i < rows.length; i++) {
    await pool.query('UPDATE TournamentPerformers SET OrderIndex = ? WHERE PerformerID = ?', [i, rows[i].PerformerID]);
  }
  return getPerformance(tournamentId);
}

async function setCurrentIndex(tournamentId, index) {
  const pool = getPool();
  await ensurePerformanceState(pool, tournamentId);
  await pool.query('UPDATE PerformanceState SET CurrentIndex = ? WHERE TournamentID = ?', [index, tournamentId]);
  return getPerformance(tournamentId);
}

async function setScore(tournamentId, performerId, score) {
  const pool = getPool();
  await pool.query('UPDATE TournamentPerformers SET TotalScore = ? WHERE TournamentID = ? AND PerformerID = ?', [score, tournamentId, performerId]);
  return getPerformance(tournamentId);
}

async function selectWinners(tournamentId, performerIds) {
  const pool = getPool();
  // Reset all
  await pool.query('UPDATE TournamentPerformers SET IsSelectedWinner = 0 WHERE TournamentID = ?', [tournamentId]);
  if (Array.isArray(performerIds) && performerIds.length) {
    await pool.query(
      `UPDATE TournamentPerformers SET IsSelectedWinner = 1 WHERE TournamentID = ? AND PerformerID IN (${performerIds.map(() => '?').join(',')})`,
      [tournamentId, ...performerIds]
    );
  }
  return getPerformance(tournamentId);
}

async function finalizeWinners(tournamentId, source) {
  const pool = getPool();
  await ensurePerformanceState(pool, tournamentId);
  if (source === 'score') {
    // Auto-select top 10 by score
    const [rows] = await pool.query('SELECT PerformerID FROM TournamentPerformers WHERE TournamentID = ? ORDER BY TotalScore DESC, OrderIndex ASC LIMIT 10', [tournamentId]);
    const ids = rows.map(r => r.PerformerID);
    await selectWinners(tournamentId, ids);
  }
  await pool.query("UPDATE PerformanceState SET Finalized = 1, ShowView = 'winners' WHERE TournamentID = ?", [tournamentId]);
  return getPerformance(tournamentId);
}

async function setView(tournamentId, view) {
  const pool = getPool();
  await pool.query('UPDATE PerformanceState SET ShowView = ? WHERE TournamentID = ?', [view, tournamentId]);
  return getPerformance(tournamentId);
}

async function clearPerformance(tournamentId) {
  const pool = getPool();
  await pool.query('DELETE FROM TournamentPerformers WHERE TournamentID = ?', [tournamentId]);
  await pool.query("UPDATE PerformanceState SET CurrentIndex = -1, ShowView = 'order', Finalized = 0 WHERE TournamentID = ?", [tournamentId]);
  return getPerformance(tournamentId);
}

module.exports = {
  // Attendance
  getAllAttendance,
  addAttendanceName,
  markAttendance,
  resetAttendance,
  clearAllAttendance,
  updateRemark,
  updateTicketName,
  
  // Tournaments
  getAllTournaments,
  getTournamentById,
  createTournament,
  deleteTournament,
  
  // Bracket & Matches
  addParticipant,
  createMatch,
  getTournamentMatches,
  updateMatchResult,
  updateMatchParticipant,
  clearTournamentMatches,
  
  // Sequential Performance
  getPerformance,
  setPerformanceRoster,
  addPerformer,
  reorderPerformers,
  removePerformer,
  setCurrentIndex,
  setScore,
  selectWinners,
  finalizeWinners,
  setView,
  clearPerformance,
  
  // Links
  getAllLinks,
  addLink,
  deleteLink,
  
  // Brochures
  getAllBrochures,
  addBrochure,
  deleteBrochure,
  
  // Maps
  getLatestMap,
  addMap,
  deleteMap,
  deleteAllMaps,

  // Settings
  getSetting,
  setSetting,

  // Backgrounds
  getAllBackgrounds,
  addBackground,
  deleteBackground,
  setPageBackground,
  getPageBackgrounds
};