import { Router } from 'express';
import { getDb } from '../db/database.js';
import { authenticate } from '../middleware/auth.js';
import { config } from '../config.js';

export const dashboardRouter = Router();

// All dashboard routes require authentication
dashboardRouter.use(authenticate);

// Helper to parse period params from query string
interface PeriodParams {
  year: number | null;
  month: number | null;
  isAllTime: boolean;
}

function parsePeriodParams(query: any): PeriodParams {
  const year = query.year ? parseInt(query.year as string, 10) : null;
  const month = query.month ? parseInt(query.month as string, 10) : null;
  const isAllTime = query.period === 'all' || (!year && !month);
  
  return { year, month, isAllTime };
}

// Get available periods (months/years with approved tickets or burnt hours)
dashboardRouter.get('/periods', (req, res, next) => {
  try {
    const db = getDb();

    // Get periods from approved tickets (by loe_approved_at)
    const ticketPeriods = db.prepare(`
      SELECT DISTINCT
        CAST(strftime('%Y', loe_approved_at) AS INTEGER) as year,
        CAST(strftime('%m', loe_approved_at) AS INTEGER) as month
      FROM jira_tickets
      WHERE loe_approved_at IS NOT NULL
        AND is_mock_data = 0
      ORDER BY year DESC, month DESC
    `).all() as Array<{ year: number; month: number }>;

    // Get periods from burnt hours (by work_date for fallback)
    const burntPeriods = db.prepare(`
      SELECT DISTINCT
        CAST(strftime('%Y', work_date) AS INTEGER) as year,
        CAST(strftime('%m', work_date) AS INTEGER) as month
      FROM burnt_hours
      WHERE work_date IS NOT NULL
        AND is_mock_data = 0
      ORDER BY year DESC, month DESC
    `).all() as Array<{ year: number; month: number }>;

    // Merge and deduplicate periods
    const allPeriods = new Map<string, { year: number; month: number }>();
    
    for (const p of [...ticketPeriods, ...burntPeriods]) {
      if (p.year && p.month) {
        const key = `${p.year}-${p.month}`;
        if (!allPeriods.has(key)) {
          allPeriods.set(key, { year: p.year, month: p.month });
        }
      }
    }

    // Convert to sorted array
    const periods = Array.from(allPeriods.values())
      .sort((a, b) => {
        if (a.year !== b.year) return b.year - a.year;
        return b.month - a.month;
      });

    // Get unique years
    const years = [...new Set(periods.map(p => p.year))].sort((a, b) => b - a);

    // Current period
    const now = new Date();
    const currentPeriod = {
      year: now.getFullYear(),
      month: now.getMonth() + 1,
    };

    res.json({
      periods,
      years,
      currentPeriod,
    });
  } catch (error) {
    next(error);
  }
});

