import { Router } from 'express';
import { getDb } from '../db/database.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';
import { config } from '../config.js';
import { jiraService, JiraSyncResult } from '../services/jira.js';

export const syncRouter = Router();

syncRouter.use(authenticate);

// Get sync status
syncRouter.get('/status', (req, res, next) => {
  try {
    const db = getDb();

    // Get last sync time
    const lastTicket = db.prepare(`
      SELECT MAX(synced_at) as last_sync
      FROM jira_tickets
      WHERE is_mock_data = 0
    `).get() as { last_sync: string | null };

    // Get ticket counts by project (real data only)
    const ticketCounts = db.prepare(`
      SELECT 
        project_key,
        COUNT(*) as count,
        MAX(synced_at) as last_sync
      FROM jira_tickets
      WHERE is_mock_data = 0
      GROUP BY project_key
    `).all() as Array<{ project_key: string; count: number; last_sync: string }>;

    // Check if Jira is properly configured
    const jiraConfigured = jiraService.isConfigured();

    res.json({
      useMockData: config.useMockData,
      jiraConfigured,
      jiraInstanceUrl: config.jiraInstanceUrl,
      configuredProjects: config.jiraProjects.split(','),
      syncIntervalMinutes: config.jiraSyncIntervalMinutes,
      lastSync: lastTicket.last_sync,
      projectStats: ticketCounts,
    });
  } catch (error) {
    next(error);
  }
});

// Manual sync trigger (admin only)
syncRouter.post('/jira', requireAdmin, async (req, res, next) => {
  try {
    if (config.useMockData) {
      res.json({
        success: true,
        message: 'Mock data mode enabled - no sync performed',
        useMockData: true,
      });
      return;
    }

    if (!jiraService.isConfigured()) {
      res.json({
        success: false,
        message: 'Jira credentials not configured. Set JIRA_INSTANCE_URL, JIRA_API_EMAIL, JIRA_API_TOKEN and USE_MOCK_DATA=false.',
        requiredConfig: [
          'JIRA_INSTANCE_URL',
          'JIRA_API_EMAIL',
          'JIRA_API_TOKEN',
          'USE_MOCK_DATA=false',
        ],
      });
      return;
    }

    const projects = config.jiraProjects.split(',').map(p => p.trim()).filter(Boolean);
    const results: JiraSyncResult[] = [];
    const db = getDb();

    console.log(`🔄 Starting Jira sync for projects: ${projects.join(', ')}`);

    for (const projectKey of projects) {
      const result: JiraSyncResult = {
        projectKey,
        ticketsSynced: 0,
        ticketsCreated: 0,
        ticketsUpdated: 0,
        errors: [],
      };

      try {
        console.log(`  📂 Fetching issues from ${projectKey}...`);
        const issues = await jiraService.fetchProjectIssues(projectKey);
        console.log(`     Found ${issues.length} issues`);

        // Ensure project exists in database
        db.prepare(`
          INSERT OR IGNORE INTO jira_projects (key, name, phase, is_mock_data)
          VALUES (?, ?, ?, 0)
        `).run(projectKey, projectKey, getProjectPhase(projectKey));

        // Upsert with all relevant fields
        const upsertStmt = db.prepare(`
          INSERT INTO jira_tickets (
            key, project_key, summary, priority, status, 
            assignee_email, assignee_name, reporter_email, reporter_name,
            loe_hours, jira_created_at, jira_updated_at, is_mock_data, synced_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            summary = excluded.summary,
            priority = excluded.priority,
            status = excluded.status,
            assignee_email = excluded.assignee_email,
            assignee_name = excluded.assignee_name,
            reporter_email = excluded.reporter_email,
            reporter_name = excluded.reporter_name,
            loe_hours = excluded.loe_hours,
            jira_updated_at = excluded.jira_updated_at,
            synced_at = datetime('now')
        `);

        for (const issue of issues) {
          try {
            const transformed = jiraService.transformIssue(issue);
            
            // Check if ticket exists
            const existing = db.prepare('SELECT key FROM jira_tickets WHERE key = ?').get(transformed.key);
            
            upsertStmt.run(
              transformed.key,
              transformed.project_key,
              transformed.summary,
              transformed.priority,
              transformed.status,
              transformed.assignee_email,
              transformed.assignee_name,
              transformed.reporter_email,
              transformed.reporter_name,
              transformed.loe_hours,
              transformed.jira_created_at,
              transformed.jira_updated_at
            );

            result.ticketsSynced++;
            if (existing) {
              result.ticketsUpdated++;
            } else {
              result.ticketsCreated++;
            }
          } catch (issueError) {
            result.errors.push(`Failed to sync ${issue.key}: ${issueError}`);
            console.error(`     ❌ Error syncing ${issue.key}:`, issueError);
          }
        }

        console.log(`     ✅ Synced ${result.ticketsSynced} issues (${result.ticketsCreated} new, ${result.ticketsUpdated} updated)`);
      } catch (projectError) {
        result.errors.push(`Failed to fetch project: ${projectError}`);
        console.error(`     ❌ Error: ${projectError}`);
      }

      results.push(result);
    }

    const totalSynced = results.reduce((sum, r) => sum + r.ticketsSynced, 0);
    const totalCreated = results.reduce((sum, r) => sum + r.ticketsCreated, 0);
    const totalUpdated = results.reduce((sum, r) => sum + r.ticketsUpdated, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors.length, 0);

    console.log(`\n✅ Jira sync complete: ${totalSynced} tickets (${totalCreated} new, ${totalUpdated} updated), ${totalErrors} errors`);

    res.json({
      success: totalErrors === 0,
      message: `Synced ${totalSynced} tickets from ${projects.length} projects`,
      summary: {
        totalSynced,
        totalCreated,
        totalUpdated,
        totalErrors,
      },
      results,
    });
  } catch (error) {
    next(error);
  }
});

// Test Jira connection (admin only)
syncRouter.post('/test-connection', requireAdmin, async (req, res, next) => {
  try {
    if (config.useMockData) {
      res.json({
        success: true,
        message: 'Mock data mode - connection test skipped',
        useMockData: true,
      });
      return;
    }

    if (!jiraService.isConfigured()) {
      res.json({
        success: false,
        message: 'Jira credentials not configured',
        missingConfig: {
          jiraInstanceUrl: !config.jiraInstanceUrl,
          jiraApiEmail: !config.jiraApiEmail,
          jiraApiToken: !config.jiraApiToken,
        },
      });
      return;
    }

    const result = await jiraService.testConnection();

    if (result.success) {
      res.json({
        success: true,
        message: `Connected as ${result.user?.displayName}`,
        user: result.user,
      });
    } else {
      res.json({
        success: false,
        message: result.error,
      });
    }
  } catch (error) {
    next(error);
  }
});

/**
 * Helper to determine project phase based on project key
 */
function getProjectPhase(projectKey: string): string {
  const phaseMap: Record<string, string> = {
    'MOHEECI': 'Implementation',
    'MOCSO': 'Stabilization',
    'MOCS': 'Support',
    'MOPT': 'Optimization',
    'MSPP': 'Pre-Planning',
  };
  return phaseMap[projectKey] || 'Implementation';
}
