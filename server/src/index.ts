import { app } from './app.js';
import { config } from './config.js';
import { initDatabase, getDb } from './db/database.js';
import { jiraService } from './services/jira.js';

let syncInterval: NodeJS.Timeout | null = null;

/**
 * Sync tickets from Jira to database
 */
async function syncJiraTickets(): Promise<void> {
  if (config.useMockData || !jiraService.isConfigured()) {
    return;
  }

  const projects = config.jiraProjects.split(',').map(p => p.trim()).filter(Boolean);
  const db = getDb();
  let totalSynced = 0;

  console.log(`🔄 [${new Date().toLocaleTimeString()}] Starting automatic Jira sync...`);

  for (const projectKey of projects) {
    try {
      const issues = await jiraService.fetchProjectIssues(projectKey);

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

      for (const issue of issues) {
        const transformed = jiraService.transformIssue(issue);
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
      }

      totalSynced += issues.length;
    } catch (error) {
      console.error(`   ❌ Failed to sync ${projectKey}:`, error);
    }
  }

  console.log(`   ✅ Synced ${totalSynced} tickets from ${projects.length} projects`);
}

/**
 * Start automatic Jira sync scheduler
 */
function startSyncScheduler(): void {
  if (config.useMockData) {
    console.log('⚠️  Mock data mode - automatic sync disabled');
    return;
  }

  if (!jiraService.isConfigured()) {
    console.log('⚠️  Jira not configured - automatic sync disabled');
    return;
  }

  const intervalMs = config.jiraSyncIntervalMinutes * 60 * 1000;
  
  console.log(`⏰ Automatic Jira sync scheduled every ${config.jiraSyncIntervalMinutes} minutes`);
  
  // Run initial sync after 5 seconds (let server start first)
  setTimeout(() => {
    syncJiraTickets().catch(console.error);
  }, 5000);

  // Schedule recurring sync
  syncInterval = setInterval(() => {
    syncJiraTickets().catch(console.error);
  }, intervalMs);
}

async function main() {
  try {
    // Initialize database
    console.log('🗄️  Initializing database...');
    initDatabase();

    // Start server (bind to 0.0.0.0 in Docker so Coolify/health checks can reach it)
    app.listen(config.port, config.host, () => {
      console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                 VENDOR HOURS TRACKER                          ║
╠═══════════════════════════════════════════════════════════════╣
║  🚀 Server running on http://localhost:${config.port}                  ║
║  📊 Environment: ${config.nodeEnv.padEnd(41)}║
║  🗄️  Database: ${config.databasePath.padEnd(44)}║
║  ${config.useMockData ? '⚠️  DEMO MODE - Using simulated data' : '✅ Live Mode - Connected to Jira'}${' '.repeat(config.useMockData ? 25 : 23)}║
╚═══════════════════════════════════════════════════════════════╝
      `);

      // Start automatic sync scheduler
      startSyncScheduler();
    });

    // Graceful shutdown handler
    const gracefulShutdown = (signal: string) => {
      console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
      if (syncInterval) {
        clearInterval(syncInterval);
        syncInterval = null;
      }
      // Allow time for cleanup
      setTimeout(() => {
        console.log('👋 Server shutdown complete.');
        process.exit(0);
      }, 1000);
    };

    // Handle shutdown signals (PM2 sends SIGINT, then SIGTERM)
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error('❌ Uncaught Exception:', error);
      gracefulShutdown('uncaughtException');
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

main();