// Ticket Overview (shows ticket counts by application/status - works without burnt hours)
dashboardRouter.get('/ticket-overview', (req, res, next) => {
  try {
    const db = getDb();

    // Total tickets by application (only HCM/ERP for production focus)
    const byApplication = db.prepare(`
      SELECT 
        COALESCE(application, 'Unclassified') as application,
        COUNT(*) as count,
        COUNT(CASE WHEN status NOT IN ('Closed', 'Resolved', 'Done', 'Cancelled') THEN 1 END) as open_count,
        COALESCE(SUM(loe_hours), 0) as total_loe_hours
      FROM jira_tickets
      WHERE is_mock_data = 0
      GROUP BY application
      ORDER BY count DESC
    `).all() as Array<{
      application: string;
      count: number;
      open_count: number;
      total_loe_hours: number;
    }>;

    // Total tickets by project/phase with project details
    const byPhase = db.prepare(`
      SELECT 
        jp.phase,
        jp.key as project_key,
        jp.name as project_name,
        COUNT(*) as count,
        COUNT(CASE WHEN jt.status NOT IN ('Closed', 'Resolved', 'Done', 'Cancelled') THEN 1 END) as open_count,
        COALESCE(SUM(jt.loe_hours), 0) as total_loe_hours,
        COUNT(CASE WHEN jt.loe_hours > 0 THEN 1 END) as tickets_with_loe
      FROM jira_tickets jt
      JOIN jira_projects jp ON jt.project_key = jp.key
      WHERE jt.is_mock_data = 0
      GROUP BY jp.phase, jp.key
      ORDER BY 
        CASE jp.phase 
          WHEN 'Support' THEN 1 
          WHEN 'Stabilization' THEN 2 
          WHEN 'Optimization' THEN 3
          WHEN 'Implementation' THEN 4 
          WHEN 'Pre-Planning' THEN 5 
        END,
        count DESC
    `).all() as Array<{
      phase: string;
      project_key: string;
      project_name: string;
      count: number;
      open_count: number;
      total_loe_hours: number;
      tickets_with_loe: number;
    }>;

    // Production LOE summary (Support + Stabilization for HCM/ERP only)
    const productionLoe = db.prepare(`
      SELECT 
        COALESCE(jt.application, 'Other') as application,
        jp.phase,
        COUNT(*) as tickets,
        COUNT(CASE WHEN jt.status NOT IN ('Closed', 'Resolved', 'Done', 'Cancelled') THEN 1 END) as open_tickets,
        COALESCE(SUM(jt.loe_hours), 0) as loe_hours,
        COUNT(CASE WHEN jt.loe_hours > 0 THEN 1 END) as with_loe
      FROM jira_tickets jt
      JOIN jira_projects jp ON jt.project_key = jp.key
      WHERE jt.is_mock_data = 0
        AND jp.phase IN ('Support', 'Stabilization')
        AND jt.application IN ('HCM', 'ERP')
      GROUP BY jt.application, jp.phase
      ORDER BY jp.phase, jt.application
    `).all() as Array<{
      application: string;
      phase: string;
      tickets: number;
      open_tickets: number;
      loe_hours: number;
      with_loe: number;
    }>;

    // Tickets by status
    const byStatus = db.prepare(`
      SELECT 
        status,
        COUNT(*) as count
      FROM jira_tickets
      WHERE is_mock_data = 0
      GROUP BY status
      ORDER BY count DESC
    `).all() as Array<{ status: string; count: number }>;

    // Summary totals - separate production vs pre-planning
    const totals = db.prepare(`
      SELECT 
        COUNT(*) as total_tickets,
        COUNT(CASE WHEN status NOT IN ('Closed', 'Resolved', 'Done', 'Cancelled') THEN 1 END) as open_tickets,
        COALESCE(SUM(loe_hours), 0) as total_loe_hours,
        COUNT(CASE WHEN loe_hours > 0 THEN 1 END) as tickets_with_loe
      FROM jira_tickets
      WHERE is_mock_data = 0
    `).get() as {
      total_tickets: number;
      open_tickets: number;
      total_loe_hours: number;
      tickets_with_loe: number;
    };

    // Production totals (Support + Stabilization + Optimization for HCM/ERP)
    const productionTotals = db.prepare(`
      SELECT 
        COUNT(*) as total_tickets,
        COUNT(CASE WHEN jt.status NOT IN ('Closed', 'Resolved', 'Done', 'Cancelled') THEN 1 END) as open_tickets,
        COALESCE(SUM(jt.loe_hours), 0) as total_loe_hours,
        COUNT(CASE WHEN jt.loe_hours > 0 THEN 1 END) as tickets_with_loe
      FROM jira_tickets jt
      JOIN jira_projects jp ON jt.project_key = jp.key
      WHERE jt.is_mock_data = 0
        AND jp.phase IN ('Support', 'Stabilization', 'Optimization')
    `).get() as {
      total_tickets: number;
      open_tickets: number;
      total_loe_hours: number;
      tickets_with_loe: number;
    };

    // Recent tickets (prioritize production)
    const recentTickets = db.prepare(`
      SELECT 
        jt.key, jt.summary, jt.application, jt.status, jt.priority, jt.loe_hours,
        jp.phase,
        datetime(jt.jira_updated_at) as updated_at
      FROM jira_tickets jt
      JOIN jira_projects jp ON jt.project_key = jp.key
      WHERE jt.is_mock_data = 0
      ORDER BY jt.jira_updated_at DESC
      LIMIT 10
    `).all();

    res.json({
      totals,
      productionTotals,
      byApplication,
      byPhase,
      byStatus,
      productionLoe,
      recentTickets,
      useMockData: config.useMockData,
    });
  } catch (error) {
    next(error);
  }
});

