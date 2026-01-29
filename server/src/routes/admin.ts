import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth.js';
import { config } from '../config.js';
import { AppError } from '../middleware/errorHandler.js';

export const adminRouter = Router();

adminRouter.use(authenticate);
adminRouter.use(requireAdmin);

// Get current configuration
adminRouter.get('/config', (req, res) => {
  res.json({
    useMockData: config.useMockData,
    jiraInstanceUrl: config.jiraInstanceUrl,
    jiraProjects: config.jiraProjects.split(','),
    jiraSyncIntervalMinutes: config.jiraSyncIntervalMinutes,
    defaultMonthlyHours: config.defaultMonthlyHours,
    hasGoogleChat: !!config.googleChatWebhookUrl,
    hasSlack: !!config.slackWebhookUrl,
    hasTeams: !!config.teamsWebhookUrl,
  });
});

// ==========================================
// APPLICATIONS
// ==========================================

// Get all applications
adminRouter.get('/applications', (req, res, next) => {
  try {
    const db = getDb();
    const applications = db.prepare('SELECT * FROM applications ORDER BY code').all();
    res.json({ applications });
  } catch (error) {
    next(error);
  }
});

const applicationSchema = z.object({
  code: z.string().min(1).max(10),
  name: z.string().min(1),
  budget_cap: z.number().nullable().optional(),
  is_active: z.boolean().optional(),
});

// Create application
adminRouter.post('/applications', (req, res, next) => {
  try {
    const data = applicationSchema.parse(req.body);
    const db = getDb();

    db.prepare(`
      INSERT INTO applications (code, name, budget_cap, is_active)
      VALUES (?, ?, ?, ?)
    `).run(data.code, data.name, data.budget_cap ?? null, data.is_active !== false ? 1 : 0);

    res.status(201).json({ message: 'Application created', code: data.code });
  } catch (error) {
    next(error);
  }
});

