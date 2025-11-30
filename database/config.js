const mysql = require('mysql2/promise');

// ==============================================================================
// 🔧 SHARED AZURE DATABASE CONFIGURATION
// This ensures both the Website and Electron App use the exact same DB.
// ==============================================================================
const dbConfig = {
  host: process.env.DB_HOST || 'eventflowmysql.mysql.database.azure.com',
  user: process.env.DB_USER || 'eventflowadmin',
  password: process.env.DB_PASSWORD || 'MySqlSL82*', 
  database: process.env.DB_NAME || 'eventflow_db',
  port: Number(process.env.DB_PORT || 3306),
  ssl: {
    rejectUnauthorized: false // Required for Azure
  }
};

// Create connection pool
let pool = null;

async function initializeDatabase() {
  try {
    // 1. Test Connection
    // Note: We use the config values directly to ensure consistency
    const tempConnection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      port: dbConfig.port,
      ssl: dbConfig.ssl
    });

    // 2. Ensure DB Exists
    await tempConnection.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
    await tempConnection.end();

    // 3. Create Pool
    pool = mysql.createPool(dbConfig);

    // 4. Setup Tables (Schema synchronization)
    await createTables();
    await ensureAttendanceSchema();

    console.log('✅ Azure Server connected to Database successfully');
    return { ok: true };
  } catch (error) {
    console.error('❌ Database Initialization Error:', error.message);
    return { ok: false, error: error.message };
  }
}