// Budget Overview - now supports period filtering
dashboardRouter.get('/budget-overview', (req, res, next) => {
  try {
    const db = getDb();
    const { year: filterYear, month: filterMonth, isAllTime } = parsePeriodParams(req.query);
    
    const now = new Date();
    const year = filterYear || now.getFullYear();
    const month = filterMonth || now.getMonth() + 1;

    // For all-time view, aggregate across all periods
    if (isAllTime) {
      // Get total burnt hours across all time with LOE breakdown and work type breakdown
      // IMPORTANT: Only MOCS project hours count against the budget
      // Note: Urgent work (Critical/High priority or Payroll) is expected without LOE approval
      const burntResult = db.prepare(`
        SELECT 
          COALESCE(SUM(bh.hours), 0) as total_burnt,
          COALESCE(SUM(CASE WHEN bh.is_admin_overhead = 1 THEN bh.hours ELSE 0 END), 0) as admin_overhead,
          COUNT(DISTINCT strftime('%Y-%m', bh.work_date)) as months_count,
          COALESCE(SUM(CASE WHEN jt.loe_hours > 0 THEN bh.hours ELSE 0 END), 0) as hours_with_loe,
          COALESCE(SUM(CASE WHEN jt.status = 'LOE Approved' AND (jt.loe_hours IS NULL OR jt.loe_hours = 0) THEN bh.hours ELSE 0 END), 0) as hours_approved_no_loe,
          COALESCE(SUM(CASE 
            WHEN (jt.status != 'LOE Approved' OR jt.status IS NULL) 
              AND bh.is_admin_overhead = 0
              AND (jt.priority IN ('Critical', 'High', 'Highest') OR jt.summary LIKE '%Payroll%' OR jt.summary LIKE '%payroll%')
            THEN bh.hours ELSE 0 END), 0) as hours_urgent,
          COALESCE(SUM(CASE 
            WHEN (jt.status != 'LOE Approved' OR jt.status IS NULL) 
              AND bh.is_admin_overhead = 0
              AND (jt.priority IS NULL OR jt.priority NOT IN ('Critical', 'High', 'Highest'))
              AND jt.summary NOT LIKE '%Payroll%' AND jt.summary NOT LIKE '%payroll%'
            THEN bh.hours ELSE 0 END), 0) as hours_unapproved,
          -- Work type breakdown for stacked progress bar
          COALESCE(SUM(CASE 
            WHEN bh.is_admin_overhead = 0
              AND jt.priority IN ('Critical', 'High', 'Highest')
              AND (jt.module NOT LIKE '%Payroll%' AND jt.summary NOT LIKE '%Payroll%' AND jt.summary NOT LIKE '%payroll%')
            THEN bh.hours ELSE 0 END), 0) as hours_urgent_priority,
          COALESCE(SUM(CASE 
            WHEN bh.is_admin_overhead = 0
              AND (jt.module LIKE '%Payroll%' OR jt.summary LIKE '%Payroll%' OR jt.summary LIKE '%payroll%')
            THEN bh.hours ELSE 0 END), 0) as hours_payroll,
          COALESCE(SUM(CASE 
            WHEN bh.is_admin_overhead = 0
              AND (jt.priority IS NULL OR jt.priority NOT IN ('Critical', 'High', 'Highest'))
              AND (jt.module NOT LIKE '%Payroll%' AND jt.summary NOT LIKE '%Payroll%' AND jt.summary NOT LIKE '%payroll%')
            THEN bh.hours ELSE 0 END), 0) as hours_regular
        FROM burnt_hours bh
        LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
        WHERE bh.is_mock_data = 0
          AND (bh.jira_project = 'MOCS' OR bh.is_admin_overhead = 1)
      `).get() as { 
        total_burnt: number; 
        admin_overhead: number; 
        months_count: number;
        hours_with_loe: number;
        hours_approved_no_loe: number;
        hours_urgent: number;
        hours_unapproved: number;
        hours_urgent_priority: number;
        hours_payroll: number;
        hours_regular: number;
      };

      // Get total allocated hours across all budget periods
      const allocatedResult = db.prepare(`
        SELECT COALESCE(SUM(allocated_hours), 0) as total_allocated
        FROM budget_periods
        WHERE is_mock_data = 0
      `).get() as { total_allocated: number };

      const totalBurnt = burntResult.total_burnt;
      const adminOverhead = burntResult.admin_overhead;
      const allocatedHours = allocatedResult.total_allocated || (burntResult.months_count * config.defaultMonthlyHours);
      const remaining = Math.max(0, allocatedHours - totalBurnt);
      const burnPercent = allocatedHours > 0 ? (totalBurnt / allocatedHours) * 100 : 0;

      res.json({
        period: { year: null, month: null, isAllTime: true },
        allocatedHours,
        totalBurnt,
        remaining,
        adminOverhead,
        loeBreakdown: {
          hoursWithLoe: Math.round(burntResult.hours_with_loe * 10) / 10,
          hoursApprovedNoLoe: Math.round(burntResult.hours_approved_no_loe * 10) / 10,
          hoursUrgent: Math.round(burntResult.hours_urgent * 10) / 10,
          hoursUnapproved: Math.round(burntResult.hours_unapproved * 10) / 10,
        },
        workTypeBreakdown: {
          urgent: Math.round(burntResult.hours_urgent_priority * 10) / 10,
          payroll: Math.round(burntResult.hours_payroll * 10) / 10,
          regular: Math.round(burntResult.hours_regular * 10) / 10,
          admin: Math.round(adminOverhead * 10) / 10,
        },
        burnPercent: Math.round(burnPercent * 10) / 10,
        burnRate: null,
        projectedTotal: null,
        projectedExhaustionDay: null,
        isExhausted: totalBurnt >= allocatedHours,
        status: burnPercent < 50 ? 'green' : burnPercent < 75 ? 'yellow' : burnPercent < 90 ? 'orange' : 'red',
        useMockData: config.useMockData,
      });
      return;
    }

    // Get specific month's budget allocation
    const budget = db.prepare(`
      SELECT allocated_hours, notes FROM budget_periods 
      WHERE year = ? AND month = ?
    `).get(year, month) as { allocated_hours: number; notes: string } | undefined;

    const allocatedHours = budget?.allocated_hours ?? config.defaultMonthlyHours;

    // Get burnt hours for the selected period with LOE breakdown and work type breakdown
    // IMPORTANT: Only MOCS project hours count against the budget
    // Now filter by ticket approval month (loe_approved_at) instead of work_date
    // Note: Urgent work (Critical/High priority or Payroll) is expected without LOE approval
    const burntResult = db.prepare(`
      SELECT 
        COALESCE(SUM(bh.hours), 0) as total_burnt,
        COALESCE(SUM(CASE WHEN bh.is_admin_overhead = 1 THEN bh.hours ELSE 0 END), 0) as admin_overhead,
        COALESCE(SUM(CASE WHEN jt.loe_hours > 0 THEN bh.hours ELSE 0 END), 0) as hours_with_loe,
        COALESCE(SUM(CASE WHEN jt.status = 'LOE Approved' AND (jt.loe_hours IS NULL OR jt.loe_hours = 0) THEN bh.hours ELSE 0 END), 0) as hours_approved_no_loe,
        COALESCE(SUM(CASE 
          WHEN (jt.status != 'LOE Approved' OR jt.status IS NULL) 
            AND bh.is_admin_overhead = 0
            AND (jt.priority IN ('Critical', 'High', 'Highest') OR jt.summary LIKE '%Payroll%' OR jt.summary LIKE '%payroll%')
          THEN bh.hours ELSE 0 END), 0) as hours_urgent,
        COALESCE(SUM(CASE 
          WHEN (jt.status != 'LOE Approved' OR jt.status IS NULL) 
            AND bh.is_admin_overhead = 0
            AND (jt.priority IS NULL OR jt.priority NOT IN ('Critical', 'High', 'Highest'))
            AND jt.summary NOT LIKE '%Payroll%' AND jt.summary NOT LIKE '%payroll%'
          THEN bh.hours ELSE 0 END), 0) as hours_unapproved,
        -- Work type breakdown for stacked progress bar
        COALESCE(SUM(CASE 
          WHEN bh.is_admin_overhead = 0
            AND jt.priority IN ('Critical', 'High', 'Highest')
            AND (jt.module NOT LIKE '%Payroll%' AND jt.summary NOT LIKE '%Payroll%' AND jt.summary NOT LIKE '%payroll%')
          THEN bh.hours ELSE 0 END), 0) as hours_urgent_priority,
        COALESCE(SUM(CASE 
          WHEN bh.is_admin_overhead = 0
            AND (jt.module LIKE '%Payroll%' OR jt.summary LIKE '%Payroll%' OR jt.summary LIKE '%payroll%')
          THEN bh.hours ELSE 0 END), 0) as hours_payroll,
        COALESCE(SUM(CASE 
          WHEN bh.is_admin_overhead = 0
            AND (jt.priority IS NULL OR jt.priority NOT IN ('Critical', 'High', 'Highest'))
            AND (jt.module NOT LIKE '%Payroll%' AND jt.summary NOT LIKE '%Payroll%' AND jt.summary NOT LIKE '%payroll%')
          THEN bh.hours ELSE 0 END), 0) as hours_regular
      FROM burnt_hours bh
      LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
      WHERE bh.is_mock_data = 0
        AND (bh.jira_project = 'MOCS' OR bh.is_admin_overhead = 1)
        AND (
          -- Use loe_approved_at month if available, otherwise fall back to work_date
          (jt.loe_approved_at IS NOT NULL AND strftime('%Y', jt.loe_approved_at) = ? AND strftime('%m', jt.loe_approved_at) = ?)
          OR (jt.loe_approved_at IS NULL AND strftime('%Y', bh.work_date) = ? AND strftime('%m', bh.work_date) = ?)
          OR (bh.ticket_key IS NULL AND strftime('%Y', bh.work_date) = ? AND strftime('%m', bh.work_date) = ?)
        )
    `).get(
      year.toString(), month.toString().padStart(2, '0'),
      year.toString(), month.toString().padStart(2, '0'),
      year.toString(), month.toString().padStart(2, '0')
    ) as { 
      total_burnt: number; 
      admin_overhead: number;
      hours_with_loe: number;
      hours_approved_no_loe: number;
      hours_urgent: number;
      hours_unapproved: number;
      hours_urgent_priority: number;
      hours_payroll: number;
      hours_regular: number;
    };

    const totalBurnt = burntResult.total_burnt;
    const adminOverhead = burntResult.admin_overhead;
    const remaining = Math.max(0, allocatedHours - totalBurnt);
    const burnPercent = (totalBurnt / allocatedHours) * 100;
    const isExhausted = totalBurnt >= allocatedHours;

    // Calculate burn rate only for current month
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const daysElapsed = isCurrentMonth ? now.getDate() : new Date(year, month, 0).getDate();
    const burnRate = daysElapsed > 0 ? totalBurnt / daysElapsed : 0;
    
    // Project when budget will be exhausted (only for current month)
    const daysInMonth = new Date(year, month, 0).getDate();
    const daysRemaining = isCurrentMonth ? daysInMonth - now.getDate() : 0;
    const projectedTotal = isCurrentMonth ? totalBurnt + (burnRate * daysRemaining) : totalBurnt;
    const projectedExhaustionDay = isCurrentMonth && burnRate > 0 ? Math.ceil(remaining / burnRate) + now.getDate() : null;

    // Determine status
    let status: 'green' | 'yellow' | 'orange' | 'red';
    if (burnPercent < 50) status = 'green';
    else if (burnPercent < 75) status = 'yellow';
    else if (burnPercent < 90) status = 'orange';
    else status = 'red';

    res.json({
      period: { year, month, isAllTime: false },
      allocatedHours,
      totalBurnt,
      remaining,
      adminOverhead,
      loeBreakdown: {
        hoursWithLoe: Math.round(burntResult.hours_with_loe * 10) / 10,
        hoursApprovedNoLoe: Math.round(burntResult.hours_approved_no_loe * 10) / 10,
        hoursUrgent: Math.round(burntResult.hours_urgent * 10) / 10,
        hoursUnapproved: Math.round(burntResult.hours_unapproved * 10) / 10,
      },
      workTypeBreakdown: {
        urgent: Math.round(burntResult.hours_urgent_priority * 10) / 10,
        payroll: Math.round(burntResult.hours_payroll * 10) / 10,
        regular: Math.round(burntResult.hours_regular * 10) / 10,
        admin: Math.round(burntResult.admin_overhead * 10) / 10,
      },
      burnPercent: Math.round(burnPercent * 10) / 10,
      burnRate: isCurrentMonth ? Math.round(burnRate * 10) / 10 : null,
      projectedTotal: isCurrentMonth ? Math.round(projectedTotal * 10) / 10 : null,
      projectedExhaustionDay,
      isExhausted,
      status,
      useMockData: config.useMockData,
    });
  } catch (error) {
    next(error);
  }
});

