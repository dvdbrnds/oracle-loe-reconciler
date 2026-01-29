/**
 * Database Seed Script
 * 
 * Populates the database with FAKE/MOCK data for development and testing.
 * ALL data created by this script is clearly marked with:
 * - is_mock_data = 1 flag in database
 * - "FAKE-" prefix on ticket keys
 * - "FAKE - " or "TEST - " prefix on names
 * - "[MOCK DATA]" prefix on descriptions
 * 
 * Run with: npm run db:seed
 */
import { initDatabase, closeDatabase, getDb } from './database.js';
import bcrypt from 'bcryptjs';

console.log('🌱 Seeding database with FAKE/MOCK data...');
console.log('⚠️  All data will be marked as MOCK DATA\n');

try {
  initDatabase();
  const db = getDb();

  // Seed in a transaction
  db.exec('BEGIN TRANSACTION');

  try {
    // ========================================
    // USERS (for testing auth)
    // ========================================
    console.log('  👤 Creating test users...');
    const passwordHash = bcrypt.hashSync('password123', 10);
    
    db.prepare(`
      INSERT OR IGNORE INTO users (email, password_hash, name, role, is_mock_data)
      VALUES (?, ?, ?, ?, 1)
    `).run('admin@example.com', passwordHash, 'FAKE - Admin User', 'admin');
    
    db.prepare(`
      INSERT OR IGNORE INTO users (email, password_hash, name, role, is_mock_data)
      VALUES (?, ?, ?, ?, 1)
    `).run('user@example.com', passwordHash, 'FAKE - Regular User', 'user');

    // ========================================
    // APPLICATIONS (Oracle Cloud modules)
    // ========================================
    console.log('  📱 Creating applications...');
    const applications = [
      { code: 'HCM', name: 'Human Capital Management' },
      { code: 'ERP', name: 'Enterprise Resource Planning' },
      { code: 'EPM', name: 'Enterprise Performance Management' },
      { code: 'FAW', name: 'Oracle Fusion Analytics Warehouse' },
      { code: 'SFP', name: 'Student Financial Planning' },
      { code: 'STU', name: 'Student Management Suite Cloud' },
    ];

    const insertApp = db.prepare(`
      INSERT OR IGNORE INTO applications (code, name, is_mock_data)
      VALUES (?, ?, 1)
    `);
    for (const app of applications) {
      insertApp.run(app.code, app.name);
    }

    // ========================================
    // JIRA PROJECTS
    // ========================================
    console.log('  📂 Creating Jira projects...');
    const projects = [
      { key: 'MOHEECI', name: 'Oracle HCM ERP EPM Cloud Implementation', phase: 'Implementation' },
      { key: 'MOCSO', name: 'Oracle Cloud Stabilization', phase: 'Stabilization' },
      { key: 'MOCS', name: 'Oracle Cloud Support', phase: 'Support' },
      { key: 'MOPT', name: 'HCM ERP EPM Optimization', phase: 'Optimization' },
      { key: 'MSPP', name: 'Oracle SMC Pre-Planning', phase: 'Pre-Planning' },
    ];

    const insertProject = db.prepare(`
      INSERT OR IGNORE INTO jira_projects (key, name, phase, is_mock_data)
      VALUES (?, ?, ?, 1)
    `);
    for (const proj of projects) {
      insertProject.run(proj.key, proj.name, proj.phase);
    }

    // ========================================
    // REPORTER MAPPINGS
    // ========================================
    console.log('  🗺️  Creating reporter mappings...');
    const reporterMappings = [
      { email: 'dior.mariano@example.com', name: 'FAKE - Dior Mariano', application: 'HCM', type: 'auto-map' },
      { email: 'justine.rossi@example.com', name: 'FAKE - Justine Rossi', application: 'HCM', type: 'auto-map' },
      { email: 'rachael.lyall@example.com', name: 'FAKE - Rachael Lyall', application: 'ERP', type: 'auto-map' },
      { email: 'sophia.eaton@example.com', name: 'FAKE - Sophia Eaton', application: 'EPM', type: 'auto-map' },
      { email: 'paul.edinger@example.com', name: 'FAKE - Paul Edinger', application: null, type: 'skip' },
    ];

    const insertReporter = db.prepare(`
      INSERT OR IGNORE INTO reporter_mappings (reporter_email, reporter_name, application, mapping_type, is_mock_data)
      VALUES (?, ?, ?, ?, 1)
    `);
    for (const rm of reporterMappings) {
      insertReporter.run(rm.email, rm.name, rm.application, rm.type);
    }

    // ========================================
    // BUDGET PERIODS (current and recent months)
    // ========================================
    console.log('  💰 Creating budget periods...');
    const now = new Date();
    const insertBudget = db.prepare(`
      INSERT OR IGNORE INTO budget_periods (year, month, allocated_hours, notes, is_mock_data)
      VALUES (?, ?, ?, ?, 1)
    `);
    
    // Create budget for current month and 3 previous months
    for (let i = 0; i < 4; i++) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      insertBudget.run(date.getFullYear(), date.getMonth() + 1, 100, '[MOCK DATA] Standard monthly allocation');
    }

    // ========================================
    // JIRA TICKETS (FAKE data)
    // ========================================
    console.log('  🎫 Creating FAKE Jira tickets...');
    
    const ticketData = [
      // HCM tickets
      { key: 'FAKE-MOCS-001', project: 'MOCS', summary: '[MOCK DATA] Payroll calculation issue for US employees', app: 'HCM', module: 'HCM - Payroll US', priority: 'Critical', status: 'LOE Approved', loe: 8, reporter: 'dior.mariano@example.com', reporterName: 'FAKE - Dior Mariano' },
      { key: 'FAKE-MOCS-002', project: 'MOCS', summary: '[MOCK DATA] Benefits enrollment form not loading', app: 'HCM', module: 'HCM - Benefits', priority: 'High', status: 'LOE Approved', loe: 4, reporter: 'justine.rossi@example.com', reporterName: 'FAKE - Justine Rossi' },
      { key: 'FAKE-MOCS-003', project: 'MOCS', summary: '[MOCK DATA] Time entry approval workflow stuck', app: 'HCM', module: 'HCM - Time and Labor', priority: 'Medium', status: 'LOE Provided', loe: 6, reporter: 'dior.mariano@example.com', reporterName: 'FAKE - Dior Mariano' },
      { key: 'FAKE-MOCSO-001', project: 'MOCSO', summary: '[MOCK DATA] Absence calendar sync issue', app: 'HCM', module: 'HCM - Absence Management', priority: 'Medium', status: 'LOE Approved', loe: 3, reporter: 'justine.rossi@example.com', reporterName: 'FAKE - Justine Rossi' },
      { key: 'FAKE-MOPT-001', project: 'MOPT', summary: '[MOCK DATA] Performance review workflow enhancement', app: 'HCM', module: 'HCM - Talent', priority: 'Low', status: 'LOE Provided', loe: 12, reporter: 'dior.mariano@example.com', reporterName: 'FAKE - Dior Mariano' },
      
      // ERP tickets
      { key: 'FAKE-MOCS-004', project: 'MOCS', summary: '[MOCK DATA] Invoice approval routing error', app: 'ERP', module: 'ERP - Accounts Payable', priority: 'High', status: 'LOE Approved', loe: 5, reporter: 'rachael.lyall@example.com', reporterName: 'FAKE - Rachael Lyall' },
      { key: 'FAKE-MOCS-005', project: 'MOCS', summary: '[MOCK DATA] GL journal entry posting failure', app: 'ERP', module: 'ERP - General Ledger', priority: 'Critical', status: 'LOE Approved', loe: 10, reporter: 'rachael.lyall@example.com', reporterName: 'FAKE - Rachael Lyall' },
      { key: 'FAKE-MOCSO-002', project: 'MOCSO', summary: '[MOCK DATA] Procurement approval hierarchy update', app: 'ERP', module: 'ERP - Procurement', priority: 'Medium', status: 'On Hold', loe: 8, reporter: 'rachael.lyall@example.com', reporterName: 'FAKE - Rachael Lyall' },
      { key: 'FAKE-MOPT-002', project: 'MOPT', summary: '[MOCK DATA] Custom financial report development', app: 'ERP', module: 'ERP - Financial Reporting', priority: 'Low', status: 'LOE Provided', loe: 20, reporter: 'rachael.lyall@example.com', reporterName: 'FAKE - Rachael Lyall' },
      
      // EPM tickets
      { key: 'FAKE-MOHEECI-001', project: 'MOHEECI', summary: '[MOCK DATA] EPM Planning module configuration', app: 'EPM', module: 'EPM - Planning', priority: 'High', status: 'LOE Approved', loe: 16, reporter: 'sophia.eaton@example.com', reporterName: 'FAKE - Sophia Eaton' },
      { key: 'FAKE-MOHEECI-002', project: 'MOHEECI', summary: '[MOCK DATA] Consolidation rules setup', app: 'EPM', module: 'EPM - Financial Consolidation', priority: 'High', status: 'LOE Approved', loe: 12, reporter: 'sophia.eaton@example.com', reporterName: 'FAKE - Sophia Eaton' },
      { key: 'FAKE-MOHEECI-003', project: 'MOHEECI', summary: '[MOCK DATA] EPM user training session', app: 'EPM', module: 'EPM - Training', priority: 'Medium', status: 'LOE Provided', loe: 8, reporter: 'sophia.eaton@example.com', reporterName: 'FAKE - Sophia Eaton' },
      
      // Cross-module/IT tickets
      { key: 'FAKE-MOCS-006', project: 'MOCS', summary: '[MOCK DATA] SSO integration troubleshooting', app: 'HCM', module: 'Integration', priority: 'High', status: 'Client Clarification Requested', loe: 6, reporter: 'paul.edinger@example.com', reporterName: 'FAKE - Paul Edinger' },
      { key: 'FAKE-MSPP-001', project: 'MSPP', summary: '[MOCK DATA] SFP requirements gathering', app: 'SFP', module: 'SFP - Planning', priority: 'Medium', status: 'LOE Provided', loe: 40, reporter: 'paul.edinger@example.com', reporterName: 'FAKE - Paul Edinger' },
    ];

    const insertTicket = db.prepare(`
      INSERT OR IGNORE INTO jira_tickets (
        key, project_key, summary, application, module, priority, status, 
        loe_hours, reporter_email, reporter_name, is_mock_data, jira_created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now', '-' || ? || ' days'))
    `);

    for (let i = 0; i < ticketData.length; i++) {
      const t = ticketData[i];
      const daysAgo = Math.floor(Math.random() * 60); // Random creation date within last 60 days
      insertTicket.run(t.key, t.project, t.summary, t.app, t.module, t.priority, t.status, t.loe, t.reporter, t.reporterName, daysAgo);
    }

    // ========================================
    // IMPORT BATCHES & BURNT HOURS (FAKE data)
    // ========================================
    console.log('  📊 Creating FAKE burnt hours data...');
    
    // Create a mock import batch
    const batchResult = db.prepare(`
      INSERT INTO import_batches (filename, row_count, total_hours, is_mock_data)
      VALUES (?, ?, ?, 1)
    `).run('FAKE_Burnt_Report_01-15-2026.xlsx', 20, 67.5);
    
    const batchId = batchResult.lastInsertRowid;

    // Insert burnt hours that partially match tickets
    const burntHoursData = [
      // Hours on approved LOE tickets (compliant)
      { ticket: 'FAKE-MOCS-001', project: 'MOCS', desc: '[MOCK DATA] Payroll fix - investigation', hours: 4.5 },
      { ticket: 'FAKE-MOCS-001', project: 'MOCS', desc: '[MOCK DATA] Payroll fix - implementation', hours: 3.5 },
      { ticket: 'FAKE-MOCS-002', project: 'MOCS', desc: '[MOCK DATA] Benefits form debugging', hours: 2.0 },
      { ticket: 'FAKE-MOCS-004', project: 'MOCS', desc: '[MOCK DATA] Invoice routing analysis', hours: 3.0 },
      { ticket: 'FAKE-MOCS-005', project: 'MOCS', desc: '[MOCK DATA] GL posting investigation', hours: 6.0 },
      { ticket: 'FAKE-MOCSO-001', project: 'MOCSO', desc: '[MOCK DATA] Absence calendar fix', hours: 2.5 },
      { ticket: 'FAKE-MOHEECI-001', project: 'MOHEECI', desc: '[MOCK DATA] EPM Planning config', hours: 10.0 },
      { ticket: 'FAKE-MOHEECI-002', project: 'MOHEECI', desc: '[MOCK DATA] Consolidation setup', hours: 8.0 },
      
      // Hours on unapproved LOE tickets (compliance issue!)
      { ticket: 'FAKE-MOCS-003', project: 'MOCS', desc: '[MOCK DATA] Time entry workflow - started before approval', hours: 2.0 },
      { ticket: 'FAKE-MOPT-001', project: 'MOPT', desc: '[MOCK DATA] Performance review analysis - unapproved', hours: 4.0 },
      { ticket: 'FAKE-MOHEECI-003', project: 'MOHEECI', desc: '[MOCK DATA] Training prep - pending approval', hours: 3.0 },
      
      // Admin/Overhead hours (no ticket key)
      { ticket: null, project: 'MOCS', desc: '[MOCK DATA] AMS - Account Management', hours: 5.0 },
      { ticket: null, project: 'MOCS', desc: '[MOCK DATA] Weekly status meeting', hours: 2.0 },
      { ticket: null, project: 'MOCS', desc: '[MOCK DATA] Project planning and coordination', hours: 3.0 },
    ];

    const insertBurntHours = db.prepare(`
      INSERT INTO burnt_hours (ticket_key, jira_project, description, hours, is_admin_overhead, import_batch_id, is_mock_data, work_date)
      VALUES (?, ?, ?, ?, ?, ?, 1, date('now', '-' || ? || ' days'))
    `);

    for (const bh of burntHoursData) {
      const isAdmin = bh.ticket === null ? 1 : 0;
      const daysAgo = Math.floor(Math.random() * 20); // Random work date within last 20 days
      insertBurntHours.run(bh.ticket, bh.project, bh.desc, bh.hours, isAdmin, batchId, daysAgo);
    }

    // Update batch totals
    db.prepare(`
      UPDATE import_batches 
      SET row_count = (SELECT COUNT(*) FROM burnt_hours WHERE import_batch_id = ?),
          total_hours = (SELECT SUM(hours) FROM burnt_hours WHERE import_batch_id = ?)
      WHERE id = ?
    `).run(batchId, batchId, batchId);

    db.exec('COMMIT');
    
    console.log('\n✅ Seed complete!');
    console.log('   📧 Test accounts created:');
    console.log('      admin@example.com / password123 (Admin)');
    console.log('      user@example.com / password123 (User)');
    console.log('   ⚠️  Remember: All data is marked as MOCK DATA');

  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

} catch (error) {
  console.error('❌ Seed failed:', error);
  process.exit(1);
} finally {
  closeDatabase();
}
