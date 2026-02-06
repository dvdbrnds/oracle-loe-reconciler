/**
 * Ticket Scheduler Service
 * 
 * Handles auto-scheduling of tickets based on priority and capacity.
 * P1/P2/Payroll tickets are scheduled immediately (current month).
 * P3/P4 tickets are deferred to future months when capacity is available.
 */

import { getDb } from '../db/database.js';

export interface ScheduledTicket {
  ticket_key: string;
  scheduled_year: number;
  scheduled_month: number;
  scheduled_hours: number | null;
  auto_scheduled: boolean;
  priority_locked: boolean;
  notes: string | null;
}

export interface TicketForScheduling {
  key: string;
  summary: string;
  priority: string | null;
  status: string;
  loe_hours: number | null;
  module: string | null;
  jira_created_at: string | null;
  application: string | null;
}

export interface MonthCapacity {
  year: number;
  month: number;
  allocated_hours: number;
  scheduled_hours: number;
  immediate_hours: number;
  deferrable_hours: number;
  remaining_capacity: number;
}

export interface ForecastMonth extends MonthCapacity {
  is_historical: boolean;
  actual_hours?: number;  // For historical months - actual burnt hours
  tickets: Array<{
    key: string;
    summary: string;
    priority: string | null;
    status: string;
    loe_hours: number | null;
    scheduled_hours: number | null;
    actual_hours?: number;  // For historical months
    is_immediate: boolean;
    auto_scheduled: boolean;
    application: string | null;
    notes: string | null;
  }>;
}

export interface CommittedTicket {
  key: string;
  summary: string;
  priority: string | null;
  status: string;
  application: string | null;
  loe_hours: number;
  burnt_hours: number;
  remaining_hours: number;
  is_immediate: boolean;
}

export interface PipelineTicket {
  key: string;
  summary: string;
  priority: string | null;
  status: string;
  application: string | null;
  loe_hours: number;
  is_immediate: boolean;
  days_waiting: number;
}

export interface WorkloadSummary {
  // Approved work in progress (LOE approved, partially burnt)
  committed: {
    tickets: CommittedTicket[];
    total_loe: number;
    total_burnt: number;
    total_remaining: number;
    immediate_remaining: number;
    deferrable_remaining: number;
  };
  // Unapproved tickets waiting for LOE approval
  pipeline: {
    tickets: PipelineTicket[];
    total_loe: number;
    immediate_loe: number;
    deferrable_loe: number;
  };
  // Total future hours exposure
  total_future_hours: number;
}

// Priority levels that cannot be deferred (work immediately)
const IMMEDIATE_PRIORITIES = ['Critical', 'High', 'Highest', 'Urgent'];

// Statuses that indicate a ticket is ready to be worked
const WORKABLE_STATUSES = ['LOE Approved', 'LOE Provided'];

class SchedulerService {
  /**
   * Check if a ticket is immediate priority (P1/P2 or Payroll)
   */
  isImmediatePriority(ticket: TicketForScheduling): boolean {
    // Check priority
    if (ticket.priority && IMMEDIATE_PRIORITIES.includes(ticket.priority)) {
      return true;
    }
    
    // Check for Payroll in module or summary
    const payrollPattern = /payroll/i;
    if (ticket.module && payrollPattern.test(ticket.module)) {
      return true;
    }
    if (ticket.summary && payrollPattern.test(ticket.summary)) {
      return true;
    }
    
    return false;
  }

  /**
   * Check if a ticket is in a workable status
   */
  isWorkableStatus(ticket: TicketForScheduling): boolean {
    return WORKABLE_STATUSES.includes(ticket.status);
  }

  /**
   * Get tickets that should be scheduled (workable status with LOE hours)
   */
  getSchedulableTickets(): TicketForScheduling[] {
    const db = getDb();
    
    const tickets = db.prepare(`
      SELECT 
        key,
        summary,
        priority,
        status,
        loe_hours,
        module,
        jira_created_at,
        application
      FROM jira_tickets
      WHERE status IN ('LOE Approved', 'LOE Provided')
        AND loe_hours IS NOT NULL
        AND loe_hours > 0
      ORDER BY 
        CASE 
          WHEN priority IN ('Critical', 'Urgent', 'Highest', 'High') THEN 0
          ELSE 1
        END,
        jira_created_at ASC
    `).all() as TicketForScheduling[];
    
    return tickets;
  }