// Application Breakdown - now supports period filtering
dashboardRouter.get('/application-breakdown', (req, res, next) => {
  try {
    const db = getDb();
    const { year: filterYear, month: filterMonth, isAllTime } = parsePeriodParams(req.query);
    
    const now = new Date();
    const year = filterYear || now.getFullYear();
    const month = filterMonth || now.getMonth() + 1;

    let breakdown: Array<{
      application: string;
      application_name: string | null;
      hours_burnt: number;
      ticket_count: number;
    }>;

    if (isAllTime) {
      // All-time breakdown
      breakdown = db.prepare(`
        SELECT 
          COALESCE(jt.application, 'Unclassified') as application,
          a.name as application_name,
          COALESCE(SUM(bh.hours), 0) as hours_burnt,
          COUNT(DISTINCT bh.ticket_key) as ticket_count
        FROM burnt_hours bh
        LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
        LEFT JOIN applications a ON jt.application = a.code
        WHERE bh.is_admin_overhead = 0
          AND bh.is_mock_data = 0
        GROUP BY jt.application
        ORDER BY hours_burnt DESC
      `).all() as typeof breakdown;

      const adminHours = db.prepare(`
        SELECT COALESCE(SUM(hours), 0) as hours
        FROM burnt_hours
        WHERE is_admin_overhead = 1 AND is_mock_data = 0
      `).get() as { hours: number };

      if (adminHours.hours > 0) {
        breakdown.push({
          application: 'Admin/Overhead',
          application_name: 'Admin/Overhead',
          hours_burnt: adminHours.hours,
          ticket_count: 0,
        });
      }

      res.json({
        period: { year: null, month: null, isAllTime: true },
        breakdown,
      });
      return;
    }

    // Get hours by application for selected period (filtered by loe_approved_at)
    breakdown = db.prepare(`
      SELECT 
        COALESCE(jt.application, 'Unclassified') as application,
        a.name as application_name,
        COALESCE(SUM(bh.hours), 0) as hours_burnt,
        COUNT(DISTINCT bh.ticket_key) as ticket_count
      FROM burnt_hours bh
      LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
      LEFT JOIN applications a ON jt.application = a.code
      WHERE bh.is_admin_overhead = 0
        AND bh.is_mock_data = 0
        AND (
          (jt.loe_approved_at IS NOT NULL AND strftime('%Y', jt.loe_approved_at) = ? AND strftime('%m', jt.loe_approved_at) = ?)
          OR (jt.loe_approved_at IS NULL AND strftime('%Y', bh.work_date) = ? AND strftime('%m', bh.work_date) = ?)
        )
      GROUP BY jt.application
      ORDER BY hours_burnt DESC
    `).all(
      year.toString(), month.toString().padStart(2, '0'),
      year.toString(), month.toString().padStart(2, '0')
    ) as typeof breakdown;

    // Add admin/overhead as separate category (still use work_date for admin overhead)
    const adminHours = db.prepare(`
      SELECT COALESCE(SUM(hours), 0) as hours
      FROM burnt_hours
      WHERE strftime('%Y', work_date) = ? 
        AND strftime('%m', work_date) = ?
        AND is_admin_overhead = 1
        AND is_mock_data = 0
    `).get(year.toString(), month.toString().padStart(2, '0')) as { hours: number };

    if (adminHours.hours > 0) {
      breakdown.push({
        application: 'Admin/Overhead',
        application_name: 'Admin/Overhead',
        hours_burnt: adminHours.hours,
        ticket_count: 0,
      });
    }

    res.json({
      period: { year, month, isAllTime: false },
      breakdown,
    });
  } catch (error) {
    next(error);
  }
});

