/**
 * Database Migration Script
 * 
 * Run with: npm run db:migrate
 */
import { initDatabase, closeDatabase } from './database.js';

console.log('🔄 Running database migrations...');

try {
  initDatabase();
  console.log('✅ Migrations complete!');
} catch (error) {
  console.error('❌ Migration failed:', error);
  process.exit(1);
} finally {
  closeDatabase();
}