async function createTables() {
  const connection = await pool.getConnection();
  try {
    // Attendance
    await connection.query(`
      CREATE TABLE IF NOT EXISTS attendance (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        ticket_name VARCHAR(255) NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'absent',
        remark TEXT NULL,
        date_scanned DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Tournaments
    await connection.query(`
      CREATE TABLE IF NOT EXISTS Tournaments (
        TournamentID INT AUTO_INCREMENT PRIMARY KEY,
        Name VARCHAR(255) NOT NULL,
        BackgroundPath VARCHAR(255) NULL,
        Mode VARCHAR(50) NOT NULL DEFAULT 'elimination'
      )
    `);

    // Fix Columns
    try {
      const [bgCols] = await connection.query("SHOW COLUMNS FROM Tournaments LIKE 'BackgroundPath'");
      if (bgCols.length === 0) await connection.query("ALTER TABLE Tournaments ADD COLUMN BackgroundPath VARCHAR(255) NULL");
      
      const [modeCols] = await connection.query("SHOW COLUMNS FROM Tournaments LIKE 'Mode'");
      if (modeCols.length === 0) await connection.query("ALTER TABLE Tournaments ADD COLUMN Mode VARCHAR(50) NOT NULL DEFAULT 'elimination'");
    } catch (err) { console.error('Migration Warning:', err.message); }

    // Participants
    await connection.query(`
      CREATE TABLE IF NOT EXISTS Participants (
        ParticipantID INT AUTO_INCREMENT PRIMARY KEY,
        Name VARCHAR(255) NOT NULL
      )
    `);

    // Matches
    await connection.query(`
      CREATE TABLE IF NOT EXISTS Matches (
        MatchID INT AUTO_INCREMENT PRIMARY KEY,
        TournamentID INT NOT NULL,
        Participant1_ID INT NULL,
        Participant2_ID INT NULL,
        Winner_ID INT NULL,
        Score1 INT NULL,
        Score2 INT NULL,
        NextMatchID INT NULL,
        NextMatchSlot INT NULL,
        FOREIGN KEY (TournamentID) REFERENCES Tournaments(TournamentID) ON DELETE CASCADE,
        FOREIGN KEY (Participant1_ID) REFERENCES Participants(ParticipantID) ON DELETE SET NULL,
        FOREIGN KEY (Participant2_ID) REFERENCES Participants(ParticipantID) ON DELETE SET NULL,
        FOREIGN KEY (Winner_ID) REFERENCES Participants(ParticipantID) ON DELETE SET NULL,
        FOREIGN KEY (NextMatchID) REFERENCES Matches(MatchID) ON DELETE SET NULL
      )
    `);

    // Performance
    await connection.query(`
      CREATE TABLE IF NOT EXISTS TournamentPerformers (
        PerformerID INT AUTO_INCREMENT PRIMARY KEY,
        TournamentID INT NOT NULL,
        ParticipantID INT NULL,
        DisplayName VARCHAR(255) NULL,
        OrderIndex INT NOT NULL,
        TotalScore DECIMAL(10,2) NOT NULL DEFAULT 0,
        IsSelectedWinner TINYINT(1) NOT NULL DEFAULT 0,
        CreatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (TournamentID) REFERENCES Tournaments(TournamentID) ON DELETE CASCADE,
        FOREIGN KEY (ParticipantID) REFERENCES Participants(ParticipantID) ON DELETE SET NULL
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS PerformanceState (
        TournamentID INT NOT NULL PRIMARY KEY,
        CurrentIndex INT NOT NULL DEFAULT -1,
        ShowView ENUM('order','winners') NOT NULL DEFAULT 'order',
        MaxWinners INT NOT NULL DEFAULT 10,
        ScoringEnabled TINYINT(1) NOT NULL DEFAULT 1,
        Finalized TINYINT(1) NOT NULL DEFAULT 0,
        FOREIGN KEY (TournamentID) REFERENCES Tournaments(TournamentID) ON DELETE CASCADE
      )
    `);

    // Links
    try {
      const [legacy] = await connection.query("SHOW COLUMNS FROM links LIKE 'icon'");
      if (legacy.length > 0) await connection.query("DROP TABLE links");
    } catch (e) {}

    await connection.query(`
      CREATE TABLE IF NOT EXISTS links (
        id BIGINT NOT NULL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        url TEXT NOT NULL,
        icon_path VARCHAR(255),
        background_path VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Media Tables
    const mediaTables = ['brochures', 'maps', 'backgrounds'];
    for (const tbl of mediaTables) {
      await connection.query(`
        CREATE TABLE IF NOT EXISTS ${tbl} (
          id INT AUTO_INCREMENT NOT NULL PRIMARY KEY,
          ${tbl === 'brochures' || tbl === 'maps' ? 'type VARCHAR(50) NOT NULL,' : ''}
          file_path VARCHAR(255),
          url TEXT NOT NULL,
          name VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }

    // Settings & Config
    await connection.query(`
      CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(50) NOT NULL PRIMARY KEY,
        setting_value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS page_backgrounds (
        page_name VARCHAR(50) NOT NULL PRIMARY KEY,
        background_id INT,
        FOREIGN KEY (background_id) REFERENCES backgrounds(id) ON DELETE SET NULL
      )
    `);

  } finally {
    connection.release();
  }
}

async function ensureAttendanceSchema() {
  if (!pool) return;
  const connection = await pool.getConnection();
  try {
    const [tables] = await connection.query("SHOW TABLES LIKE 'attendance'");
    if (tables.length === 0) return;

    const cols = {
      'ticket_name': "VARCHAR(255) NULL",
      'remark': "TEXT NULL",
      'status': "VARCHAR(50) NOT NULL DEFAULT 'absent'",
      'date_scanned': "DATETIME NULL"
    };

    for (const [col, def] of Object.entries(cols)) {
      const [check] = await connection.query(`SHOW COLUMNS FROM attendance LIKE '${col}'`);
      if (check.length === 0) {
        await connection.query(`ALTER TABLE attendance ADD COLUMN ${col} ${def}`);
      }
    }

    const [idxRows] = await connection.query("SHOW INDEX FROM attendance WHERE Column_name = 'name' AND Non_unique = 0");
    if (idxRows.length > 0) {
      await connection.query(`ALTER TABLE attendance DROP INDEX ${idxRows[0].Key_name}`);
    }
  } finally {
    connection.release();
  }
}

function getPool() {
  if (!pool) throw new Error('Database pool not initialized');
  return pool;
}

module.exports = {
  initializeDatabase,
  ensureAttendanceSchema,
  getPool
};