// Update application
adminRouter.put('/applications/:code', (req, res, next) => {
  try {
    const { code } = req.params;
    const data = applicationSchema.partial().parse(req.body);
    const db = getDb();

    const existing = db.prepare('SELECT * FROM applications WHERE code = ?').get(code);
    if (!existing) {
      throw new AppError(404, 'Application not found');
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.budget_cap !== undefined) {
      updates.push('budget_cap = ?');
      values.push(data.budget_cap);
    }
    if (data.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(data.is_active ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(code);
      db.prepare(`UPDATE applications SET ${updates.join(', ')} WHERE code = ?`).run(...values);
    }

    res.json({ message: 'Application updated' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// JIRA PROJECTS
// ==========================================

// Get all Jira projects
adminRouter.get('/projects', (req, res, next) => {
  try {
    const db = getDb();
    const projects = db.prepare('SELECT * FROM jira_projects ORDER BY key').all();
    res.json({ projects });
  } catch (error) {
    next(error);
  }
});

const projectSchema = z.object({
  key: z.string().min(1).max(20),
  name: z.string().min(1),
  phase: z.enum(['Implementation', 'Stabilization', 'Support', 'Optimization', 'Pre-Planning']),
  is_active: z.boolean().optional(),
});

// Create project
adminRouter.post('/projects', (req, res, next) => {
  try {
    const data = projectSchema.parse(req.body);
    const db = getDb();

    db.prepare(`
      INSERT INTO jira_projects (key, name, phase, is_active)
      VALUES (?, ?, ?, ?)
    `).run(data.key, data.name, data.phase, data.is_active !== false ? 1 : 0);

    res.status(201).json({ message: 'Project created', key: data.key });
  } catch (error) {
    next(error);
  }
});

// Update project
adminRouter.put('/projects/:key', (req, res, next) => {
  try {
    const { key } = req.params;
    const data = projectSchema.partial().parse(req.body);
    const db = getDb();

    const existing = db.prepare('SELECT * FROM jira_projects WHERE key = ?').get(key);
    if (!existing) {
      throw new AppError(404, 'Project not found');
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (data.name !== undefined) {
      updates.push('name = ?');
      values.push(data.name);
    }
    if (data.phase !== undefined) {
      updates.push('phase = ?');
      values.push(data.phase);
    }
    if (data.is_active !== undefined) {
      updates.push('is_active = ?');
      values.push(data.is_active ? 1 : 0);
    }

    if (updates.length > 0) {
      values.push(key);
      db.prepare(`UPDATE jira_projects SET ${updates.join(', ')} WHERE key = ?`).run(...values);
    }

    res.json({ message: 'Project updated' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// REPORTER MAPPINGS
// ==========================================

// Get all reporter mappings
adminRouter.get('/reporter-mappings', (req, res, next) => {
  try {
    const db = getDb();
    const mappings = db.prepare(`
      SELECT rm.*, a.name as application_name
      FROM reporter_mappings rm
      LEFT JOIN applications a ON rm.application = a.code
      ORDER BY rm.reporter_email
    `).all();
    res.json({ mappings });
  } catch (error) {
    next(error);
  }
});

const reporterMappingSchema = z.object({
  reporter_email: z.string().email(),
  reporter_name: z.string().optional(),
  application: z.string().nullable(),
  mapping_type: z.enum(['auto-map', 'skip']),
});

// Create reporter mapping
adminRouter.post('/reporter-mappings', (req, res, next) => {
  try {
    const data = reporterMappingSchema.parse(req.body);
    const db = getDb();

    db.prepare(`
      INSERT INTO reporter_mappings (reporter_email, reporter_name, application, mapping_type)
      VALUES (?, ?, ?, ?)
    `).run(data.reporter_email, data.reporter_name ?? null, data.application, data.mapping_type);

    res.status(201).json({ message: 'Reporter mapping created' });
  } catch (error) {
    next(error);
  }
});

// Update reporter mapping
adminRouter.put('/reporter-mappings/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const data = reporterMappingSchema.partial().parse(req.body);
    const db = getDb();

    const existing = db.prepare('SELECT * FROM reporter_mappings WHERE id = ?').get(id);
    if (!existing) {
      throw new AppError(404, 'Reporter mapping not found');
    }

    const updates: string[] = [];
    const values: any[] = [];

    if (data.reporter_email !== undefined) {
      updates.push('reporter_email = ?');
      values.push(data.reporter_email);
    }
    if (data.reporter_name !== undefined) {
      updates.push('reporter_name = ?');
      values.push(data.reporter_name);
    }
    if (data.application !== undefined) {
      updates.push('application = ?');
      values.push(data.application);
    }
    if (data.mapping_type !== undefined) {
      updates.push('mapping_type = ?');
      values.push(data.mapping_type);
    }

    if (updates.length > 0) {
      values.push(id);
      db.prepare(`UPDATE reporter_mappings SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    res.json({ message: 'Reporter mapping updated' });
  } catch (error) {
    next(error);
  }
});

// Delete reporter mapping
adminRouter.delete('/reporter-mappings/:id', (req, res, next) => {
  try {
    const { id } = req.params;
    const db = getDb();

    const result = db.prepare('DELETE FROM reporter_mappings WHERE id = ?').run(id);
    if (result.changes === 0) {
      throw new AppError(404, 'Reporter mapping not found');
    }

    res.json({ message: 'Reporter mapping deleted' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// BUDGET PERIODS
// ==========================================

// Get budget periods
adminRouter.get('/budget-periods', (req, res, next) => {
  try {
    const db = getDb();
    const periods = db.prepare(`
      SELECT * FROM budget_periods
      ORDER BY year DESC, month DESC
      LIMIT 24
    `).all();
    res.json({ periods });
  } catch (error) {
    next(error);
  }
});

const budgetPeriodSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  allocated_hours: z.number().positive(),
  notes: z.string().optional(),
});

// Create/update budget period
adminRouter.post('/budget-periods', (req, res, next) => {
  try {
    const data = budgetPeriodSchema.parse(req.body);
    const db = getDb();

    db.prepare(`
      INSERT INTO budget_periods (year, month, allocated_hours, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(year, month) DO UPDATE SET
        allocated_hours = excluded.allocated_hours,
        notes = excluded.notes
    `).run(data.year, data.month, data.allocated_hours, data.notes ?? null);

    res.json({ message: 'Budget period saved' });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// USERS
// ==========================================

// Get all users
adminRouter.get('/users', (req, res, next) => {
  try {
    const db = getDb();
    const users = db.prepare(`
      SELECT id, email, name, role, is_mock_data, created_at
      FROM users
      ORDER BY created_at DESC
    `).all();
    res.json({ users });
  } catch (error) {
    next(error);
  }
});

// Update user role
adminRouter.put('/users/:id/role', (req: AuthRequest, res, next) => {
  try {
    const { id } = req.params;
    const { role } = z.object({ role: z.enum(['admin', 'user']) }).parse(req.body);
    const db = getDb();

    // Don't allow demoting yourself
    if (parseInt(id) === req.user!.id && role !== 'admin') {
      throw new AppError(400, 'Cannot demote yourself');
    }

    const result = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    if (result.changes === 0) {
      throw new AppError(404, 'User not found');
    }

    res.json({ message: 'User role updated' });
  } catch (error) {
    next(error);
  }
});
