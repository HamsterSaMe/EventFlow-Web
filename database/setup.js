// Run this file once to set up your database
// Usage: node database/setup.js

const { pool } = require('./config'); // mysql2/promise pool

async function columnExists(table, column) {
  const [rows] = await pool.query(
    `SELECT 1 FROM information_schema.COLUMNS 
     WHERE TABLE_SCHEMA = DATABASE() 
       AND TABLE_NAME = ? 
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows.length > 0;
}

async function ensureAttendanceSchema() {
  const hasStatus = await columnExists('attendance', 'status');
  const hasRemark = await columnExists('attendance', 'remark');
  const hasDate = await columnExists('attendance', 'date_scanned');
  const hasTicketName = await columnExists('attendance', 'ticket_name');
  const hasAttended = await columnExists('attendance', 'attended'); // legacy boolean

  const alters = [];

  if (!hasStatus) {
    alters.push(`ADD COLUMN status ENUM('present','absent') NOT NULL DEFAULT 'absent'`);
  }
  if (!hasRemark) {
    alters.push(`ADD COLUMN remark TEXT NULL`);
  }
  if (!hasDate) {
    alters.push(`ADD COLUMN date_scanned DATETIME NULL`);
  }
  if (!hasTicketName) {
    alters.push(`ADD COLUMN ticket_name VARCHAR(255) NULL`);
  }

  if (alters.length > 0) {
    await pool.query(`ALTER TABLE attendance ${alters.join(', ')}`);
  }

  // Migrate legacy 'attended' -> 'status'
  if (!hasStatus && hasAttended) {
    await pool.query(`
      UPDATE attendance 
      SET status = CASE WHEN attended = 1 THEN 'present' ELSE 'absent' END
    `);
  }
}

module.exports = { ensureAttendanceSchema };