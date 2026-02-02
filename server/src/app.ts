import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';
import passport from 'passport';
import { config } from './config.js';
import { getDb } from './db/database.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { ticketsRouter } from './routes/tickets.js';
import { importRouter } from './routes/import.js';
import { complianceRouter } from './routes/compliance.js';
import { adminRouter } from './routes/admin.js';
import { syncRouter } from './routes/sync.js';
import { samlRouter } from './routes/saml.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const app = express();

// Middleware
app.use(cors({
  origin: config.nodeEnv === 'production' ? true : config.clientUrl,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware (required for SAML)
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: config.nodeEnv === 'production',
    httpOnly: true,
    maxAge: config.sessionDurationHours * 60 * 60 * 1000,
  },
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Capture startup time to verify deployments
const SERVER_START_TIME = new Date().toISOString();

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    serverStartedAt: SERVER_START_TIME,
    useMockData: config.useMockData,
    version: '1.0.0'
  });
});

// Debug endpoint to check Jira config (temporary - remove after debugging)
app.get('/api/debug/config', (req, res) => {
  res.json({
    nodeEnv: config.nodeEnv,
    useMockData: config.useMockData,
    jiraConfigured: !!(config.jiraInstanceUrl && config.jiraApiEmail && config.jiraApiToken && !config.useMockData),
    jiraInstanceUrl: config.jiraInstanceUrl || '(not set)',
    jiraApiEmail: config.jiraApiEmail ? `${config.jiraApiEmail.substring(0, 3)}...` : '(not set)',
    jiraApiToken: config.jiraApiToken ? '(set - hidden)' : '(not set)',
    jiraProjects: config.jiraProjects,
    samlEnabled: config.samlEnabled,
    // Show raw env vars for debugging
    envVars: {
      USE_MOCK_DATA: process.env.USE_MOCK_DATA || '(not set)',
      JIRA_INSTANCE_URL: process.env.JIRA_INSTANCE_URL || '(not set)',
      JIRA_API_EMAIL: process.env.JIRA_API_EMAIL ? `${process.env.JIRA_API_EMAIL.substring(0, 3)}...` : '(not set)',
      JIRA_API_TOKEN: process.env.JIRA_API_TOKEN ? '(set)' : '(not set)',
    }
  });
});

// Debug endpoint to check data persistence (burnt_hours and import history)
app.get('/api/debug/persistence', (req, res) => {
  try {
    const db = getDb();
    
    const importBatches = db.prepare(`
      SELECT id, filename, row_count, total_hours, imported_at
      FROM import_batches
      WHERE is_mock_data = 0
      ORDER BY imported_at DESC
      LIMIT 10
    `).all();
    
    const burntHoursSummary = db.prepare(`
      SELECT 
        COUNT(*) as total_records,
        SUM(hours) as total_hours,
        COUNT(DISTINCT import_batch_id) as batch_count,
        MIN(created_at) as earliest_record,
        MAX(created_at) as latest_record
      FROM burnt_hours
      WHERE is_mock_data = 0
    `).get();
    
    const dbPath = config.databasePath;
    
    res.json({
      databasePath: dbPath,
      importBatches,
      burntHoursSummary,
      message: 'If data disappears after reboot, check Coolify volume persistence settings'
    });
  } catch (error) {
    res.json({ error: String(error) });
  }
});

// Debug endpoint to check jira_updated_at values
app.get('/api/debug/updated-check', (req, res) => {
  try {
    const db = getDb();
    const sample = db.prepare(`
      SELECT key, jira_updated_at, jira_created_at, synced_at, assignee_name
      FROM jira_tickets
      WHERE is_mock_data = 0
      ORDER BY synced_at DESC
      LIMIT 10
    `).all();
    res.json({ sample });
  } catch (error) {
    res.json({ error: String(error) });
  }
});