// Phase Breakdown - now supports period filtering
dashboardRouter.get('/phase-breakdown', (req, res, next) => {
  try {
    const db = getDb();
    const { year: filterYear, month: filterMonth, isAllTime } = parsePeriodParams(req.query);
    
    const now = new Date();
    const year = filterYear || now.getFullYear();
    const month = filterMonth || now.getMonth() + 1;

    let breakdown: Array<{
      phase: string;
      application: string;
      hours_burnt: number;
    }>;

    if (isAllTime) {
      // All-time breakdown
      breakdown = db.prepare(`
        SELECT 
          jp.phase,
          jt.application,
          COALESCE(SUM(bh.hours), 0) as hours_burnt
        FROM burnt_hours bh
        LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
        LEFT JOIN jira_projects jp ON jt.project_key = jp.key
        WHERE bh.is_admin_overhead = 0
          AND bh.is_mock_data = 0
          AND jp.phase IS NOT NULL
        GROUP BY jp.phase, jt.application
        ORDER BY jp.phase, jt.application
      `).all() as typeof breakdown;
    } else {
      // Get hours by phase for selected period (filtered by loe_approved_at)
      breakdown = db.prepare(`
        SELECT 
          jp.phase,
          jt.application,
          COALESCE(SUM(bh.hours), 0) as hours_burnt
        FROM burnt_hours bh
        LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
        LEFT JOIN jira_projects jp ON jt.project_key = jp.key
        WHERE bh.is_admin_overhead = 0
          AND bh.is_mock_data = 0
          AND jp.phase IS NOT NULL
          AND (
            (jt.loe_approved_at IS NOT NULL AND strftime('%Y', jt.loe_approved_at) = ? AND strftime('%m', jt.loe_approved_at) = ?)
            OR (jt.loe_approved_at IS NULL AND strftime('%Y', bh.work_date) = ? AND strftime('%m', bh.work_date) = ?)
          )
        GROUP BY jp.phase, jt.application
        ORDER BY jp.phase, jt.application
      `).all(
        year.toString(), month.toString().padStart(2, '0'),
        year.toString(), month.toString().padStart(2, '0')
      ) as typeof breakdown;
    }

    // Reshape into phase-centric structure
    const phases = ['Implementation', 'Stabilization', 'Support', 'Optimization', 'Pre-Planning'];
    const phaseData = phases.map(phase => {
      const phaseItems = breakdown.filter(b => b.phase === phase);
      const byApp: Record<string, number> = {};
      let total = 0;
      for (const item of phaseItems) {
        byApp[item.application || 'Unclassified'] = item.hours_burnt;
        total += item.hours_burnt;
      }
      return { phase, total, byApplication: byApp };
    });

    res.json({
      period: { year, month: isAllTime ? null : month, isAllTime },
      phases: phaseData,
    });
  } catch (error) {
    next(error);
  }
});

