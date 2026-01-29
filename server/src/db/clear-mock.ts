/**
 * Clear Mock Data Script
 * 
 * Removes all data marked as mock/fake from the database.
 * This prepares the database for real Jira data.
 * 
 * Run with: npm run db:clear-mock
 */
import { initDatabase, closeDatabase, getDb } from './database.js';

console.log('🧹 Clearing mock data from database...\n');

try {
  initDatabase();
  const db = getDb();

  db.exec('BEGIN TRANSACTION');

  try {
    // Count mock data before deletion
    const counts = {
      tickets: (db.prepare('SELECT COUNT(*) as count FROM jira_tickets WHERE is_mock_data = 1').get() as any).count,
      burntHours: (db.prepare('SELECT COUNT(*) as count FROM burnt_hours WHERE is_mock_data = 1').get() as any).count,
      importBatches: (db.prepare('SELECT COUNT(*) as count FROM import_batches WHERE is_mock_data = 1').get() as any).count,
      users: (db.prepare('SELECT COUNT(*) as count FROM users WHERE is_mock_data = 1').get() as any).count,
      budgetPeriods: (db.prepare('SELECT COUNT(*) as count FROM budget_periods WHERE is_mock_data = 1').get() as any).count,
      reporterMappings: (db.prepare('SELECT COUNT(*) as count FROM reporter_mappings WHERE is_mock_data = 1').get() as any).count,
    };

    console.log('  📊 Found mock data:');
    console.log(`     - ${counts.tickets} tickets`);
    console.log(`     - ${counts.burntHours} burnt hours entries`);
    console.log(`     - ${counts.importBatches} import batches`);
    console.log(`     - ${counts.users} users`);
    console.log(`     - ${counts.budgetPeriods} budget periods`);
    console.log(`     - ${counts.reporterMappings} reporter mappings`);
    console.log('');

    // Delete mock data (order matters due to foreign keys)
    console.log('  🗑️  Deleting mock data...');
    
    db.prepare('DELETE FROM burnt_hours WHERE is_mock_data = 1').run();
    console.log('     ✓ Cleared burnt_hours');
    
    db.prepare('DELETE FROM import_batches WHERE is_mock_data = 1').run();
    console.log('     ✓ Cleared import_batches');
    
    db.prepare('DELETE FROM jira_tickets WHERE is_mock_data = 1').run();
    console.log('     ✓ Cleared jira_tickets');
    
    db.prepare('DELETE FROM reporter_mappings WHERE is_mock_data = 1').run();
    console.log('     ✓ Cleared reporter_mappings');
    
    db.prepare('DELETE FROM budget_periods WHERE is_mock_data = 1').run();
    console.log('     ✓ Cleared budget_periods');
    
    // Don't delete projects and applications - they're configuration
    // But we can update them to remove mock flag
    db.prepare('UPDATE jira_projects SET is_mock_data = 0').run();
    db.prepare('UPDATE applications SET is_mock_data = 0').run();
    console.log('     ✓ Updated projects and applications');

    // Keep mock users for now (useful for testing), but we could delete them
    // db.prepare('DELETE FROM users WHERE is_mock_data = 1').run();

    db.exec('COMMIT');

    console.log('\n✅ Mock data cleared successfully!');
    console.log('   Run "npm run sync:jira" to fetch real data from Jira.');

  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

} catch (error) {
  console.error('❌ Failed to clear mock data:', error);
  process.exit(1);
} finally {
  closeDatabase();
}
