/**
 * Forecast Routes
 * 
 * Handles ticket forecasting and scheduling endpoints.
 */

import { Router } from 'express';
import { getDb } from '../db/database.js';
import { authenticate } from '../middleware/auth.js';
import { schedulerService } from '../services/scheduler.js';

export const forecastRouter = Router();

forecastRouter.use(authenticate);

/**
 * GET /api/forecast
 * Get forecast for a range of months (default: 12 months)
 * @query months - number of months to show (default 12, max 150 for full contract duration)
 * @query startOffset - offset from current month (negative for past, e.g., -6 for 6 months ago)
 */
forecastRouter.get('/', (req, res, next) => {
  try {
    const months = Math.min(Math.max(parseInt(req.query.months as string) || 12, 1), 150);
    const startOffset = parseInt(req.query.startOffset as string) || 0;
    const forecast = schedulerService.getForecast(months, startOffset);
    
    // Calculate summary stats
    const totalScheduled = forecast.reduce((sum, m) => sum + m.scheduled_hours, 0);
    const totalCapacity = forecast.reduce((sum, m) => sum + m.allocated_hours, 0);
    const totalImmediate = forecast.reduce((sum, m) => sum + m.immediate_hours, 0);
    const totalDeferred = forecast.reduce((sum, m) => sum + m.deferrable_hours, 0);
    const totalTickets = forecast.reduce((sum, m) => sum + m.tickets.length, 0);
    
    res.json({
      months: forecast,
      summary: {
        totalMonths: forecast.length,
        totalScheduledHours: Math.round(totalScheduled * 10) / 10,
        totalCapacityHours: Math.round(totalCapacity * 10) / 10,
        totalImmediateHours: Math.round(totalImmediate * 10) / 10,
        totalDeferredHours: Math.round(totalDeferred * 10) / 10,
        totalTickets,
        utilizationPercent: totalCapacity > 0 
          ? Math.round((totalScheduled / totalCapacity) * 1000) / 10 
          : 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/forecast/workload
 * Get comprehensive workload summary including:
 * - Committed: Approved tickets with remaining LOE to burn
 * - Pipeline: Unapproved tickets with LOE (future potential work)
 */
forecastRouter.get('/workload', (req, res, next) => {
  try {
    const workload = schedulerService.getWorkloadSummary();
    res.json(workload);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/forecast/timeline
 * Get ticket timeline view with less detail per month
 */
forecastRouter.get('/timeline', (req, res, next) => {
  try {
    const months = Math.min(Math.max(parseInt(req.query.months as string) || 24, 1), 150);
    const forecast = schedulerService.getForecast(months);
    
    // Return simplified timeline data
    const timeline = forecast.map(m => ({
      year: m.year,
      month: m.month,
      label: `${m.year}-${String(m.month).padStart(2, '0')}`,
      allocated: m.allocated_hours,
      scheduled: m.scheduled_hours,
      immediate: m.immediate_hours,
      deferred: m.deferrable_hours,
      remaining: m.remaining_capacity,
      ticketCount: m.tickets.length,
      isOverCapacity: m.scheduled_hours > m.allocated_hours,
    }));
    
    res.json({ timeline });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/forecast/capacity
 * Get monthly capacity breakdown without ticket details
 */
forecastRouter.get('/capacity', (req, res, next) => {
  try {
    const months = Math.min(Math.max(parseInt(req.query.months as string) || 12, 1), 150);
    const capacity = schedulerService.getCapacitySummary(months);
    
    res.json({ capacity });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/forecast/unscheduled
 * Get tickets that are schedulable but not yet in the schedule
 */
forecastRouter.get('/unscheduled', (req, res, next) => {
  try {
    const tickets = schedulerService.getUnscheduledTickets();
    
    // Add immediate flag
    const ticketsWithFlags = tickets.map(t => ({
      ...t,
      is_immediate: schedulerService.isImmediatePriority(t),
    }));
    
    res.json({
      tickets: ticketsWithFlags,
      count: ticketsWithFlags.length,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/forecast/schedule
 * Manually schedule a ticket to a specific month
 */
forecastRouter.post('/schedule', (req, res, next) => {
  try {
    const { ticketKey, year, month, hours, notes } = req.body;
    
    if (!ticketKey || !year || !month) {
      res.status(400).json({ error: 'ticketKey, year, and month are required' });
      return;
    }
    
    // Validate ticket exists
    const db = getDb();
    const ticket = db.prepare('SELECT key FROM jira_tickets WHERE key = ?').get(ticketKey);
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    
    // Validate month
    if (month < 1 || month > 12) {
      res.status(400).json({ error: 'Month must be between 1 and 12' });
      return;
    }
    
    // Validate year (reasonable range)
    const currentYear = new Date().getFullYear();
    if (year < currentYear - 1 || year > 2034) {
      res.status(400).json({ error: 'Year must be between last year and 2034' });
      return;
    }
    
    schedulerService.scheduleTicket(ticketKey, year, month, hours, notes);
    
    res.json({ 
      success: true, 
      message: `Ticket ${ticketKey} scheduled to ${year}-${String(month).padStart(2, '0')}`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/forecast/schedule/:ticketKey
 * Remove a manual schedule (revert to auto-scheduling)
 */
forecastRouter.delete('/schedule/:ticketKey', (req, res, next) => {
  try {
    const { ticketKey } = req.params;
    
    schedulerService.unscheduleTicket(ticketKey);
    
    res.json({ 
      success: true, 
      message: `Manual schedule removed for ${ticketKey}`,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/forecast/recalculate
 * Trigger full recalculation of auto-schedules
 */
forecastRouter.post('/recalculate', (req, res, next) => {
  try {
    const months = Math.min(Math.max(parseInt(req.body.months as string) || 24, 1), 150);
    
    // Ensure budget periods exist through Jan 2034
    const periodsCreated = schedulerService.ensureBudgetPeriodsThrough(2034, 1);
    
    const result = schedulerService.recalculate(months);
    
    res.json({
      success: true,
      message: 'Schedule recalculated',
      stats: {
        totalScheduled: result.scheduled,
        immediateTickets: result.immediate,
        deferredTickets: result.deferred,
        budgetPeriodsCreated: periodsCreated,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/forecast/init-budgets
 * Initialize budget periods through January 2034
 */
forecastRouter.post('/init-budgets', (req, res, next) => {
  try {
    const targetYear = parseInt(req.body.targetYear) || 2034;
    const targetMonth = parseInt(req.body.targetMonth) || 1;
    
    const created = schedulerService.ensureBudgetPeriodsThrough(targetYear, targetMonth);
    
    res.json({
      success: true,
      message: `Budget periods initialized through ${targetYear}-${String(targetMonth).padStart(2, '0')}`,
      periodsCreated: created,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/forecast/ticket/:ticketKey
 * Get schedule info for a specific ticket
 */
forecastRouter.get('/ticket/:ticketKey', (req, res, next) => {
  try {
    const { ticketKey } = req.params;
    const db = getDb();
    
    // Get ticket info
    const ticket = db.prepare(`
      SELECT 
        jt.key,
        jt.summary,
        jt.priority,
        jt.status,
        jt.loe_hours,
        jt.module,
        jt.application,
        jt.jira_created_at
      FROM jira_tickets jt
      WHERE jt.key = ?
    `).get(ticketKey) as any;
    
    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }
    
    // Get schedule info
    const schedule = db.prepare(`
      SELECT 
        scheduled_year,
        scheduled_month,
        scheduled_hours,
        auto_scheduled,
        priority_locked,
        notes,
        created_at,
        updated_at
      FROM ticket_schedules
      WHERE ticket_key = ?
    `).get(ticketKey) as any;
    
    const isImmediate = schedulerService.isImmediatePriority(ticket);
    
    res.json({
      ticket: {
        ...ticket,
        is_immediate: isImmediate,
      },
      schedule: schedule ? {
        year: schedule.scheduled_year,
        month: schedule.scheduled_month,
        hours: schedule.scheduled_hours,
        autoScheduled: schedule.auto_scheduled === 1,
        priorityLocked: schedule.priority_locked === 1,
        notes: schedule.notes,
        createdAt: schedule.created_at,
        updatedAt: schedule.updated_at,
      } : null,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/forecast/month/:year/:month
 * Get detailed forecast for a specific month
 */
forecastRouter.get('/month/:year/:month', (req, res, next) => {
  try {
    const year = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    
    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      res.status(400).json({ error: 'Invalid year or month' });
      return;
    }
    
    const db = getDb();
    
    // Get budget for this month
    const budget = db.prepare(`
      SELECT allocated_hours
      FROM budget_periods
      WHERE year = ? AND month = ?
    `).get(year, month) as { allocated_hours: number } | undefined;
    
    // Get scheduled tickets for this month
    const tickets = db.prepare(`
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
        jt.application,
        jt.module,
        a.name as application_name
      FROM ticket_schedules ts
      JOIN jira_tickets jt ON ts.ticket_key = jt.key
      LEFT JOIN applications a ON jt.application = a.code
      WHERE ts.scheduled_year = ? AND ts.scheduled_month = ?
      ORDER BY ts.priority_locked DESC, jt.jira_created_at ASC
    `).all(year, month) as any[];
    
    let immediateHours = 0;
    let deferrableHours = 0;
    
    const formattedTickets = tickets.map(t => {
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
        application: t.application,
        application_name: t.application_name,
        module: t.module,
        is_immediate: t.priority_locked === 1,
        auto_scheduled: t.auto_scheduled === 1,
        notes: t.notes,
      };
    });
    
    const allocatedHours = budget?.allocated_hours ?? 100;
    const totalScheduled = immediateHours + deferrableHours;
    
    res.json({
      year,
      month,
      label: `${year}-${String(month).padStart(2, '0')}`,
      allocated_hours: allocatedHours,
      scheduled_hours: totalScheduled,
      immediate_hours: immediateHours,
      deferrable_hours: deferrableHours,
      remaining_capacity: allocatedHours - totalScheduled,
      is_over_capacity: totalScheduled > allocatedHours,
      tickets: formattedTickets,
      ticket_count: formattedTickets.length,
    });
  } catch (error) {
    next(error);
  }
});
