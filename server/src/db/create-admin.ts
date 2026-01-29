/**
 * Create Admin User Script
 * 
 * Creates or updates the admin user with the specified credentials.
 * This user is NOT marked as mock data.
 * 
 * Usage: 
 *   npm run db:create-admin
 *   
 * Or with custom credentials via environment variables:
 *   ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=secret123 npm run db:create-admin
 */
import { initDatabase, closeDatabase, getDb } from './database.js';
import bcrypt from 'bcryptjs';

// Default admin credentials (can be overridden via environment variables)
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@moravian.edu';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'greyhound1742';
const ADMIN_NAME = process.env.ADMIN_NAME || 'System Administrator';

console.log('👤 Creating admin user...');
console.log(`   Email: ${ADMIN_EMAIL}`);
console.log('');

try {
  initDatabase();
  const db = getDb();

  // Hash the password
  const passwordHash = bcrypt.hashSync(ADMIN_PASSWORD, 10);

  // Check if user already exists
  const existingUser = db.prepare('SELECT id, email FROM users WHERE email = ?').get(ADMIN_EMAIL) as { id: number; email: string } | undefined;

  if (existingUser) {
    // Update existing user
    db.prepare(`
      UPDATE users 
      SET password_hash = ?, name = ?, role = 'admin', is_mock_data = 0, updated_at = datetime('now')
      WHERE email = ?
    `).run(passwordHash, ADMIN_NAME, ADMIN_EMAIL);
    
    console.log('✅ Admin user updated successfully!');
  } else {
    // Create new user
    db.prepare(`
      INSERT INTO users (email, password_hash, name, role, is_mock_data)
      VALUES (?, ?, ?, 'admin', 0)
    `).run(ADMIN_EMAIL, passwordHash, ADMIN_NAME);
    
    console.log('✅ Admin user created successfully!');
  }

  console.log('');
  console.log('   You can now log in with:');
  console.log(`   📧 Email: ${ADMIN_EMAIL}`);
  console.log('   🔑 Password: (the password you set)');
  console.log('');

} catch (error) {
  console.error('❌ Failed to create admin user:', error);
  process.exit(1);
} finally {
  closeDatabase();
}
