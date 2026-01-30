import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Try multiple possible .env locations
const possibleEnvPaths = [
  path.resolve(__dirname, '../../.env'),      // From src: project root
  path.resolve(__dirname, '../../../.env'),   // From dist: project root  
  path.resolve(process.cwd(), '.env'),        // Current working directory
  path.resolve(process.cwd(), '../.env'),     // Parent of cwd (if running from server)
];

let envLoaded = false;
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    dotenvConfig({ path: envPath });
    envLoaded = true;
    break;
  }
}

if (!envLoaded) {
  console.warn('⚠️  No .env file found. Using defaults.');
}

const configSchema = z.object({
  // Server
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3001),
  host: z.string().default('0.0.0.0'), // 0.0.0.0 so Docker/Coolify can reach the app
  clientUrl: z.string().default('http://localhost:5173'),

  // Database
  databasePath: z.string().default('./db/vendor_hours.db'),

  // Auth
  jwtSecret: z.string().min(16),
  sessionDurationHours: z.coerce.number().default(24),

  // Jira
  useMockData: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean().default(true)
  ),
  jiraInstanceUrl: z.string().optional(),
  jiraApiEmail: z.string().optional(),
  jiraApiToken: z.string().optional(),
  jiraProjects: z.string().default('MOHEECI,MOCSO,MOCS,MOPT,MSPP'),
  jiraSyncIntervalMinutes: z.coerce.number().default(15),

  // Jira custom field IDs (configurable per instance)
  jiraFieldApplication: z.string().default('customfield_10064'),
  jiraFieldModule: z.string().default('customfield_10275'),
  jiraFieldLoeHours: z.string().default('customfield_10123'),

  // Budget
  defaultMonthlyHours: z.coerce.number().default(100),

  // Notifications
  googleChatWebhookUrl: z.string().optional(),
  slackWebhookUrl: z.string().optional(),
  teamsWebhookUrl: z.string().optional(),
});

function loadConfig() {
  const rawConfig = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    host: process.env.HOST,
    clientUrl: process.env.CLIENT_URL,
    databasePath: process.env.DATABASE_PATH,
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    sessionDurationHours: process.env.SESSION_DURATION_HOURS,
    useMockData: process.env.USE_MOCK_DATA,
    jiraInstanceUrl: process.env.JIRA_INSTANCE_URL,
    jiraApiEmail: process.env.JIRA_API_EMAIL,
    jiraApiToken: process.env.JIRA_API_TOKEN,
    jiraProjects: process.env.JIRA_PROJECTS,
    jiraSyncIntervalMinutes: process.env.JIRA_SYNC_INTERVAL_MINUTES,
    jiraFieldApplication: process.env.JIRA_FIELD_APPLICATION,
    jiraFieldModule: process.env.JIRA_FIELD_MODULE,
    jiraFieldLoeHours: process.env.JIRA_FIELD_LOE_HOURS,
    defaultMonthlyHours: process.env.DEFAULT_MONTHLY_HOURS,
    googleChatWebhookUrl: process.env.GOOGLE_CHAT_WEBHOOK_URL,
    slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
    teamsWebhookUrl: process.env.TEAMS_WEBHOOK_URL,
  };

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('❌ Configuration validation failed:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

export type Config = typeof config;