// Debug endpoint to show full hours breakdown
app.get('/api/debug/hours-breakdown', (req, res) => {
  try {
    const db = getDb();
    
    // Total from burnt_hours table
    const totals = db.prepare(`
      SELECT 
        SUM(hours) as total_all,
        SUM(CASE WHEN is_admin_overhead = 1 THEN hours ELSE 0 END) as admin_hours,
        SUM(CASE WHEN is_admin_overhead = 0 THEN hours ELSE 0 END) as non_admin_hours,
        SUM(CASE WHEN ticket_key LIKE 'MOCS-%' THEN hours ELSE 0 END) as mocs_hours,
        COUNT(*) as record_count
      FROM burnt_hours
      WHERE is_mock_data = 0
    `).get();
    
    // By project
    const byProject = db.prepare(`
      SELECT 
        COALESCE(jira_project, ticket_key, 'Unknown') as project,
        SUM(hours) as hours,
        COUNT(*) as records
      FROM burnt_hours
      WHERE is_mock_data = 0
      GROUP BY COALESCE(jira_project, ticket_key, 'Unknown')
      ORDER BY hours DESC
    `).all();
    
    res.json({ totals, byProject });
  } catch (error) {
    res.json({ error: String(error) });
  }
});

// Debug endpoint to run the exact dashboard work-type calculation
app.get('/api/debug/dashboard-calc', (req, res) => {
  try {
    const db = getDb();
    const year = 2026;
    const month = 1;
    
    const result = db.prepare(`
      SELECT 
        COALESCE(SUM(bh.hours), 0) as total_burnt,
        COALESCE(SUM(CASE WHEN bh.is_admin_overhead = 1 THEN bh.hours ELSE 0 END), 0) as admin_overhead,
        COALESCE(SUM(CASE 
          WHEN bh.is_admin_overhead = 0
            AND jt.priority IN ('Critical', 'High', 'Highest', 'Urgent')
            AND COALESCE(jt.module, '') NOT LIKE '%Payroll%' 
            AND COALESCE(jt.summary, '') NOT LIKE '%Payroll%' 
            AND COALESCE(jt.summary, '') NOT LIKE '%payroll%'
          THEN bh.hours ELSE 0 END), 0) as hours_urgent_priority,
        COALESCE(SUM(CASE 
          WHEN bh.is_admin_overhead = 0
            AND (COALESCE(jt.module, '') LIKE '%Payroll%' OR COALESCE(jt.summary, '') LIKE '%Payroll%' OR COALESCE(jt.summary, '') LIKE '%payroll%')
          THEN bh.hours ELSE 0 END), 0) as hours_payroll,
        COALESCE(SUM(CASE 
          WHEN bh.is_admin_overhead = 0
            AND (jt.priority IS NULL OR jt.priority NOT IN ('Critical', 'High', 'Highest', 'Urgent'))
            AND COALESCE(jt.module, '') NOT LIKE '%Payroll%' 
            AND COALESCE(jt.summary, '') NOT LIKE '%Payroll%' 
            AND COALESCE(jt.summary, '') NOT LIKE '%payroll%'
          THEN bh.hours ELSE 0 END), 0) as hours_regular
      FROM burnt_hours bh
      LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
      WHERE bh.is_mock_data = 0
        AND (bh.ticket_key LIKE 'MOCS-%' OR bh.is_admin_overhead = 1)
        AND (
          (jt.loe_approved_at IS NOT NULL AND strftime('%Y', jt.loe_approved_at) = ? AND strftime('%m', jt.loe_approved_at) = ?)
          OR (jt.loe_approved_at IS NULL AND strftime('%Y', bh.work_date) = ? AND strftime('%m', bh.work_date) = ?)
          OR (bh.ticket_key IS NULL AND strftime('%Y', bh.work_date) = ? AND strftime('%m', bh.work_date) = ?)
        )
    `).get(
      year.toString(), month.toString().padStart(2, '0'),
      year.toString(), month.toString().padStart(2, '0'),
      year.toString(), month.toString().padStart(2, '0')
    );
    
    res.json({ year, month, result });
  } catch (error) {
    res.json({ error: String(error) });
  }
});

