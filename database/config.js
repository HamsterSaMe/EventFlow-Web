const mysql = require('mysql2/promise');

// Database configuration
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
    // First connect without database to create it if it doesn't exist
    const tempConnection = await mysql.createConnection({
      host: dbConfig.host,
      user: dbConfig.user,
      password: dbConfig.password,
      port: dbConfig.port
    });

    // Create database if it doesn't exist
    await tempConnection.query(`CREATE DATABASE IF NOT EXISTS ${dbConfig.database}`);
    await tempConnection.end();

    // Create connection pool
    pool = mysql.createPool(dbConfig);

    // Create tables
    await createTables();
    
    // Ensure attendance schema alignment (indexes, column defaults, migrations)
    await ensureAttendanceSchema();

    console.log('✅ Database initialized successfully');
    return { ok: true };
  } catch (error) {
    console.error('❌ Database initialization error:', error);
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

    // Tournaments (with Mode)
    await connection.query(`
      CREATE TABLE IF NOT EXISTS Tournaments (
        TournamentID INT AUTO_INCREMENT PRIMARY KEY,
        Name VARCHAR(255) NOT NULL,
        BackgroundPath VARCHAR(255) NULL,
        Mode VARCHAR(50) NOT NULL DEFAULT 'elimination'
      )
    `);

    // Column migrations (idempotent)
    try {
      const [bgCols] = await connection.query("SHOW COLUMNS FROM Tournaments LIKE 'BackgroundPath'");
      if (bgCols.length === 0) {
        await connection.query("ALTER TABLE Tournaments ADD COLUMN BackgroundPath VARCHAR(255) NULL");
        console.log('✅ Added BackgroundPath column to Tournaments table');
      }
    } catch (err) { console.error('Error adding BackgroundPath:', err); }

    try {
      const [modeCols] = await connection.query("SHOW COLUMNS FROM Tournaments LIKE 'Mode'");
      if (modeCols.length === 0) {
        await connection.query("ALTER TABLE Tournaments ADD COLUMN Mode VARCHAR(50) NOT NULL DEFAULT 'elimination'");
        console.log('✅ Added Mode column to Tournaments table');
      }
    } catch (err) { console.error('Error adding Mode column:', err); }

    // Participants
    await connection.query(`
      CREATE TABLE IF NOT EXISTS Participants (
        ParticipantID INT AUTO_INCREMENT PRIMARY KEY,
        Name VARCHAR(255) NOT NULL
      )
    `);

    // Elimination Matches
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

    // Sequential Performance: Performers
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

    // Sequential Performance: State
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

    // Links (drop legacy schema if present)
    try {
      const [legacy] = await connection.query("SHOW COLUMNS FROM links LIKE 'icon'");
      if (legacy.length > 0) {
        await connection.query("DROP TABLE links");
        console.log('⚠️ Dropped legacy links table');
      }
    } catch (e) { /* ignore */ }

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

    // Brochures
    await connection.query(`
      CREATE TABLE IF NOT EXISTS brochures (
        id INT AUTO_INCREMENT NOT NULL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        file_path VARCHAR(255),
        url TEXT NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Maps
    await connection.query(`
      CREATE TABLE IF NOT EXISTS maps (
        id INT AUTO_INCREMENT NOT NULL PRIMARY KEY,
        type VARCHAR(50) NOT NULL,
        file_path VARCHAR(255),
        url TEXT NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Settings
    await connection.query(`
      CREATE TABLE IF NOT EXISTS settings (
        setting_key VARCHAR(50) NOT NULL PRIMARY KEY,
        setting_value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Backgrounds
    await connection.query(`
      CREATE TABLE IF NOT EXISTS backgrounds (
        id INT AUTO_INCREMENT NOT NULL PRIMARY KEY,
        file_path VARCHAR(255),
        url TEXT NOT NULL,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Page Backgrounds
    await connection.query(`
      CREATE TABLE IF NOT EXISTS page_backgrounds (
        page_name VARCHAR(50) NOT NULL PRIMARY KEY,
        background_id INT,
        FOREIGN KEY (background_id) REFERENCES backgrounds(id) ON DELETE SET NULL
      )
    `);

    console.log('✅ All tables created / migrated successfully');
  } finally {
    connection.release();
  }
}

/**
 * Ensure Attendance table schema matches app expectations:
 * - Ensure columns: status (NOT NULL DEFAULT 'absent'), remark (TEXT NULL), date_scanned (DATETIME NULL)
 * - Make ticket_name nullable
 * - NO unique index on name (allow duplicates, ID is unique identifier)
 * - If legacy attended exists and status was missing, migrate attended -> status
 */
async function ensureAttendanceSchema() {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  const connection = await pool.getConnection();
  try {
    // Table existence check
    const [tables] = await connection.query("SHOW TABLES LIKE 'attendance'");
    if (tables.length === 0) {
      console.warn('[DB] attendance table not found; will be created by createTables()');
      return;
    }

    // ticket_name -> ensure column exists and nullable
    const [tnCols] = await connection.query("SHOW COLUMNS FROM attendance LIKE 'ticket_name'");
    if (tnCols.length === 0) {
      await connection.query("ALTER TABLE attendance ADD COLUMN ticket_name VARCHAR(255) NULL");
    } else if (tnCols[0].Null === 'NO') {
      await connection.query("ALTER TABLE attendance MODIFY COLUMN ticket_name VARCHAR(255) NULL");
    }

    // remark TEXT NULL
    const [rmCols] = await connection.query("SHOW COLUMNS FROM attendance LIKE 'remark'");
    if (rmCols.length === 0) {
      await connection.query("ALTER TABLE attendance ADD COLUMN remark TEXT NULL");
    }

    // status VARCHAR(50) NOT NULL DEFAULT 'absent'
    const [stCols] = await connection.query("SHOW COLUMNS FROM attendance LIKE 'status'");
    const statusExists = stCols.length > 0;
    if (!statusExists) {
      await connection.query("ALTER TABLE attendance ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'absent'");
      // Migrate legacy attended -> status if present
      const [attCols] = await connection.query("SHOW COLUMNS FROM attendance LIKE 'attended'");
      if (attCols.length > 0) {
        await connection.query(
          "UPDATE attendance SET status = CASE WHEN attended = 1 OR attended = TRUE THEN 'present' ELSE 'absent' END"
        );
      }
    } else {
      const st = stCols[0];
      const needsFix =
        st.Null !== 'NO' ||
        !/varchar\(\s*50\s*\)/i.test(st.Type) ||
        (st.Default ?? null) !== 'absent';
      if (needsFix) {
        await connection.query("ALTER TABLE attendance MODIFY COLUMN status VARCHAR(50) NOT NULL DEFAULT 'absent'");
      }
    }

    // date_scanned DATETIME NULL
    const [dsCols] = await connection.query("SHOW COLUMNS FROM attendance LIKE 'date_scanned'");
    if (dsCols.length === 0) {
      await connection.query("ALTER TABLE attendance ADD COLUMN date_scanned DATETIME NULL");
    } else {
      const typeIsDatetime = dsCols[0].Type.toUpperCase() === 'DATETIME';
      const isNullable = dsCols[0].Null === 'YES';
      if (!typeIsDatetime || !isNullable) {
        await connection.query("ALTER TABLE attendance MODIFY COLUMN date_scanned DATETIME NULL");
      }
    }

    // Remove any unique index on name if exists (allow duplicate names)
    const [idxRows] = await connection.query(
      "SHOW INDEX FROM attendance WHERE Column_name = 'name' AND Non_unique = 0"
    );
    if (idxRows.length > 0) {
      const indexName = idxRows[0].Key_name;
      await connection.query(`ALTER TABLE attendance DROP INDEX ${indexName}`);
      console.log(`✅ Removed unique index on name: ${indexName}`);
    }

    console.log('✅ Attendance schema migration complete');
  } finally {
    connection.release();
  }
}

function getPool() {
  if (!pool) {
    throw new Error('Database pool not initialized');
  }
  return pool;
}

module.exports = {
  initializeDatabase,
  ensureAttendanceSchema,
  getPool
};