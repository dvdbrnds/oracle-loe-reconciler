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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
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
