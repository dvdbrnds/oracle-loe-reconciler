import { Router } from 'express';
import { getDb } from '../db/database.js';
import { authenticate } from '../middleware/auth.js';

export const complianceRouter = Router();

complianceRouter.use(authenticate);

// Get tickets with hours burned but no LOE approval
// Separates urgent work (P1/P2/Payroll) from regular unapproved work
complianceRouter.get('/unapproved-loe', (req, res, next) => {
  try {
    const db = getDb();

    const tickets = db.prepare(`
      SELECT 
        jt.*,
        jp.phase,
        jp.name as project_name,
        a.name as application_name,
        bh.total_hours as hours_burnt,
        CASE 
          WHEN jt.priority IN ('Critical', 'High', 'Highest') 
            OR jt.summary LIKE '%Payroll%' 
            OR jt.summary LIKE '%payroll%'
          THEN 1 ELSE 0 
        END as is_urgent
      FROM jira_tickets jt
      INNER JOIN (
        SELECT ticket_key, SUM(hours) as total_hours
        FROM burnt_hours
        WHERE ticket_key IS NOT NULL
        GROUP BY ticket_key
        HAVING SUM(hours) > 0
      ) bh ON jt.key = bh.ticket_key
      LEFT JOIN jira_projects jp ON jt.project_key = jp.key
      LEFT JOIN applications a ON jt.application = a.code
      WHERE jt.status != 'LOE Approved'
      ORDER BY is_urgent ASC, bh.total_hours DESC
    `).all() as Array<any>;

    // Separate urgent from non-urgent
    const urgentTickets = tickets.filter(t => t.is_urgent === 1);
    const nonUrgentTickets = tickets.filter(t => t.is_urgent === 0);

    const totalUrgentHours = urgentTickets.reduce((sum, t) => sum + t.hours_burnt, 0);
    const totalNonUrgentHours = nonUrgentTickets.reduce((sum, t) => sum + t.hours_burnt, 0);

    res.json({
      tickets: nonUrgentTickets, // Only show non-urgent as compliance issues
      urgentTickets, // Urgent work is expected, shown separately
      summary: {
        ticketCount: nonUrgentTickets.length,
        totalHours: Math.round(totalNonUrgentHours * 100) / 100,
        urgentTicketCount: urgentTickets.length,
        urgentHours: Math.round(totalUrgentHours * 100) / 100,
        description: 'Non-urgent tickets with work but no LOE approval (excludes P1/P2/Payroll)',
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get tickets that are LOE Approved but have no LOE estimate (approved without LOE)
complianceRouter.get('/approved-no-loe', (req, res, next) => {
  try {
    const db = getDb();

    const tickets = db.prepare(`
      SELECT 
        jt.key,
        jt.summary,
        jt.application,
        jt.status,
        jt.loe_hours,
        jt.loe_approved_at,
        jp.phase,
        jp.name as project_name,
        a.name as application_name,
        COALESCE(bh.total_hours, 0) as hours_burnt
      FROM jira_tickets jt
      LEFT JOIN (
        SELECT ticket_key, SUM(hours) as total_hours
        FROM burnt_hours
        WHERE ticket_key IS NOT NULL
          AND is_mock_data = 0
        GROUP BY ticket_key
      ) bh ON jt.key = bh.ticket_key
      LEFT JOIN jira_projects jp ON jt.project_key = jp.key
      LEFT JOIN applications a ON jt.application = a.code
      WHERE jt.status = 'LOE Approved'
        AND (jt.loe_hours IS NULL OR jt.loe_hours = 0)
        AND jt.is_mock_data = 0
      ORDER BY bh.total_hours DESC NULLS LAST
    `).all() as Array<{
      key: string;
      summary: string;
      application: string | null;
      status: string;
      loe_hours: number | null;
      loe_approved_at: string | null;
      phase: string | null;
      project_name: string | null;
      application_name: string | null;
      hours_burnt: number;
    }>;

    const totalHours = tickets.reduce((sum, t) => sum + (t.hours_burnt || 0), 0);
    const ticketsWithHours = tickets.filter(t => t.hours_burnt > 0);

    res.json({
      tickets,
      summary: {
        ticketCount: tickets.length,
        ticketsWithHours: ticketsWithHours.length,
        totalHours: Math.round(totalHours * 100) / 100,
        description: 'Tickets approved for work without an LOE estimate',
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get LOE accuracy metrics
complianceRouter.get('/loe-accuracy', (req, res, next) => {
  try {
    const db = getDb();

    // Get tickets with both LOE and burnt hours
    const tickets = db.prepare(`
      SELECT 
        jt.key,
        jt.summary,
        jt.application,
        jt.loe_hours as estimated,
        bh.total_hours as actual,
        (bh.total_hours - jt.loe_hours) as variance,
        CASE 
          WHEN jt.loe_hours > 0 THEN ((bh.total_hours - jt.loe_hours) / jt.loe_hours * 100)
          ELSE NULL
        END as variance_percent
      FROM jira_tickets jt
      INNER JOIN (
        SELECT ticket_key, SUM(hours) as total_hours
        FROM burnt_hours
        WHERE ticket_key IS NOT NULL
        GROUP BY ticket_key
      ) bh ON jt.key = bh.ticket_key
      WHERE jt.loe_hours IS NOT NULL AND jt.loe_hours > 0
      ORDER BY ABS(bh.total_hours - jt.loe_hours) DESC
    `).all() as Array<{
      key: string;
      summary: string;
      application: string;
      estimated: number;
      actual: number;
      variance: number;
      variance_percent: number | null;
    }>;

    // Calculate summary stats
    const overEstimates = tickets.filter(t => t.variance < 0);
    const underEstimates = tickets.filter(t => t.variance > 0);
    const accurate = tickets.filter(t => Math.abs(t.variance_percent ?? 0) <= 10); // Within 10%

    const totalEstimated = tickets.reduce((sum, t) => sum + t.estimated, 0);
    const totalActual = tickets.reduce((sum, t) => sum + t.actual, 0);
    const avgVariancePercent = tickets.length > 0
      ? tickets.reduce((sum, t) => sum + Math.abs(t.variance_percent ?? 0), 0) / tickets.length
      : 0;

    // By application breakdown
    const byApplication: Record<string, { estimated: number; actual: number; count: number }> = {};
    for (const t of tickets) {
      const app = t.application || 'Unclassified';
      if (!byApplication[app]) {
        byApplication[app] = { estimated: 0, actual: 0, count: 0 };
      }
      byApplication[app].estimated += t.estimated;
      byApplication[app].actual += t.actual;
      byApplication[app].count++;
    }

    res.json({
      tickets: tickets.slice(0, 20), // Top 20 by variance
      summary: {
        totalTickets: tickets.length,
        totalEstimated: Math.round(totalEstimated * 10) / 10,
        totalActual: Math.round(totalActual * 10) / 10,
        totalVariance: Math.round((totalActual - totalEstimated) * 10) / 10,
        avgVariancePercent: Math.round(avgVariancePercent * 10) / 10,
        overEstimateCount: overEstimates.length,
        underEstimateCount: underEstimates.length,
        accurateCount: accurate.length,
        accuracyRate: tickets.length > 0 ? Math.round((accurate.length / tickets.length) * 100) : 0,
      },
      byApplication: Object.entries(byApplication).map(([app, data]) => ({
        application: app,
        ...data,
        variance: data.actual - data.estimated,
        variancePercent: data.estimated > 0 ? ((data.actual - data.estimated) / data.estimated) * 100 : 0,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Get budget overage history
complianceRouter.get('/overages', (req, res, next) => {
  try {
    const db = getDb();

    // Get monthly budget vs actual
    const monthly = db.prepare(`
      SELECT 
        strftime('%Y', bh.work_date) as year,
        strftime('%m', bh.work_date) as month,
        COALESCE(bp.allocated_hours, 100) as allocated,
        SUM(bh.hours) as burnt
      FROM burnt_hours bh
      LEFT JOIN budget_periods bp ON 
        CAST(strftime('%Y', bh.work_date) AS INTEGER) = bp.year AND
        CAST(strftime('%m', bh.work_date) AS INTEGER) = bp.month
      GROUP BY strftime('%Y-%m', bh.work_date)
      ORDER BY year DESC, month DESC
      LIMIT 12
    `).all() as Array<{
      year: string;
      month: string;
      allocated: number;
      burnt: number;
    }>;

    const periods = monthly.map(m => ({
      year: parseInt(m.year),
      month: parseInt(m.month),
      allocated: m.allocated,
      burnt: Math.round(m.burnt * 100) / 100,
      overage: Math.max(0, m.burnt - m.allocated),
      isOver: m.burnt > m.allocated,
    }));

    const totalOverage = periods.reduce((sum, p) => sum + p.overage, 0);
    const monthsOver = periods.filter(p => p.isOver).length;

    res.json({
      periods,
      summary: {
        totalOverage: Math.round(totalOverage * 100) / 100,
        monthsOver,
        monthsTracked: periods.length,
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get tickets with date mismatches (burnt hours billed to different month than approval)
complianceRouter.get('/date-mismatches', (req, res, next) => {
  try {
    const db = getDb();

    // Find burnt hours where the work_date month doesn't match the ticket's loe_approved_at month
    const mismatches = db.prepare(`
      SELECT 
        jt.key,
        jt.summary,
        jt.application,
        jt.status,
        jt.loe_approved_at,
        a.name as application_name,
        jp.phase,
        strftime('%Y-%m', jt.loe_approved_at) as approved_month,
        bh_summary.work_months,
        bh_summary.total_hours,
        bh_summary.hours_by_month
      FROM jira_tickets jt
      INNER JOIN (
        SELECT 
          ticket_key,
          GROUP_CONCAT(DISTINCT strftime('%Y-%m', work_date)) as work_months,
          SUM(hours) as total_hours,
          GROUP_CONCAT(strftime('%Y-%m', work_date) || ':' || CAST(hours AS TEXT), '|') as hours_by_month
        FROM burnt_hours
        WHERE ticket_key IS NOT NULL
          AND is_mock_data = 0
        GROUP BY ticket_key
      ) bh_summary ON jt.key = bh_summary.ticket_key
      LEFT JOIN applications a ON jt.application = a.code
      LEFT JOIN jira_projects jp ON jt.project_key = jp.key
      WHERE jt.loe_approved_at IS NOT NULL
        AND jt.is_mock_data = 0
        AND bh_summary.work_months != strftime('%Y-%m', jt.loe_approved_at)
        AND bh_summary.work_months NOT LIKE '%' || strftime('%Y-%m', jt.loe_approved_at) || '%'
      ORDER BY bh_summary.total_hours DESC
    `).all() as Array<{
      key: string;
      summary: string;
      application: string | null;
      status: string;
      loe_approved_at: string;
      application_name: string | null;
      phase: string | null;
      approved_month: string;
      work_months: string;
      total_hours: number;
      hours_by_month: string;
    }>;

    // Parse and format the results
    const formattedMismatches = mismatches.map((m) => {
      // Parse hours by month
      const hoursByMonth: Record<string, number> = {};
      if (m.hours_by_month) {
        const entries = m.hours_by_month.split('|');
        for (const entry of entries) {
          const [month, hours] = entry.split(':');
          if (month && hours) {
            hoursByMonth[month] = (hoursByMonth[month] || 0) + parseFloat(hours);
          }
        }
      }

      return {
        key: m.key,
        summary: m.summary,
        application: m.application,
        applicationName: m.application_name,
        phase: m.phase,
        status: m.status,
        approvedMonth: m.approved_month,
        approvedAt: m.loe_approved_at,
        workMonths: m.work_months.split(','),
        totalHours: m.total_hours,
        hoursByMonth,
      };
    });

    const totalMismatchedHours = formattedMismatches.reduce((sum, m) => sum + m.totalHours, 0);

    res.json({
      mismatches: formattedMismatches,
      summary: {
        ticketCount: formattedMismatches.length,
        totalHours: Math.round(totalMismatchedHours * 100) / 100,
        description: 'Tickets where burnt hours were recorded in a different month than the LOE approval date',
      },
    });
  } catch (error) {
    next(error);
  }
});

// Export audit trail for a ticket
complianceRouter.get('/audit-trail/:ticketKey', (req, res, next) => {
  try {
    const { ticketKey } = req.params;
    const db = getDb();

    const ticket = db.prepare(`
      SELECT jt.*, jp.phase, a.name as application_name
      FROM jira_tickets jt
      LEFT JOIN jira_projects jp ON jt.project_key = jp.key
      LEFT JOIN applications a ON jt.application = a.code
      WHERE jt.key = ?
    `).get(ticketKey);

    const burntHistory = db.prepare(`
      SELECT 
        bh.*,
        ib.filename,
        ib.imported_at,
        u.name as imported_by_name
      FROM burnt_hours bh
      LEFT JOIN import_batches ib ON bh.import_batch_id = ib.id
      LEFT JOIN users u ON ib.imported_by = u.id
      WHERE bh.ticket_key = ?
      ORDER BY bh.work_date, ib.imported_at
    `).all(ticketKey);

    const totalBurnt = burntHistory.reduce((sum: number, bh: any) => sum + bh.hours, 0);

    res.json({
      ticket,
      burntHistory,
      totalBurnt,
      loeEstimate: (ticket as any)?.loe_hours,
      variance: (ticket as any)?.loe_hours ? totalBurnt - (ticket as any).loe_hours : null,
    });
  } catch (error) {
    next(error);
  }
});