// Debug endpoint to check date distribution and priority values
app.get('/api/debug/dates', (req, res) => {
  try {
    const db = getDb();
    
    // Check work_date distribution
    const dateDistribution = db.prepare(`
      SELECT strftime('%Y-%m', work_date) as month, COUNT(*) as count, SUM(hours) as hours
      FROM burnt_hours
      WHERE is_mock_data = 0
      GROUP BY strftime('%Y-%m', work_date)
      ORDER BY month DESC
      LIMIT 12
    `).all();
    
    // Check priority values in jira_tickets
    const priorityValues = db.prepare(`
      SELECT priority, COUNT(*) as count
      FROM jira_tickets
      WHERE is_mock_data = 0
      GROUP BY priority
    `).all();
    
    // Check the actual join result for Jan 2026
    const joinedData = db.prepare(`
      SELECT bh.ticket_key, bh.hours, bh.work_date, jt.priority, jt.summary
      FROM burnt_hours bh
      LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
      WHERE bh.is_mock_data = 0 
        AND bh.is_admin_overhead = 0
        AND bh.ticket_key LIKE 'MOCS-%'
      LIMIT 15
    `).all();
    
    res.json({ dateDistribution, priorityValues, joinedData });
  } catch (error) {
    res.json({ error: String(error) });
  }
});

// Debug endpoint to check work type breakdown data
app.get('/api/debug/work-types', (req, res) => {
  try {
    const db = getDb();
    
    // Check priority distribution
    const priorities = db.prepare(`
      SELECT jt.priority, COUNT(*) as count, SUM(bh.hours) as hours
      FROM burnt_hours bh
      LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
      WHERE bh.is_mock_data = 0 AND bh.is_admin_overhead = 0 AND bh.ticket_key LIKE 'MOCS-%'
      GROUP BY jt.priority
    `).all();
    
    // Check for payroll tickets
    const payroll = db.prepare(`
      SELECT COUNT(*) as count, SUM(bh.hours) as hours
      FROM burnt_hours bh
      LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
      WHERE bh.is_mock_data = 0 
        AND (jt.summary LIKE '%Payroll%' OR jt.summary LIKE '%payroll%' OR jt.module LIKE '%Payroll%')
    `).get();
    
    // Check total burnt hours
    const totals = db.prepare(`
      SELECT 
        COUNT(*) as total_records,
        SUM(hours) as total_hours,
        SUM(CASE WHEN is_admin_overhead = 1 THEN hours ELSE 0 END) as admin_hours,
        COUNT(DISTINCT ticket_key) as unique_tickets
      FROM burnt_hours WHERE is_mock_data = 0
    `).get();
    
    // Check if burnt_hours match jira_tickets
    const matching = db.prepare(`
      SELECT 
        COUNT(*) as with_match,
        SUM(bh.hours) as hours_with_match
      FROM burnt_hours bh
      INNER JOIN jira_tickets jt ON bh.ticket_key = jt.key
      WHERE bh.is_mock_data = 0 AND bh.is_admin_overhead = 0
    `).get();
    
    // Get ticket counts by project
    const projectStats = db.prepare(`
      SELECT project_key, COUNT(*) as count
      FROM jira_tickets
      WHERE is_mock_data = 0
      GROUP BY project_key
    `).all();
    
    // Sample burnt_hours ticket keys that don't match
    const unmatchedKeys = db.prepare(`
      SELECT DISTINCT bh.ticket_key
      FROM burnt_hours bh
      LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
      WHERE bh.is_mock_data = 0 AND bh.is_admin_overhead = 0 AND jt.key IS NULL
      LIMIT 10
    `).all();
    
    // Compare ticket keys between burnt_hours and jira_tickets for MOCS
    const burntMocsKeys = db.prepare(`
      SELECT DISTINCT ticket_key FROM burnt_hours 
      WHERE ticket_key LIKE 'MOCS-%' AND is_mock_data = 0
      ORDER BY ticket_key
    `).all();
    
    const jiraMocsKeys = db.prepare(`
      SELECT DISTINCT key FROM jira_tickets 
      WHERE key LIKE 'MOCS-%' AND is_mock_data = 0
      ORDER BY key
    `).all();
    
    res.json({ 
      priorities, payroll, totals, matching, projectStats, unmatchedKeys,
      mocsComparison: {
        inBurntHours: burntMocsKeys,
        inJira: jiraMocsKeys
      }
    });
  } catch (error) {
    res.json({ error: String(error) });
  }
});

