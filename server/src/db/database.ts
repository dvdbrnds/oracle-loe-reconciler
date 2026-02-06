import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(): Database.Database {
  // Resolve database path relative to server directory
  const dbPath = path.isAbsolute(config.databasePath)
    ? config.databasePath
    : path.resolve(__dirname, '../..', config.databasePath);

  console.log(`  📁 Database path: ${dbPath}`);

  // Ensure db directory exists
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable foreign keys and WAL mode for better performance
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  // Run migrations
  runMigrations(db);

  // Auto-create admin user if no users exist
  ensureAdminUser(db);

  return db;
}

/**
 * Creates or resets the default admin user on every startup.
 * This ensures there's always a way to log in after deploy.
 */
function ensureAdminUser(db: Database.Database): void {
  const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@moravian.edu';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'greyhound1742';
  const ADMIN_NAME = process.env.ADMIN_NAME || 'System Administrator';

  try {
    console.log(`  👤 Ensuring admin user exists: ${ADMIN_EMAIL}`);
    const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);
    
    // Always upsert - create or update the admin user
    db.prepare(`
      INSERT INTO users (email, password_hash, name, role, is_mock_data)
      VALUES (?, ?, ?, 'admin', 0)
      ON CONFLICT(email) DO UPDATE SET
        password_hash = excluded.password_hash,
        name = excluded.name,
        role = 'admin',
        updated_at = datetime('now')
    `).run(ADMIN_EMAIL, passwordHash, ADMIN_NAME);
    
    console.log(`  ✅ Admin user ready: ${ADMIN_EMAIL}`);
  } catch (error) {
    console.error('  ⚠️ Could not ensure admin user:', error);
  }
}

function runMigrations(db: Database.Database) {
  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Get applied migrations
  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map((r: any) => r.name)
  );

  // Define migrations
  const migrations = getMigrations();

  // Apply pending migrations
  for (const [name, sql] of Object.entries(migrations)) {
    if (!applied.has(name)) {
      console.log(`  📦 Applying migration: ${name}`);
      db.exec(sql);
      db.prepare('INSERT INTO migrations (name) VALUES (?)').run(name);
    }
  }
}