// Heat Map (Application x Phase matrix) - now supports period filtering
dashboardRouter.get('/heatmap', (req, res, next) => {
  try {
    const db = getDb();
    const { year: filterYear, month: filterMonth, isAllTime } = parsePeriodParams(req.query);
    
    const now = new Date();
    const year = filterYear || now.getFullYear();
    const month = filterMonth || now.getMonth() + 1;

    let data: Array<{
      application: string;
      phase: string | null;
      hours_burnt: number;
    }>;

    if (isAllTime) {
      // All-time heatmap
      data = db.prepare(`
        SELECT 
          COALESCE(jt.application, 'Unclassified') as application,
          jp.phase,
          COALESCE(SUM(bh.hours), 0) as hours_burnt
        FROM burnt_hours bh
        LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
        LEFT JOIN jira_projects jp ON jt.project_key = jp.key
        WHERE bh.is_admin_overhead = 0
          AND bh.is_mock_data = 0
        GROUP BY jt.application, jp.phase
      `).all() as typeof data;
    } else {
      // Get hours by application and phase for selected period
      data = db.prepare(`
        SELECT 
          COALESCE(jt.application, 'Unclassified') as application,
          jp.phase,
          COALESCE(SUM(bh.hours), 0) as hours_burnt
        FROM burnt_hours bh
        LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
        LEFT JOIN jira_projects jp ON jt.project_key = jp.key
        WHERE bh.is_admin_overhead = 0
          AND bh.is_mock_data = 0
          AND (
            (jt.loe_approved_at IS NOT NULL AND strftime('%Y', jt.loe_approved_at) = ? AND strftime('%m', jt.loe_approved_at) = ?)
            OR (jt.loe_approved_at IS NULL AND strftime('%Y', bh.work_date) = ? AND strftime('%m', bh.work_date) = ?)
          )
        GROUP BY jt.application, jp.phase
      `).all(
        year.toString(), month.toString().padStart(2, '0'),
        year.toString(), month.toString().padStart(2, '0')
      ) as typeof data;
    }

    // Get all applications and phases
    const applications = db.prepare('SELECT code, name FROM applications WHERE is_active = 1').all() as Array<{ code: string; name: string }>;
    const phases = ['Implementation', 'Stabilization', 'Support', 'Optimization', 'Pre-Planning'];

    // Build matrix
    const matrix: Record<string, Record<string, number>> = {};
    for (const app of applications) {
      matrix[app.code] = {};
      for (const phase of phases) {
        const match = data.find(d => d.application === app.code && d.phase === phase);
        matrix[app.code][phase] = match?.hours_burnt ?? 0;
      }
    }

    res.json({
      period: { year, month: isAllTime ? null : month, isAllTime },
      applications: applications.map(a => a.code),
      phases,
      matrix,
    });
  } catch (error) {
    next(error);
  }
});
