import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/database.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';

export const ticketsRouter = Router();

ticketsRouter.use(authenticate);

const querySchema = z.object({
  application: z.string().optional(),
  phase: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  project: z.string().optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  sortBy: z.enum(['key', 'summary', 'application', 'priority', 'status', 'loe_hours', 'hours_burnt']).default('key'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// List all tickets with filtering
ticketsRouter.get('/', (req, res, next) => {
  try {
    const params = querySchema.parse(req.query);
    const db = getDb();

    // Build dynamic WHERE clause
    const conditions: string[] = [];
    const values: any[] = [];

    if (params.application) {
      conditions.push('jt.application = ?');
      values.push(params.application);
    }

    if (params.phase) {
      conditions.push('jp.phase = ?');
      values.push(params.phase);
    }

    if (params.status) {
      conditions.push('jt.status = ?');
      values.push(params.status);
    }

    if (params.priority) {
      conditions.push('jt.priority = ?');
      values.push(params.priority);
    }

    if (params.project) {
      conditions.push('jt.project_key = ?');
      values.push(params.project);
    }

    if (params.search) {
      conditions.push('(jt.key LIKE ? OR jt.summary LIKE ?)');
      const searchTerm = `%${params.search}%`;
      values.push(searchTerm, searchTerm);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM jira_tickets jt
      LEFT JOIN jira_projects jp ON jt.project_key = jp.key
      ${whereClause}
    `;
    const { total } = db.prepare(countQuery).get(...values) as { total: number };

    // Determine sort column
    let sortColumn: string;
    switch (params.sortBy) {
      case 'hours_burnt':
        sortColumn = 'hours_burnt';
        break;
      default:
        sortColumn = `jt.${params.sortBy}`;
    }

    // Get paginated results with burnt hours and aging metrics
    const offset = (params.page - 1) * params.limit;
    const query = `
      SELECT 
        jt.*,
        jp.phase,
        jp.name as project_name,
        a.name as application_name,
        COALESCE(bh.hours_burnt, 0) as hours_burnt,
        COALESCE(bh.hours_burnt, 0) > 0 AND jt.status != 'LOE Approved' as has_compliance_issue,
        -- Aging metrics
        CASE 
          WHEN jt.loe_approved_at IS NOT NULL 
          THEN CAST(julianday('now') - julianday(jt.loe_approved_at) AS INTEGER)
          ELSE NULL
        END as days_since_approved,
        CASE 
          WHEN jt.loe_approved_at IS NOT NULL AND COALESCE(bh.hours_burnt, 0) = 0
          THEN CAST(julianday('now') - julianday(jt.loe_approved_at) AS INTEGER)
          ELSE NULL
        END as days_waiting_for_work,
        CASE
          WHEN bh.last_work_date IS NOT NULL
          THEN CAST(julianday('now') - julianday(bh.last_work_date) AS INTEGER)
          ELSE NULL
        END as days_since_last_work,
        bh.first_work_date,
        bh.last_work_date
      FROM jira_tickets jt
      LEFT JOIN jira_projects jp ON jt.project_key = jp.key
      LEFT JOIN applications a ON jt.application = a.code
      LEFT JOIN (
        SELECT 
          ticket_key, 
          SUM(hours) as hours_burnt,
          MIN(work_date) as first_work_date,
          MAX(work_date) as last_work_date
        FROM burnt_hours
        GROUP BY ticket_key
      ) bh ON jt.key = bh.ticket_key
      ${whereClause}
      ORDER BY ${sortColumn} ${params.sortOrder.toUpperCase()}
      LIMIT ? OFFSET ?
    `;

    const tickets = db.prepare(query).all(...values, params.limit, offset);

    res.json({
      tickets,
      pagination: {
        page: params.page,
        limit: params.limit,
        total,
        totalPages: Math.ceil(total / params.limit),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get single ticket with full details
ticketsRouter.get('/:key', (req, res, next) => {
  try {
    const { key } = req.params;
    const db = getDb();

    const ticket = db.prepare(`
      SELECT 
        jt.*,
        jp.phase,
        jp.name as project_name,
        a.name as application_name
      FROM jira_tickets jt
      LEFT JOIN jira_projects jp ON jt.project_key = jp.key
      LEFT JOIN applications a ON jt.application = a.code
      WHERE jt.key = ?
    `).get(key);

    if (!ticket) {
      throw new AppError(404, 'Ticket not found');
    }

    // Get all burnt hours for this ticket
    const burntHours = db.prepare(`
      SELECT bh.*, ib.filename as import_filename, ib.imported_at
      FROM burnt_hours bh
      LEFT JOIN import_batches ib ON bh.import_batch_id = ib.id
      WHERE bh.ticket_key = ?
      ORDER BY bh.work_date DESC
    `).all(key);

    const totalBurnt = burntHours.reduce((sum: number, bh: any) => sum + bh.hours, 0);

    res.json({
      ticket,
      burntHours,
      totalBurnt,
      loeVariance: (ticket as any).loe_hours ? totalBurnt - (ticket as any).loe_hours : null,
    });
  } catch (error) {
    next(error);
  }
});

// Get filter options (for dropdowns)
ticketsRouter.get('/meta/filters', (req, res, next) => {
  try {
    const db = getDb();

    const applications = db.prepare('SELECT code, name FROM applications WHERE is_active = 1').all();
    const projects = db.prepare('SELECT key, name, phase FROM jira_projects WHERE is_active = 1').all();
    const statuses = db.prepare('SELECT DISTINCT status FROM jira_tickets WHERE status IS NOT NULL').all();
    const priorities = db.prepare('SELECT DISTINCT priority FROM jira_tickets WHERE priority IS NOT NULL').all();
    const phases = ['Implementation', 'Stabilization', 'Support', 'Optimization', 'Pre-Planning'];

    res.json({
      applications,
      projects,
      statuses: statuses.map((s: any) => s.status),
      priorities: priorities.map((p: any) => p.priority),
      phases,
    });
  } catch (error) {
    next(error);
  }
});