function getMigrations(): Record<string, string> {
  return {
    '001_initial_schema': `
      -- Users table for local authentication
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
        is_mock_data INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Sessions table
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Jira projects configuration
      CREATE TABLE jira_projects (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (phase IN ('Implementation', 'Stabilization', 'Support', 'Optimization', 'Pre-Planning')),
        is_active INTEGER DEFAULT 1,
        is_mock_data INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Applications (modules) configuration
      CREATE TABLE applications (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        budget_cap INTEGER,
        is_active INTEGER DEFAULT 1,
        is_mock_data INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Jira tickets synced from Jira or mock data
      CREATE TABLE jira_tickets (
        key TEXT PRIMARY KEY,
        project_key TEXT NOT NULL REFERENCES jira_projects(key),
        summary TEXT NOT NULL,
        description TEXT,
        application TEXT REFERENCES applications(code),
        module TEXT,
        priority TEXT,
        status TEXT NOT NULL,
        loe_hours REAL,
        reporter_email TEXT,
        reporter_name TEXT,
        assignee_email TEXT,
        assignee_name TEXT,
        is_mock_data INTEGER DEFAULT 0,
        jira_created_at TEXT,
        jira_updated_at TEXT,
        synced_at TEXT DEFAULT (datetime('now'))
      );

      -- Import batches for audit trail
      CREATE TABLE import_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        imported_by INTEGER REFERENCES users(id),
        row_count INTEGER DEFAULT 0,
        total_hours REAL DEFAULT 0,
        is_mock_data INTEGER DEFAULT 0,
        imported_at TEXT DEFAULT (datetime('now'))
      );

      -- Burnt hours from Excel imports
      CREATE TABLE burnt_hours (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_key TEXT,
        jira_project TEXT,
        description TEXT,
        hours REAL NOT NULL,
        is_admin_overhead INTEGER DEFAULT 0,
        import_batch_id INTEGER NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
        is_mock_data INTEGER DEFAULT 0,
        work_date TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Reporter mappings for classification fallback
      CREATE TABLE reporter_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reporter_email TEXT NOT NULL UNIQUE,
        reporter_name TEXT,
        application TEXT REFERENCES applications(code),
        mapping_type TEXT NOT NULL CHECK (mapping_type IN ('auto-map', 'skip')),
        is_mock_data INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Budget periods (monthly allocations)
      CREATE TABLE budget_periods (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        year INTEGER NOT NULL,
        month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
        allocated_hours REAL NOT NULL DEFAULT 100,
        notes TEXT,
        is_mock_data INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(year, month)
      );

      -- Alerts configuration
      CREATE TABLE alerts_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_type TEXT NOT NULL,
        channel TEXT NOT NULL CHECK (channel IN ('google_chat', 'slack', 'teams', 'email')),
        webhook_url TEXT,
        is_enabled INTEGER DEFAULT 1,
        threshold_percent INTEGER,
        is_mock_data INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Alerts log
      CREATE TABLE alerts_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        alert_type TEXT NOT NULL,
        channel TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
        error_message TEXT,
        is_mock_data INTEGER DEFAULT 0,
        sent_at TEXT DEFAULT (datetime('now'))
      );

      -- Create indexes for common queries
      CREATE INDEX idx_jira_tickets_project ON jira_tickets(project_key);
      CREATE INDEX idx_jira_tickets_application ON jira_tickets(application);
      CREATE INDEX idx_jira_tickets_status ON jira_tickets(status);
      CREATE INDEX idx_burnt_hours_ticket ON burnt_hours(ticket_key);
      CREATE INDEX idx_burnt_hours_batch ON burnt_hours(import_batch_id);
      CREATE INDEX idx_sessions_user ON sessions(user_id);
      CREATE INDEX idx_sessions_expires ON sessions(expires_at);
    `,

    '002_loe_approved_at': `
      -- Add loe_approved_at column to track when tickets were approved for billing
      ALTER TABLE jira_tickets ADD COLUMN loe_approved_at TEXT;

      -- Backfill: For existing "LOE Approved" tickets, use jira_updated_at as approximation
      UPDATE jira_tickets 
      SET loe_approved_at = jira_updated_at 
      WHERE status = 'LOE Approved' AND loe_approved_at IS NULL;

      -- Create index for period-based queries
      CREATE INDEX idx_jira_tickets_loe_approved_at ON jira_tickets(loe_approved_at);
    `,

    '003_import_duplicate_detection': `
      -- Add content_hash to detect exact duplicate files (same file, different name)
      ALTER TABLE import_batches ADD COLUMN content_hash TEXT;

      -- Add data_fingerprint to detect same data in different files
      ALTER TABLE import_batches ADD COLUMN data_fingerprint TEXT;

      -- Create indexes for fast duplicate lookups
      CREATE INDEX idx_import_batches_content_hash ON import_batches(content_hash);
      CREATE INDEX idx_import_batches_data_fingerprint ON import_batches(data_fingerprint);
    `,

    '004_deduplicate_burnt_hours': `
      -- One-time cleanup: Remove duplicate burnt_hours records
      -- Duplicates are identified by same ticket_key + work_date + hours + description
      -- We keep the record with the lowest id (first imported)
      
      -- Step 1: Delete duplicate records (keep lowest id per group)
      DELETE FROM burnt_hours
      WHERE id NOT IN (
        SELECT MIN(id)
        FROM burnt_hours
        WHERE is_mock_data = 0
        GROUP BY ticket_key, work_date, hours, description
      )
      AND is_mock_data = 0;

      -- Step 2: Delete sum/total rows that slipped through before the fix
      DELETE FROM burnt_hours
      WHERE is_mock_data = 0
      AND (
        LOWER(description) = 'sum'
        OR LOWER(description) = 'total'
        OR LOWER(description) = 'grand total'
        OR LOWER(description) = 'subtotal'
        OR LOWER(description) LIKE 'total:%'
        OR LOWER(description) LIKE 'sum:%'
        OR LOWER(description) LIKE '%grand total%'
        OR LOWER(jira_project) = 'sum'
        OR LOWER(jira_project) = 'total'
        OR LOWER(jira_project) = 'grand total'
      );

      -- Step 3: Update import_batches totals to reflect actual data
      UPDATE import_batches
      SET 
        row_count = (
          SELECT COUNT(*) FROM burnt_hours 
          WHERE burnt_hours.import_batch_id = import_batches.id
        ),
        total_hours = (
          SELECT COALESCE(SUM(hours), 0) FROM burnt_hours 
          WHERE burnt_hours.import_batch_id = import_batches.id
        )
      WHERE is_mock_data = 0;

      -- Step 4: Delete empty import batches (all records were duplicates/totals)
      DELETE FROM import_batches
      WHERE is_mock_data = 0
      AND id NOT IN (SELECT DISTINCT import_batch_id FROM burnt_hours WHERE is_mock_data = 0);
    `,

    '005_ticket_schedules': `
      -- Ticket scheduling table for forecasting feature
      -- Tracks which month each ticket is scheduled for work
      CREATE TABLE ticket_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_key TEXT NOT NULL REFERENCES jira_tickets(key) ON DELETE CASCADE,
        scheduled_year INTEGER NOT NULL,
        scheduled_month INTEGER NOT NULL CHECK (scheduled_month >= 1 AND scheduled_month <= 12),
        scheduled_hours REAL,              -- Override LOE hours if needed
        auto_scheduled INTEGER DEFAULT 1,  -- 1 = auto-scheduled, 0 = manually scheduled
        priority_locked INTEGER DEFAULT 0, -- 1 = P1/P2/Payroll, cannot be deferred
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(ticket_key, scheduled_year, scheduled_month)
      );

      -- Indexes for common queries
      CREATE INDEX idx_ticket_schedules_ticket ON ticket_schedules(ticket_key);
      CREATE INDEX idx_ticket_schedules_period ON ticket_schedules(scheduled_year, scheduled_month);
      CREATE INDEX idx_ticket_schedules_auto ON ticket_schedules(auto_scheduled);
    `,
  };
}

export function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}
