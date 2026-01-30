import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authRouter } from './routes/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { ticketsRouter } from './routes/tickets.js';
import { importRouter } from './routes/import.js';
import { complianceRouter } from './routes/compliance.js';
import { adminRouter } from './routes/admin.js';
import { syncRouter } from './routes/sync.js';

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

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    useMockData: config.useMockData,
    version: '1.0.0'
  });
});

// API Routes
app.use('/api/auth', authRouter);
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