  /**
   * Get existing manual schedules (auto_scheduled = 0)
   */
  getManualSchedules(): Map<string, ScheduledTicket> {
    const db = getDb();
    
    const schedules = db.prepare(`
      SELECT 
        ticket_key,
        scheduled_year,
        scheduled_month,
        scheduled_hours,
        auto_scheduled,
        priority_locked,
        notes
      FROM ticket_schedules
      WHERE auto_scheduled = 0
    `).all() as any[];
    
    const map = new Map<string, ScheduledTicket>();
    for (const s of schedules) {
      map.set(s.ticket_key, {
        ticket_key: s.ticket_key,
        scheduled_year: s.scheduled_year,
        scheduled_month: s.scheduled_month,
        scheduled_hours: s.scheduled_hours,
        auto_scheduled: s.auto_scheduled === 1,
        priority_locked: s.priority_locked === 1,
        notes: s.notes,
      });
    }
    
    return map;
  }

  /**
   * Get budget allocations for a range of months
   * Auto-creates missing budget periods with default 100 hours
   */
  getBudgetPeriods(startYear: number, startMonth: number, months: number): MonthCapacity[] {
    const db = getDb();
    const periods: MonthCapacity[] = [];
    
    let year = startYear;
    let month = startMonth;
    
    // Prepare statements for efficiency
    const getBudget = db.prepare(`
      SELECT allocated_hours
      FROM budget_periods
      WHERE year = ? AND month = ?
    `);
    
    const createBudget = db.prepare(`
      INSERT OR IGNORE INTO budget_periods (year, month, allocated_hours, notes, is_mock_data)
      VALUES (?, ?, 100, 'Auto-created for forecasting', 0)
    `);
    
    for (let i = 0; i < months; i++) {
      // Get budget for this month (default to 100 if not configured)
      let budget = getBudget.get(year, month) as { allocated_hours: number } | undefined;
      
      // Auto-create budget period if it doesn't exist
      if (!budget) {
        createBudget.run(year, month);
        budget = { allocated_hours: 100 };
      }
      
      periods.push({
        year,
        month,
        allocated_hours: budget.allocated_hours,
        scheduled_hours: 0,
        immediate_hours: 0,
        deferrable_hours: 0,
        remaining_capacity: budget.allocated_hours,
      });
      
      // Move to next month
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
    
    return periods;
  }

  /**
   * Ensure budget periods exist through a target date
   * Used for bulk initialization
   */
  ensureBudgetPeriodsThrough(targetYear: number, targetMonth: number): number {
    const db = getDb();
    const now = new Date();
    const startYear = now.getFullYear();
    const startMonth = now.getMonth() + 1;
    
    let created = 0;
    let year = startYear;
    let month = startMonth;
    
    const createBudget = db.prepare(`
      INSERT OR IGNORE INTO budget_periods (year, month, allocated_hours, notes, is_mock_data)
      VALUES (?, ?, 100, 'Auto-created for forecasting', 0)
    `);
    
    while (year < targetYear || (year === targetYear && month <= targetMonth)) {
      const result = createBudget.run(year, month);
      if (result.changes > 0) {
        created++;
      }
      
      month++;
      if (month > 12) {
        month = 1;
        year++;
      }
    }
    
    return created;
  }

  /**
   * Run the auto-scheduling algorithm
   * Returns the new schedule without persisting it
   */
  calculateSchedule(
    tickets: TicketForScheduling[],
    manualSchedules: Map<string, ScheduledTicket>,
    periods: MonthCapacity[]
  ): Map<string, ScheduledTicket> {
    const schedule = new Map<string, ScheduledTicket>();
    
    // Copy manual schedules first (they take precedence)
    for (const [key, s] of manualSchedules) {
      schedule.set(key, s);
      
      // Update capacity for manually scheduled tickets
      const period = periods.find(p => p.year === s.scheduled_year && p.month === s.scheduled_month);
      if (period) {
        const hours = s.scheduled_hours ?? 0;
        period.scheduled_hours += hours;
        period.deferrable_hours += hours;
        period.remaining_capacity -= hours;
      }
    }
    
    // Separate immediate and deferrable tickets
    const immediateTickets: TicketForScheduling[] = [];
    const deferrableTickets: TicketForScheduling[] = [];
    
    for (const ticket of tickets) {
      // Skip if already manually scheduled
      if (manualSchedules.has(ticket.key)) continue;
      
      if (this.isImmediatePriority(ticket)) {
        immediateTickets.push(ticket);
      } else {
        deferrableTickets.push(ticket);
      }
    }
    
    // Current month is always first in periods
    const currentPeriod = periods[0];
    
    // Schedule immediate tickets to current month (regardless of capacity)
    for (const ticket of immediateTickets) {
      const hours = ticket.loe_hours ?? 0;
      
      schedule.set(ticket.key, {
        ticket_key: ticket.key,
        scheduled_year: currentPeriod.year,
        scheduled_month: currentPeriod.month,
        scheduled_hours: null, // Use LOE hours
        auto_scheduled: true,
        priority_locked: true,
        notes: null,
      });
      
      currentPeriod.scheduled_hours += hours;
      currentPeriod.immediate_hours += hours;
      currentPeriod.remaining_capacity -= hours;
    }
    
    // Schedule deferrable tickets based on capacity
    for (const ticket of deferrableTickets) {
      const hours = ticket.loe_hours ?? 0;
      
      // Find first month with capacity
      let targetPeriod = periods.find(p => p.remaining_capacity >= hours);
      
      // If no month has full capacity, find one with most remaining
      if (!targetPeriod) {
        targetPeriod = periods.reduce((best, p) => 
          p.remaining_capacity > best.remaining_capacity ? p : best
        );
      }
      
      schedule.set(ticket.key, {
        ticket_key: ticket.key,
        scheduled_year: targetPeriod.year,
        scheduled_month: targetPeriod.month,
        scheduled_hours: null, // Use LOE hours
        auto_scheduled: true,
        priority_locked: false,
        notes: null,
      });
      
      targetPeriod.scheduled_hours += hours;
      targetPeriod.deferrable_hours += hours;
      targetPeriod.remaining_capacity -= hours;
    }
    
    return schedule;
  }

  /**
   * Persist the schedule to the database
   */
  saveSchedule(schedule: Map<string, ScheduledTicket>, preserveManual: boolean = true): void {
    const db = getDb();
    
    const deleteStmt = preserveManual
      ? db.prepare('DELETE FROM ticket_schedules WHERE auto_scheduled = 1')
      : db.prepare('DELETE FROM ticket_schedules');
    
    const insertStmt = db.prepare(`
      INSERT INTO ticket_schedules (
        ticket_key, scheduled_year, scheduled_month, scheduled_hours,
        auto_scheduled, priority_locked, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ticket_key, scheduled_year, scheduled_month) DO UPDATE SET
        scheduled_hours = excluded.scheduled_hours,
        auto_scheduled = excluded.auto_scheduled,
        priority_locked = excluded.priority_locked,
        notes = excluded.notes,
        updated_at = datetime('now')
    `);
    
    const transaction = db.transaction(() => {
      deleteStmt.run();
      
      for (const [_, s] of schedule) {
        // Skip manual schedules if we're preserving them (they weren't deleted)
        if (preserveManual && !s.auto_scheduled) continue;
        
        insertStmt.run(
          s.ticket_key,
          s.scheduled_year,
          s.scheduled_month,
          s.scheduled_hours,
          s.auto_scheduled ? 1 : 0,
          s.priority_locked ? 1 : 0,
          s.notes
        );
      }
    });
    
    transaction();
  }

  /**
   * Run full recalculation of the schedule
   */
  recalculate(months: number = 24): { scheduled: number; immediate: number; deferred: number } {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    const tickets = this.getSchedulableTickets();
    const manualSchedules = this.getManualSchedules();
    const periods = this.getBudgetPeriods(currentYear, currentMonth, months);
    
    const schedule = this.calculateSchedule(tickets, manualSchedules, periods);
    this.saveSchedule(schedule, true);
    
    // Count stats
    let immediate = 0;
    let deferred = 0;
    
    for (const [_, s] of schedule) {
      if (s.priority_locked) {
        immediate++;
      } else {
        deferred++;
      }
    }
    
    return {
      scheduled: schedule.size,
      immediate,
      deferred,
    };
  }

  /**
   * Manually schedule a ticket to a specific month
   */
  scheduleTicket(
    ticketKey: string,
    year: number,
    month: number,
    hours?: number,
    notes?: string
  ): void {
    const db = getDb();
    
    // Get ticket info to determine if priority locked
    const ticket = db.prepare(`
      SELECT priority, module, summary
      FROM jira_tickets
      WHERE key = ?
    `).get(ticketKey) as TicketForScheduling | undefined;
    
    const priorityLocked = ticket ? this.isImmediatePriority(ticket) : false;
    
    db.prepare(`
      INSERT INTO ticket_schedules (
        ticket_key, scheduled_year, scheduled_month, scheduled_hours,
        auto_scheduled, priority_locked, notes
      ) VALUES (?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(ticket_key, scheduled_year, scheduled_month) DO UPDATE SET
        scheduled_hours = excluded.scheduled_hours,
        auto_scheduled = 0,
        priority_locked = excluded.priority_locked,
        notes = excluded.notes,
        updated_at = datetime('now')
    `).run(ticketKey, year, month, hours ?? null, priorityLocked ? 1 : 0, notes ?? null);
  }

  /**
   * Remove a manual schedule (revert to auto-scheduling)
   */
  unscheduleTicket(ticketKey: string): void {
    const db = getDb();
    db.prepare('DELETE FROM ticket_schedules WHERE ticket_key = ?').run(ticketKey);
  }

  /**
   * Get the forecast for a range of months
   * @param months - number of months to show
   * @param startOffset - offset from current month (negative for past, e.g., -6 for 6 months ago)
   */
  getForecast(months: number = 12, startOffset: number = 0): ForecastMonth[] {
    const db = getDb();
    const now = new Date();
    let startYear = now.getFullYear();
    let startMonth = now.getMonth() + 1 + startOffset;
    
    // Normalize the start date
    while (startMonth <= 0) {
      startMonth += 12;
      startYear--;
    }
    while (startMonth > 12) {
      startMonth -= 12;
      startYear++;
    }
    
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    
    const periods = this.getBudgetPeriods(startYear, startMonth, months);
    const forecast: ForecastMonth[] = [];
    
    for (const period of periods) {
      const isHistorical = period.year < currentYear || 
        (period.year === currentYear && period.month < currentMonth);
      
      if (isHistorical) {
        // For historical months, get actual burnt hours
        const actualData = db.prepare(`
          SELECT 
            COALESCE(SUM(bh.hours), 0) as total_hours
          FROM burnt_hours bh
          WHERE strftime('%Y', bh.work_date) = ?
            AND strftime('%m', bh.work_date) = ?
            AND bh.is_mock_data = 0
        `).get(
          period.year.toString(),
          period.month.toString().padStart(2, '0')
        ) as { total_hours: number };
        
        // Get tickets that had work done in this month
        const workedTickets = db.prepare(`
          SELECT 
            bh.ticket_key as key,
            SUM(bh.hours) as actual_hours,
            jt.summary,
            jt.priority,
            jt.status,
            jt.loe_hours,
            jt.application,
            CASE 
              WHEN jt.priority IN ('Critical', 'High', 'Highest', 'Urgent') 
                OR jt.module LIKE '%Payroll%' 
                OR jt.summary LIKE '%Payroll%'
              THEN 1 ELSE 0 
            END as is_immediate
          FROM burnt_hours bh
          LEFT JOIN jira_tickets jt ON bh.ticket_key = jt.key
          WHERE strftime('%Y', bh.work_date) = ?
            AND strftime('%m', bh.work_date) = ?
            AND bh.is_mock_data = 0
            AND bh.ticket_key IS NOT NULL
          GROUP BY bh.ticket_key
          ORDER BY actual_hours DESC
        `).all(
          period.year.toString(),
          period.month.toString().padStart(2, '0')
        ) as any[];
        
        let immediateHours = 0;
        let deferrableHours = 0;
        
        const tickets = workedTickets.map(t => {
          if (t.is_immediate) {
            immediateHours += t.actual_hours;
          } else {
            deferrableHours += t.actual_hours;
          }
          
          return {
            key: t.key,
            summary: t.summary || t.key,
            priority: t.priority,
            status: t.status,
            loe_hours: t.loe_hours,
            scheduled_hours: null,
            actual_hours: t.actual_hours,
            is_immediate: t.is_immediate === 1,
            auto_scheduled: false,
            application: t.application,
            notes: null,
          };
        });
        
        forecast.push({
          year: period.year,
          month: period.month,
          allocated_hours: period.allocated_hours,
          scheduled_hours: actualData.total_hours,
          immediate_hours: immediateHours,
          deferrable_hours: deferrableHours,
          remaining_capacity: period.allocated_hours - actualData.total_hours,
          actual_hours: actualData.total_hours,
          is_historical: true,
          tickets,
        });
      } else {
        // For current/future months, get scheduled tickets
        const scheduledTickets = db.prepare(`
          SELECT 
            ts.ticket_key as key,
            ts.scheduled_hours,
            ts.auto_scheduled,
            ts.priority_locked,
            ts.notes,
            jt.summary,
            jt.priority,
            jt.status,
            jt.loe_hours,
            jt.application
          FROM ticket_schedules ts
          JOIN jira_tickets jt ON ts.ticket_key = jt.key
          WHERE ts.scheduled_year = ? AND ts.scheduled_month = ?
          ORDER BY ts.priority_locked DESC, jt.jira_created_at ASC
        `).all(period.year, period.month) as any[];
        
        let immediateHours = 0;
        let deferrableHours = 0;
        
        const tickets = scheduledTickets.map(t => {
          const hours = t.scheduled_hours ?? t.loe_hours ?? 0;
          
          if (t.priority_locked) {
            immediateHours += hours;
          } else {
            deferrableHours += hours;
          }
          
          return {
            key: t.key,
            summary: t.summary,
            priority: t.priority,
            status: t.status,
            loe_hours: t.loe_hours,
            scheduled_hours: t.scheduled_hours,
            is_immediate: t.priority_locked === 1,
            auto_scheduled: t.auto_scheduled === 1,
            application: t.application,
            notes: t.notes,
          };
        });
        
        const totalScheduled = immediateHours + deferrableHours;
        
        forecast.push({
          year: period.year,
          month: period.month,
          allocated_hours: period.allocated_hours,
          scheduled_hours: totalScheduled,
          immediate_hours: immediateHours,
          deferrable_hours: deferrableHours,
          remaining_capacity: period.allocated_hours - totalScheduled,
          is_historical: false,
          tickets,
        });
      }
    }
    
    return forecast;
  }

  /**
   * Get capacity summary for all months
   */
  getCapacitySummary(months: number = 12): MonthCapacity[] {
    const forecast = this.getForecast(months);
    return forecast.map(f => ({
      year: f.year,
      month: f.month,
      allocated_hours: f.allocated_hours,
      scheduled_hours: f.scheduled_hours,
      immediate_hours: f.immediate_hours,
      deferrable_hours: f.deferrable_hours,
      remaining_capacity: f.remaining_capacity,
    }));
  }

  /**
   * Get unscheduled tickets (schedulable but not in schedule)
   */
  getUnscheduledTickets(): TicketForScheduling[] {
    const db = getDb();
    
    const tickets = db.prepare(`
      SELECT 
        jt.key,
        jt.summary,
        jt.priority,
        jt.status,
        jt.loe_hours,
        jt.module,
        jt.jira_created_at,
        jt.application
      FROM jira_tickets jt
      LEFT JOIN ticket_schedules ts ON jt.key = ts.ticket_key
      WHERE jt.status IN ('LOE Approved', 'LOE Provided')
        AND jt.loe_hours IS NOT NULL
        AND jt.loe_hours > 0
        AND ts.ticket_key IS NULL
      ORDER BY jt.jira_created_at ASC
    `).all() as TicketForScheduling[];
    
    return tickets;
  }

  /**
   * Get committed work - approved tickets with remaining LOE to burn
   * These are tickets that have been approved and may have started work,
   * but haven't consumed all their LOE hours yet.
   */
  getCommittedWork(): CommittedTicket[] {
    const db = getDb();
    
    const tickets = db.prepare(`
      SELECT 
        jt.key,
        jt.summary,
        jt.priority,
        jt.status,
        jt.application,
        jt.module,
        jt.loe_hours,
        COALESCE(burnt.total_burnt, 0) as burnt_hours,
        (jt.loe_hours - COALESCE(burnt.total_burnt, 0)) as remaining_hours,
        CASE 
          WHEN jt.priority IN ('Critical', 'High', 'Highest', 'Urgent') 
            OR jt.module LIKE '%Payroll%' 
            OR jt.summary LIKE '%Payroll%'
          THEN 1 ELSE 0 
        END as is_immediate
      FROM jira_tickets jt
      LEFT JOIN (
        SELECT ticket_key, SUM(hours) as total_burnt
        FROM burnt_hours
        WHERE is_mock_data = 0
        GROUP BY ticket_key
      ) burnt ON jt.key = burnt.ticket_key
      WHERE jt.status = 'LOE Approved'
        AND jt.loe_hours IS NOT NULL
        AND jt.loe_hours > 0
        AND (jt.loe_hours - COALESCE(burnt.total_burnt, 0)) > 0
      ORDER BY 
        is_immediate DESC,
        remaining_hours DESC
    `).all() as any[];
    
    return tickets.map(t => ({
      key: t.key,
      summary: t.summary,
      priority: t.priority,
      status: t.status,
      application: t.application,
      loe_hours: t.loe_hours,
      burnt_hours: t.burnt_hours,
      remaining_hours: t.remaining_hours,
      is_immediate: t.is_immediate === 1,
    }));
  }

  /**
   * Get pipeline work - tickets with LOE that are NOT approved and NOT closed
   * This is the full backlog of work that may need to be done.
   * Excludes: Closed, Resolved, LOE Approved (approved), In Progress (already working)
   */
  getPipelineWork(): PipelineTicket[] {
    const db = getDb();
    
    // Statuses that indicate work is done or actively being worked
    const excludedStatuses = ['Closed', 'Resolved', 'LOE Approved', 'In Progress'];
    
    const tickets = db.prepare(`
      SELECT 
        jt.key,
        jt.summary,
        jt.priority,
        jt.status,
        jt.application,
        jt.module,
        jt.loe_hours,
        CAST(julianday('now') - julianday(jt.jira_created_at) AS INTEGER) as days_waiting,
        CASE 
          WHEN jt.priority IN ('Critical', 'High', 'Highest', 'Urgent') 
            OR jt.module LIKE '%Payroll%' 
            OR jt.summary LIKE '%Payroll%'
          THEN 1 ELSE 0 
        END as is_immediate
      FROM jira_tickets jt
      WHERE jt.status NOT IN (${excludedStatuses.map(() => '?').join(',')})
        AND jt.loe_hours IS NOT NULL
        AND jt.loe_hours > 0
        AND jt.is_mock_data = 0
      ORDER BY 
        is_immediate DESC,
        days_waiting DESC,
        jt.loe_hours DESC
    `).all(...excludedStatuses) as any[];
    
    return tickets.map(t => ({
      key: t.key,
      summary: t.summary,
      priority: t.priority,
      status: t.status,
      application: t.application,
      loe_hours: t.loe_hours,
      is_immediate: t.is_immediate === 1,
      days_waiting: t.days_waiting || 0,
    }));
  }

  /**
   * Get comprehensive workload summary including committed and pipeline work
   */
  getWorkloadSummary(): WorkloadSummary {
    const committed = this.getCommittedWork();
    const pipeline = this.getPipelineWork();
    
    // Calculate committed totals
    const committedTotals = committed.reduce((acc, t) => {
      acc.total_loe += t.loe_hours;
      acc.total_burnt += t.burnt_hours;
      acc.total_remaining += t.remaining_hours;
      if (t.is_immediate) {
        acc.immediate_remaining += t.remaining_hours;
      } else {
        acc.deferrable_remaining += t.remaining_hours;
      }
      return acc;
    }, {
      total_loe: 0,
      total_burnt: 0,
      total_remaining: 0,
      immediate_remaining: 0,
      deferrable_remaining: 0,
    });
    
    // Calculate pipeline totals
    const pipelineTotals = pipeline.reduce((acc, t) => {
      acc.total_loe += t.loe_hours;
      if (t.is_immediate) {
        acc.immediate_loe += t.loe_hours;
      } else {
        acc.deferrable_loe += t.loe_hours;
      }
      return acc;
    }, {
      total_loe: 0,
      immediate_loe: 0,
      deferrable_loe: 0,
    });
    
    return {
      committed: {
        tickets: committed,
        ...committedTotals,
      },
      pipeline: {
        tickets: pipeline,
        ...pipelineTotals,
      },
      total_future_hours: committedTotals.total_remaining + pipelineTotals.total_loe,
    };
  }

  /**
   * Get forecast summary stats
   */
  getForecastSummary(forecast: ForecastMonth[]): any {
    const futureMonths = forecast.filter(m => !m.is_historical);
    
    return {
      totalMonths: futureMonths.length,
      totalScheduledHours: futureMonths.reduce((sum, m) => sum + m.scheduled_hours, 0),
      totalCapacityHours: futureMonths.reduce((sum, m) => sum + m.allocated_hours, 0),
      totalImmediateHours: futureMonths.reduce((sum, m) => sum + m.immediate_hours, 0),
      totalDeferredHours: futureMonths.reduce((sum, m) => sum + m.deferrable_hours, 0),
      totalTickets: futureMonths.reduce((sum, m) => sum + m.tickets.length, 0),
      utilizationPercent: futureMonths.length > 0
        ? (futureMonths.reduce((sum, m) => sum + m.scheduled_hours, 0) / 
           futureMonths.reduce((sum, m) => sum + m.allocated_hours, 0)) * 100
        : 0,
    };
  }
}

export const schedulerService = new SchedulerService();
