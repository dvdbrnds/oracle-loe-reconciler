/**
 * Jira Sync Script
 * 
 * Fetches all tickets from configured Jira projects and syncs to database.
 * 
 * Run with: npm run sync:jira
 */
import { initDatabase, closeDatabase, getDb } from './database.js';
import { config } from '../config.js';
import { jiraService } from '../services/jira.js';

async function main() {
  console.log('🔄 Starting Jira sync...\n');

  if (config.useMockData) {
    console.log('⚠️  USE_MOCK_DATA is set to true. Set to false to sync real data.');
    process.exit(1);
  }

  if (!jiraService.isConfigured()) {
    console.log('❌ Jira is not configured. Check your .env file for:');
    console.log('   - JIRA_INSTANCE_URL');
    console.log('   - JIRA_API_EMAIL');
    console.log('   - JIRA_API_TOKEN');
    console.log('   - USE_MOCK_DATA=false');
    process.exit(1);
  }

  // Test connection first
  console.log('  🔌 Testing Jira connection...');
  const connectionTest = await jiraService.testConnection();
  if (!connectionTest.success) {
    console.log(`❌ Connection failed: ${connectionTest.error}`);
    process.exit(1);
  }
  console.log(`  ✓ Connected as ${connectionTest.user?.displayName}\n`);

  try {
    initDatabase();
    const db = getDb();

    const projects = config.jiraProjects.split(',').map(p => p.trim()).filter(Boolean);
    console.log(`  📂 Projects to sync: ${projects.join(', ')}\n`);

    let totalSynced = 0;
    let totalCreated = 0;
    let totalUpdated = 0;

    for (const projectKey of projects) {
      console.log(`  🔄 Syncing ${projectKey}...`);

      try {
        const issues = await jiraService.fetchProjectIssues(projectKey);
        console.log(`     Found ${issues.length} issues`);

        // Ensure project exists
        const phaseMap: Record<string, string> = {
          'MOHEECI': 'Implementation',
          'MOCSO': 'Stabilization',
          'MOCS': 'Support',
          'MOPT': 'Optimization',
          'MSPP': 'Pre-Planning',
        };

        db.prepare(`
          INSERT OR REPLACE INTO jira_projects (key, name, phase, is_mock_data)
          VALUES (?, ?, ?, 0)
        `).run(projectKey, projectKey, phaseMap[projectKey] || 'Implementation');

        const upsertStmt = db.prepare(`
          INSERT INTO jira_tickets (
            key, project_key, summary, application, module, priority, status,
            loe_hours, reporter_email, reporter_name, assignee_email, assignee_name,
            jira_created_at, jira_updated_at, is_mock_data, synced_at, loe_approved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'), ?)
          ON CONFLICT(key) DO UPDATE SET
            summary = excluded.summary,
            application = excluded.application,
            module = excluded.module,
            priority = excluded.priority,
            status = excluded.status,
            loe_hours = excluded.loe_hours,
            reporter_email = excluded.reporter_email,
            reporter_name = excluded.reporter_name,
            assignee_email = excluded.assignee_email,
            assignee_name = excluded.assignee_name,
            jira_updated_at = excluded.jira_updated_at,
            synced_at = datetime('now'),
            loe_approved_at = CASE 
              WHEN excluded.status = 'LOE Approved' AND (jira_tickets.status != 'LOE Approved' OR jira_tickets.loe_approved_at IS NULL)
              THEN datetime('now')
              WHEN excluded.status != 'LOE Approved'
              THEN NULL
              ELSE jira_tickets.loe_approved_at
            END
        `);

        let projectCreated = 0;
        let projectUpdated = 0;

        for (const issue of issues) {
          const transformed = jiraService.transformIssue(issue);
          const existing = db.prepare('SELECT key FROM jira_tickets WHERE key = ?').get(transformed.key);

          // For new tickets, set loe_approved_at if status is "LOE Approved"
          const loeApprovedAt = transformed.status === 'LOE Approved' ? new Date().toISOString() : null;

          upsertStmt.run(
            transformed.key,
            transformed.project_key,
            transformed.summary,
            transformed.application,
            transformed.module,
            transformed.priority,
            transformed.status,
            transformed.loe_hours,
            transformed.reporter_email,
            transformed.reporter_name,
            transformed.assignee_email,
            transformed.assignee_name,
            transformed.jira_created_at,
            transformed.jira_updated_at,
            loeApprovedAt
          );

          if (existing) {
            projectUpdated++;
          } else {
            projectCreated++;
          }
        }

        totalSynced += issues.length;
        totalCreated += projectCreated;
        totalUpdated += projectUpdated;

        console.log(`     ✓ ${projectCreated} created, ${projectUpdated} updated\n`);

      } catch (error) {
        console.log(`     ❌ Error: ${error}\n`);
      }
    }

    console.log('═'.repeat(50));
    console.log(`✅ Sync complete!`);
    console.log(`   Total: ${totalSynced} tickets`);
    console.log(`   Created: ${totalCreated}`);
    console.log(`   Updated: ${totalUpdated}`);

  } catch (error) {
    console.error('❌ Sync failed:', error);
    process.exit(1);
  } finally {
    closeDatabase();
  }
}

main().catch(console.error);