// Debug endpoint to manually sync MOCS and show results
app.get('/api/debug/sync-mocs', async (req, res) => {
  try {
    const { jiraService } = await import('./services/jira.js');
    const db = getDb();
    
    if (!jiraService.isConfigured()) {
      res.json({ error: 'Jira not configured' });
      return;
    }
    
    // Fetch from Jira
    console.log('🧪 Fetching MOCS issues...');
    const issues = await jiraService.fetchProjectIssues('MOCS');
    console.log(`🧪 Got ${issues.length} issues from Jira`);
    
    // Count before
    const beforeCount = db.prepare(`SELECT COUNT(*) as count FROM jira_tickets WHERE project_key = 'MOCS' AND is_mock_data = 0`).get() as { count: number };
    
    // Insert each one
    let inserted = 0;
    let errors: string[] = [];
    
    for (const issue of issues) {
      try {
        const transformed = jiraService.transformIssue(issue);
        db.prepare(`
          INSERT INTO jira_tickets (key, project_key, summary, priority, status, is_mock_data, synced_at)
          VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET
            summary = excluded.summary,
            priority = excluded.priority,
            status = excluded.status,
            synced_at = datetime('now')
        `).run(
          transformed.key,
          transformed.project_key,
          transformed.summary,
          transformed.priority,
          transformed.status
        );
        inserted++;
      } catch (e) {
        errors.push(`${issue.key}: ${e}`);
      }
    }
    
    // Count after
    const afterCount = db.prepare(`SELECT COUNT(*) as count FROM jira_tickets WHERE project_key = 'MOCS' AND is_mock_data = 0`).get() as { count: number };
    
    // Get sample of what's in DB
    const sample = db.prepare(`SELECT key, summary, priority FROM jira_tickets WHERE project_key = 'MOCS' AND is_mock_data = 0 ORDER BY key LIMIT 10`).all();
    
    res.json({
      fetchedFromJira: issues.length,
      beforeCount: beforeCount.count,
      insertedCount: inserted,
      afterCount: afterCount.count,
      errors: errors.slice(0, 5),
      sampleInDb: sample
    });
  } catch (error) {
    res.json({ error: String(error), stack: (error as Error).stack });
  }
});

// Debug endpoint to test jiraService.fetchProjectIssues (what sync actually uses)
app.get('/api/debug/jira-service-test', async (req, res) => {
  try {
    const { jiraService } = await import('./services/jira.js');
    
    if (!jiraService.isConfigured()) {
      res.json({ error: 'Jira not configured' });
      return;
    }
    
    console.log('🧪 Testing jiraService.fetchProjectIssues for MOCS...');
    const issues = await jiraService.fetchProjectIssues('MOCS');
    console.log(`🧪 jiraService returned ${issues.length} issues`);
    
    res.json({
      source: 'jiraService.fetchProjectIssues',
      totalFetched: issues.length,
      tickets: issues.slice(0, 10).map(i => ({
        key: i.key,
        summary: i.fields?.summary?.substring(0, 40),
        priority: i.fields?.priority?.name
      })),
      message: issues.length > 10 ? `...and ${issues.length - 10} more` : undefined
    });
  } catch (error) {
    res.json({ error: String(error), stack: (error as Error).stack });
  }
});

