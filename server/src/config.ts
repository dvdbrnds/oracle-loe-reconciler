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

  // SAML/Okta
  samlEnabled: z.preprocess(
    (val) => val === 'true' || val === true,
    z.boolean().default(true)
  ),
  samlEntryPoint: z.string().default('https://login.moravian.edu/app/moravian_dsloe_1/exk1i8bk3bpXbQbej0x8/sso/saml'),
  samlIssuer: z.string().default('http://www.okta.com/exk1i8bk3bpXbQbej0x8'),
  samlCallbackUrl: z.string().default('https://loe.moravian.edu/api/auth/saml/callback'),
  samlCert: z.string().default(`MIIDoDCCAoigAwIBAgIGAZwUG3w4MA0GCSqGSIb3DQEBCwUAMIGQMQswCQYDVQQGEwJVUzETMBEG
A1UECAwKQ2FsaWZvcm5pYTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNjbzENMAsGA1UECgwET2t0YTEU
MBIGA1UECwwLU1NPUHJvdmlkZXIxETAPBgNVBAMMCG1vcmF2aWFuMRwwGgYJKoZIhvcNAQkBFg1p
bmZvQG9rdGEuY29tMB4XDTI2MDEzMTEyNTAxMVoXDTM2MDEzMTEyNTExMVowgZAxCzAJBgNVBAYT
AlVTMRMwEQYDVQQIDApDYWxpZm9ybmlhMRYwFAYDVQQHDA1TYW4gRnJhbmNpc2NvMQ0wCwYDVQQK
DARPa3RhMRQwEgYDVQQLDAtTU09Qcm92aWRlcjERMA8GA1UEAwwIbW9yYXZpYW4xHDAaBgkqhkiG
9w0BCQEWDWluZm9Ab2t0YS5jb20wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCtR/XG
ZpjsipwfCGZ/HA7DXYTJeEOQMG82nSQfqvNA82vXbH/7kw3WRVbCURkAeXHtWd4ugp0LGwLZKujx
lp3O7uxwY8b4NMVNxaFN81PmlEReRrAh5J3mmYYaXfcxyQy445GcCbuOGLJA7Iser0AXRJ9/KVD/
eOmODc6BuhTbl5ufcM6uo6WEMe23OCNGxOfXI2SFn1RFfJEywJLqO0mGNdrxWhdxzNYdUq4mX0HW
gEbjhskNwWODfMoV24KEVJYZkkRzOTYOFJ4yiwoCM+3qJ1YbfxCQgdg6zkv6lLdjxwnvdmIj+trk
QeqKlnuZY0n0n1nVldO9JtgfvXpITpTHAgMBAAEwDQYJKoZIhvcNAQELBQADggEBADoDF5vuYhYu
/kTml35znVv6i7B3zdY2sHfGVrlL7YTzbwd4kr0P1aI0FaFo8fCdyik7pnInzO33bLZ8APhosOav
OGXtDA+Dny4+uru/Vgc2gZnEMnoc/6KUcB3qP7WyCV4n48g78qhLNxAj2V4NBvaBN/hb5LnJf0hs
ce1dksgox0jKCTJ6AAIlar/J+FKOK0pdWbEDgHAHYbxQNmU9nAcUWtPhyqZVu2jPxCpzxrqtxGxN
RmgKWbPkVzz/SYEUZJphvkUmgN+bMxDNSMeA3s6+L+udEA60ls022Aa3zLg+4sGLPumntAKbbYpK
IlyFtwTWH+CduxpkpJU9H6dcLxc=`),
  sessionSecret: z.string().default('session-secret-change-in-production'),
});

// Helper: treat empty strings as undefined so zod defaults apply
const env = (key: string) => {
  const val = process.env[key];
  return val && val.trim() ? val : undefined;
};

function loadConfig() {
  const rawConfig = {
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    host: process.env.HOST,
    clientUrl: env('CLIENT_URL'),
    databasePath: process.env.DATABASE_PATH,
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    sessionDurationHours: process.env.SESSION_DURATION_HOURS,
    useMockData: process.env.USE_MOCK_DATA,
    jiraInstanceUrl: env('JIRA_INSTANCE_URL'),
    jiraApiEmail: env('JIRA_API_EMAIL'),
    jiraApiToken: env('JIRA_API_TOKEN'),
    jiraProjects: env('JIRA_PROJECTS'),
    jiraSyncIntervalMinutes: process.env.JIRA_SYNC_INTERVAL_MINUTES,
    jiraFieldApplication: env('JIRA_FIELD_APPLICATION'),
    jiraFieldModule: env('JIRA_FIELD_MODULE'),
    jiraFieldLoeHours: env('JIRA_FIELD_LOE_HOURS'),
    defaultMonthlyHours: process.env.DEFAULT_MONTHLY_HOURS,
    googleChatWebhookUrl: env('GOOGLE_CHAT_WEBHOOK_URL'),
    slackWebhookUrl: env('SLACK_WEBHOOK_URL'),
    teamsWebhookUrl: env('TEAMS_WEBHOOK_URL'),
    samlEnabled: process.env.SAML_ENABLED,
    samlEntryPoint: env('SAML_ENTRY_POINT'),
    samlIssuer: env('SAML_ISSUER'),
    samlCallbackUrl: env('SAML_CALLBACK_URL'),
    samlCert: env('SAML_CERT'),
    sessionSecret: env('SESSION_SECRET'),
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