// Debug endpoint to fetch ALL MOCS tickets and show pagination
app.get('/api/debug/jira-mocs', async (req, res) => {
  try {
    const baseUrl = (config.jiraInstanceUrl || '').replace(/\/$/, '');
    const authHeader = 'Basic ' + Buffer.from(`${config.jiraApiEmail}:${config.jiraApiToken}`).toString('base64');
    
    const allIssues: any[] = [];
    let nextPageToken: string | undefined;
    let pageCount = 0;
    const maxResults = 50;
    
    do {
      pageCount++;
      const url = new URL(`${baseUrl}/rest/api/3/search/jql`);
      url.searchParams.set('jql', 'project = MOCS ORDER BY created ASC');
      url.searchParams.set('maxResults', maxResults.toString());
      url.searchParams.set('fields', 'key,summary,priority');
      if (nextPageToken) {
        url.searchParams.set('nextPageToken', nextPageToken);
      }
      
      const response = await fetch(url.toString(), {
        headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        res.json({ error: `Page ${pageCount} failed: ${response.status} - ${errorText}` });
        return;
      }
      
      const data = await response.json() as any;
      allIssues.push(...(data.issues || []));
      nextPageToken = data.nextPageToken;
      
      // Safety limit
      if (pageCount >= 20) break;
    } while (nextPageToken);
    
    res.json({
      totalFetched: allIssues.length,
      pagesUsed: pageCount,
      tickets: allIssues.map((i: any) => ({
        key: i.key,
        summary: i.fields?.summary?.substring(0, 50),
        priority: i.fields?.priority?.name
      }))
    });
  } catch (error) {
    res.json({ error: String(error) });
  }
});

// Debug endpoint to test Jira API directly
app.get('/api/debug/jira-test', async (req, res) => {
  try {
    const baseUrl = (config.jiraInstanceUrl || '').replace(/\/$/, '');
    const authHeader = 'Basic ' + Buffer.from(`${config.jiraApiEmail}:${config.jiraApiToken}`).toString('base64');
    
    // Test 1: Check /myself endpoint
    const myselfUrl = `${baseUrl}/rest/api/3/myself`;
    const myselfResponse = await fetch(myselfUrl, {
      headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
    });
    const myselfData = myselfResponse.ok ? await myselfResponse.json() : await myselfResponse.text();
    
    // Test 2: Search for MOCS issues (using new /search/jql endpoint)
    const searchUrl = `${baseUrl}/rest/api/3/search/jql?jql=project=MOCS&maxResults=5&fields=key,summary,priority`;
    const searchResponse = await fetch(searchUrl, {
      headers: { 'Authorization': authHeader, 'Accept': 'application/json' }
    });
    const searchData = searchResponse.ok ? await searchResponse.json() : await searchResponse.text();
    
    res.json({
      config: {
        baseUrl,
        email: config.jiraApiEmail ? `${config.jiraApiEmail.substring(0, 10)}...` : '(not set)',
        tokenSet: !!config.jiraApiToken
      },
      myself: {
        status: myselfResponse.status,
        ok: myselfResponse.ok,
        data: myselfData
      },
      search: {
        url: searchUrl,
        status: searchResponse.status,
        ok: searchResponse.ok,
        total: searchResponse.ok ? (searchData as any).total : null,
        data: searchData
      }
    });
  } catch (error) {
    res.json({ error: String(error), stack: (error as Error).stack });
  }
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/auth/saml', samlRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/import', importRouter);
app.use('/api/compliance', complianceRouter);
app.use('/api/admin', adminRouter);
app.use('/api/sync', syncRouter);

// Serve static files in production
if (config.nodeEnv === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Error handling
app.use(errorHandler);
