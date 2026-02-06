import { useState, useEffect, useCallback } from 'react';
import { api } from '../services/api';
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  Clock,
  TrendingUp,
  AlertCircle,
  Zap,
  CalendarDays,
  MoveRight,
  ChevronLeft,
  ExternalLink,
  PlayCircle,
  Hourglass,
  Target,
} from 'lucide-react';

// Contract ends January 1, 2034
const CONTRACT_END_DATE = new Date(2034, 0, 1); // Month is 0-indexed, so 0 = January
const calculateMonthsUntilContractEnd = () => {
  const now = new Date();
  const years = CONTRACT_END_DATE.getFullYear() - now.getFullYear();
  const months = CONTRACT_END_DATE.getMonth() - now.getMonth();
  return Math.max(1, years * 12 + months);
};
const CONTRACT_MONTHS_REMAINING = calculateMonthsUntilContractEnd();

interface ForecastTicket {
  key: string;
  summary: string;
  priority: string | null;
  status: string;
  loe_hours: number | null;
  scheduled_hours: number | null;
  actual_hours?: number;
  is_immediate: boolean;
  auto_scheduled: boolean;
  application: string | null;
  notes: string | null;
}

interface ForecastMonth {
  year: number;
  month: number;
  allocated_hours: number;
  scheduled_hours: number;
  immediate_hours: number;
  deferrable_hours: number;
  remaining_capacity: number;
  is_historical: boolean;
  actual_hours?: number;
  tickets: ForecastTicket[];
}

interface ForecastSummary {
  totalMonths: number;
  totalScheduledHours: number;
  totalCapacityHours: number;
  totalImmediateHours: number;
  totalDeferredHours: number;
  totalTickets: number;
  utilizationPercent: number;
}

interface ForecastResponse {
  months: ForecastMonth[];
  summary: ForecastSummary;
}

interface CommittedTicket {
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

interface PipelineTicket {
  key: string;
  summary: string;
  priority: string | null;
  status: string;
  application: string | null;
  loe_hours: number;
  is_immediate: boolean;
  days_waiting: number;
}

interface WorkloadSummary {
  committed: {
    tickets: CommittedTicket[];
    total_loe: number;
    total_burnt: number;
    total_remaining: number;
    immediate_remaining: number;
    deferrable_remaining: number;
  };
  pipeline: {
    tickets: PipelineTicket[];
    total_loe: number;
    immediate_loe: number;
    deferrable_loe: number;
  };
  total_future_hours: number;
}

interface ScheduleModalProps {
  ticket: ForecastTicket;
  currentMonth: { year: number; month: number };
  onClose: () => void;
  onSchedule: (ticketKey: string, year: number, month: number, hours?: number, notes?: string) => Promise<void>;
  availableMonths: Array<{ year: number; month: number; label: string; remaining: number }>;
}

function ScheduleModal({ ticket, currentMonth, onClose, onSchedule, availableMonths }: ScheduleModalProps) {
  const [selectedYear, setSelectedYear] = useState(currentMonth.year);
  const [selectedMonth, setSelectedMonth] = useState(currentMonth.month);
  const [hours, setHours] = useState<string>(ticket.scheduled_hours?.toString() || ticket.loe_hours?.toString() || '');
  const [notes, setNotes] = useState(ticket.notes || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSchedule(
        ticket.key,
        selectedYear,
        selectedMonth,
        hours ? parseFloat(hours) : undefined,
        notes || undefined
      );
      onClose();
    } catch (error) {
      console.error('Failed to schedule ticket:', error);
    } finally {
      setSaving(false);
    }
  };

  const targetMonth = availableMonths.find(m => m.year === selectedYear && m.month === selectedMonth);
  const estimatedHours = hours ? parseFloat(hours) : (ticket.loe_hours || 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
        <h3 className="text-lg font-semibold mb-4">Schedule Ticket</h3>
        
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-gray-700">{ticket.key}</p>
            <p className="text-sm text-gray-500 truncate">{ticket.summary}</p>
          </div>

          {ticket.is_immediate && (
            <div className="bg-amber-50 text-amber-800 p-3 rounded-lg text-sm flex items-start gap-2">
              <Zap className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>This is a P1/P2/Payroll ticket and should be worked immediately. Rescheduling is not recommended.</span>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Target Month</label>
            <select
              value={`${selectedYear}-${selectedMonth}`}
              onChange={e => {
                const [y, m] = e.target.value.split('-').map(Number);
                setSelectedYear(y);
                setSelectedMonth(m);
              }}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              {availableMonths.map(m => (
                <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                  {m.label} ({m.remaining}h remaining)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Hours (optional override)
            </label>
            <input
              type="number"
              step="0.5"
              value={hours}
              onChange={e => setHours(e.target.value)}
              placeholder={`LOE: ${ticket.loe_hours || 0}h`}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Why is this being rescheduled?"
              rows={2}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          {targetMonth && (
            <div className="bg-gray-50 p-3 rounded-lg text-sm">
              <p className="font-medium">Impact on {targetMonth.label}:</p>
              <p className="text-gray-600">
                {targetMonth.remaining}h available → {(targetMonth.remaining - estimatedHours).toFixed(1)}h after scheduling
              </p>
              {targetMonth.remaining < estimatedHours && (
                <p className="text-amber-600 mt-1">This will exceed the monthly capacity</p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Schedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatMonth(year: number, month: number): string {
  return new Date(year, month - 1).toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric',
  });
}

function formatMonthLong(year: number, month: number): string {
  return new Date(year, month - 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function ForecastPage() {
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [workload, setWorkload] = useState<WorkloadSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(['committed', 'pipeline']));
  const [monthsToShow, setMonthsToShow] = useState(12);
  const [startOffset, setStartOffset] = useState(-3); // Start 3 months in the past by default
  const [scheduleModal, setScheduleModal] = useState<{
    ticket: ForecastTicket;
    month: { year: number; month: number };
  } | null>(null);

  const fetchForecast = useCallback(async () => {
    setLoading(true);
    try {
      const [forecastData, workloadData] = await Promise.all([
        api.get<ForecastResponse>(`/forecast?months=${monthsToShow}&startOffset=${startOffset}`),
        api.get<WorkloadSummary>('/forecast/workload'),
      ]);
      setForecast(forecastData);
      setWorkload(workloadData);
      
      // Auto-expand current month (find the first non-historical month)
      if (forecastData.months.length > 0) {
        const currentMonth = forecastData.months.find(m => !m.is_historical) || forecastData.months[0];
        setExpandedMonths(new Set([`${currentMonth.year}-${currentMonth.month}`]));
      }
    } catch (error) {
      console.error('Failed to fetch forecast:', error);
    } finally {
      setLoading(false);
    }
  }, [monthsToShow, startOffset]);

  useEffect(() => {
    fetchForecast();
  }, [fetchForecast]);

  const scrollTimeline = (direction: 'past' | 'future') => {
    if (direction === 'past') {
      setStartOffset(prev => prev - 6);
    } else {
      setStartOffset(prev => Math.min(prev + 6, 0)); // Don't go beyond current month for start
    }
  };

  const handleScheduleTicket = async (ticketKey: string, year: number, month: number, hours?: number, notes?: string) => {
    await api.post('/forecast/schedule', { ticketKey, year, month, hours, notes });
    await fetchForecast();
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const toggleMonth = (year: number, month: number) => {
    const key = `${year}-${month}`;
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getCapacityColor = (scheduled: number, allocated: number): string => {
    const percent = (scheduled / allocated) * 100;
    if (percent >= 100) return 'bg-red-500';
    if (percent >= 90) return 'bg-orange-500';
    if (percent >= 75) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const getProgressBarClass = (scheduled: number, allocated: number): string => {
    const percent = (scheduled / allocated) * 100;
    if (percent >= 100) return 'bg-red-100';
    if (percent >= 90) return 'bg-orange-100';
    if (percent >= 75) return 'bg-yellow-100';
    return 'bg-green-100';
  };

  const getPriorityBadgeColor = (priority: string | null, isImmediate: boolean) => {
    if (isImmediate) return 'bg-red-100 text-red-800';
    switch (priority?.toLowerCase()) {
      case 'critical':
      case 'highest':
      case 'urgent':
        return 'bg-red-100 text-red-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'medium':
      case 'normal':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!forecast) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-500">Failed to load forecast data</p>
        <button onClick={fetchForecast} className="mt-4 text-primary hover:underline">
          Try again
        </button>
      </div>
    );
  }

  const availableMonths = forecast.months.map(m => ({
    year: m.year,
    month: m.month,
    label: formatMonthLong(m.year, m.month),
    remaining: m.remaining_capacity,
  }));

  return (
    <div className="space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Forecast & Scheduling</h1>
          <p className="text-gray-600">Plan and schedule ticket work across future months</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={monthsToShow}
            onChange={e => setMonthsToShow(Number(e.target.value))}
            className="px-3 py-2 border rounded-lg bg-white"
          >
            <option value={6}>6 months</option>
            <option value={12}>12 months</option>
            <option value={24}>24 months</option>
            <option value={48}>48 months</option>
            <option value={96}>96 months (8 years)</option>
            <option value={CONTRACT_MONTHS_REMAINING}>Total Contract ({CONTRACT_MONTHS_REMAINING} months)</option>
          </select>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 uppercase flex items-center gap-1">
            <Clock className="w-3 h-3" /> Scheduled Hours
          </p>
          <p className="text-2xl font-bold text-blue-600">{forecast.summary.totalScheduledHours}</p>
          <p className="text-xs text-gray-500">across {forecast.summary.totalTickets} tickets</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 uppercase flex items-center gap-1">
            <CalendarDays className="w-3 h-3" /> Total Capacity
          </p>
          <p className="text-2xl font-bold text-green-600">{forecast.summary.totalCapacityHours}</p>
          <p className="text-xs text-gray-500">{forecast.summary.totalMonths} months</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 uppercase flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Utilization
          </p>
          <p className="text-2xl font-bold text-gray-900">{forecast.summary.utilizationPercent}%</p>
          <p className="text-xs text-gray-500">of capacity used</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 uppercase flex items-center gap-1">
            <Zap className="w-3 h-3" /> Immediate (P1/P2)
          </p>
          <p className="text-2xl font-bold text-red-600">{forecast.summary.totalImmediateHours}</p>
          <p className="text-xs text-gray-500">cannot be deferred</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 uppercase flex items-center gap-1">
            <Calendar className="w-3 h-3" /> Deferred (P3/P4)
          </p>
          <p className="text-2xl font-bold text-blue-600">{forecast.summary.totalDeferredHours}</p>
          <p className="text-xs text-gray-500">can be rescheduled</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 uppercase">Available</p>
          <p className="text-2xl font-bold text-emerald-600">
            {(forecast.summary.totalCapacityHours - forecast.summary.totalScheduledHours).toFixed(0)}
          </p>
          <p className="text-xs text-gray-500">hours remaining</p>
        </div>
      </div>

      {/* Workload Summary - Committed & Pipeline */}
      {workload && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-amber-50 rounded-xl shadow-sm border border-amber-200 p-4">
            <p className="text-xs text-amber-700 uppercase flex items-center gap-1">
              <PlayCircle className="w-3 h-3" /> Committed (In Progress)
            </p>
            <p className="text-2xl font-bold text-amber-600">{workload.committed.total_remaining.toFixed(0)}h</p>
            <p className="text-xs text-amber-600">
              {workload.committed.tickets.length} approved tickets with remaining LOE
            </p>
            <div className="mt-2 text-xs text-amber-700">
              <span className="inline-block mr-3">{workload.committed.total_burnt.toFixed(0)}h burnt</span>
              <span>{workload.committed.total_loe.toFixed(0)}h total LOE</span>
            </div>
          </div>
          <div className="bg-purple-50 rounded-xl shadow-sm border border-purple-200 p-4">
            <p className="text-xs text-purple-700 uppercase flex items-center gap-1">
              <Hourglass className="w-3 h-3" /> Pipeline (Awaiting Approval)
            </p>
            <p className="text-2xl font-bold text-purple-600">{workload.pipeline.total_loe.toFixed(0)}h</p>
            <p className="text-xs text-purple-600">
              {workload.pipeline.tickets.length} tickets with LOE provided
            </p>
            <div className="mt-2 text-xs text-purple-700">
              <span className="inline-block mr-3">{workload.pipeline.immediate_loe.toFixed(0)}h urgent</span>
              <span>{workload.pipeline.deferrable_loe.toFixed(0)}h regular</span>
            </div>
          </div>
          <div className="bg-slate-50 rounded-xl shadow-sm border border-slate-300 p-4">
            <p className="text-xs text-slate-700 uppercase flex items-center gap-1">
              <Target className="w-3 h-3" /> Total Future Exposure
            </p>
            <p className="text-2xl font-bold text-slate-700">{workload.total_future_hours.toFixed(0)}h</p>
            <p className="text-xs text-slate-600">
              committed + pipeline hours
            </p>
            <div className="mt-2 text-xs text-slate-700">
              {workload.total_future_hours > 0 && (
                <span>≈ {(workload.total_future_hours / 100).toFixed(1)} months of capacity</span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Committed & Pipeline Details */}
      {workload && (workload.committed.tickets.length > 0 || workload.pipeline.tickets.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Committed Work */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div 
              className="px-4 py-3 border-b bg-amber-50 flex items-center justify-between cursor-pointer hover:bg-amber-100"
              onClick={() => toggleSection('committed')}
            >
              <h2 className="text-md font-semibold text-amber-800 flex items-center gap-2">
                <PlayCircle className="w-4 h-4" />
                Committed Work ({workload.committed.tickets.length})
              </h2>
              {expandedSections.has('committed') ? (
                <ChevronDown className="w-4 h-4 text-amber-600" />
              ) : (
                <ChevronRight className="w-4 h-4 text-amber-600" />
              )}
            </div>
            {expandedSections.has('committed') && (
              <div className="max-h-64 overflow-y-auto">
                {workload.committed.tickets.length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-500 text-sm">
                    No approved tickets with remaining LOE
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-xs text-gray-500 uppercase">
                        <th className="px-3 py-2 text-left">Ticket</th>
                        <th className="px-3 py-2 text-right">LOE</th>
                        <th className="px-3 py-2 text-right">Burnt</th>
                        <th className="px-3 py-2 text-right">Remaining</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {workload.committed.tickets.map(t => (
                        <tr key={t.key} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <a
                              href={`https://drivestream.atlassian.net/browse/${t.key}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-primary hover:underline flex items-center gap-1"
                            >
                              {t.key}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <div className="text-xs text-gray-500 truncate max-w-[200px]" title={t.summary}>
                              {t.summary}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-gray-600">{t.loe_hours}h</td>
                          <td className="px-3 py-2 text-right text-green-600">{t.burnt_hours.toFixed(1)}h</td>
                          <td className="px-3 py-2 text-right font-medium text-amber-600">{t.remaining_hours.toFixed(1)}h</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>

          {/* Pipeline Work */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div 
              className="px-4 py-3 border-b bg-purple-50 flex items-center justify-between cursor-pointer hover:bg-purple-100"
              onClick={() => toggleSection('pipeline')}
            >
              <h2 className="text-md font-semibold text-purple-800 flex items-center gap-2">
                <Hourglass className="w-4 h-4" />
                Pipeline - Awaiting Approval ({workload.pipeline.tickets.length})
              </h2>
              {expandedSections.has('pipeline') ? (
                <ChevronDown className="w-4 h-4 text-purple-600" />
              ) : (
                <ChevronRight className="w-4 h-4 text-purple-600" />
              )}
            </div>
            {expandedSections.has('pipeline') && (
              <div className="max-h-64 overflow-y-auto">
                {workload.pipeline.tickets.length === 0 ? (
                  <div className="px-4 py-6 text-center text-gray-500 text-sm">
                    No tickets awaiting LOE approval
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-xs text-gray-500 uppercase">
                        <th className="px-3 py-2 text-left">Ticket</th>
                        <th className="px-3 py-2 text-left">Priority</th>
                        <th className="px-3 py-2 text-right">LOE</th>
                        <th className="px-3 py-2 text-right">Waiting</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {workload.pipeline.tickets.map(t => (
                        <tr key={t.key} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <a
                              href={`https://drivestream.atlassian.net/browse/${t.key}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-xs text-primary hover:underline flex items-center gap-1"
                            >
                              {t.key}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                            <div className="text-xs text-gray-500 truncate max-w-[200px]" title={t.summary}>
                              {t.summary}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`px-2 py-0.5 text-xs rounded-full ${
                              t.is_immediate 
                                ? 'bg-red-100 text-red-700' 
                                : 'bg-gray-100 text-gray-700'
                            }`}>
                              {t.priority || 'None'}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-purple-600">{t.loe_hours}h</td>
                          <td className="px-3 py-2 text-right text-gray-500">{t.days_waiting}d</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Timeline View */}
      <div className="bg-white rounded-xl shadow-sm border p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Timeline</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => scrollTimeline('past')}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-600"
              title="View earlier months"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={() => setStartOffset(-3)}
              className="px-3 py-1 text-sm hover:bg-gray-100 rounded-lg text-gray-600"
            >
              Today
            </button>
            <button
              onClick={() => scrollTimeline('future')}
              disabled={startOffset >= 0}
              className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 disabled:opacity-30"
              title="View later months"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="flex gap-2 min-w-max pb-2">
            {forecast.months.slice(0, 15).map(month => {
              const isOverCapacity = month.scheduled_hours > month.allocated_hours;
              const now = new Date();
              const isCurrentMonth = month.year === now.getFullYear() && month.month === now.getMonth() + 1;
              
              return (
                <div
                  key={`${month.year}-${month.month}`}
                  className={`w-24 flex-shrink-0 ${isCurrentMonth ? 'ring-2 ring-primary ring-offset-2 rounded-lg' : ''}`}
                >
                  <div className={`text-xs text-center mb-1 ${month.is_historical ? 'text-gray-400' : 'text-gray-500'}`}>
                    {formatMonth(month.year, month.month)}
                    {month.is_historical && <span className="ml-1 text-[10px]">(past)</span>}
                  </div>
                  <div className={`h-20 rounded-lg relative overflow-hidden ${
                    month.is_historical 
                      ? 'bg-gray-100 border border-dashed border-gray-300' 
                      : getProgressBarClass(month.scheduled_hours, month.allocated_hours)
                  }`}>
                    {/* Immediate hours (red for future, gray-red for past) */}
                    {month.immediate_hours > 0 && (
                      <div
                        className={`absolute bottom-0 left-0 right-0 ${month.is_historical ? 'bg-red-300' : 'bg-red-400'}`}
                        style={{ height: `${Math.min(100, (month.immediate_hours / month.allocated_hours) * 100)}%` }}
                      />
                    )}
                    {/* Deferrable hours (blue for future, gray-blue for past) */}
                    {month.deferrable_hours > 0 && (
                      <div
                        className={`absolute left-0 right-0 ${month.is_historical ? 'bg-blue-300' : 'bg-blue-400'}`}
                        style={{
                          bottom: `${Math.min(100, (month.immediate_hours / month.allocated_hours) * 100)}%`,
                          height: `${Math.min(100, (month.deferrable_hours / month.allocated_hours) * 100)}%`,
                        }}
                      />
                    )}
                    {/* Over capacity indicator */}
                    {isOverCapacity && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <AlertCircle className="w-5 h-5 text-red-600" />
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-center mt-1">
                    <span className={isOverCapacity ? 'text-red-600 font-medium' : 'text-gray-600'}>
                      {month.scheduled_hours.toFixed(0)}/{month.allocated_hours}h
                    </span>
                  </div>
                  <div className="text-xs text-center text-gray-400">
                    {month.tickets.length} tickets
                  </div>
                </div>
              );
            })}
            {forecast.months.length > 15 && (
              <div className="w-24 flex-shrink-0 flex items-center justify-center text-gray-400 text-sm">
                +{forecast.months.length - 15} more
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-4 mt-3 text-xs text-gray-500">
          <span><span className="inline-block w-3 h-3 bg-red-400 rounded mr-1"></span>Immediate (P1/P2/Payroll)</span>
          <span><span className="inline-block w-3 h-3 bg-blue-400 rounded mr-1"></span>Deferrable / Regular</span>
          <span><span className="inline-block w-3 h-3 bg-gray-200 rounded mr-1"></span>Available</span>
          <span><span className="inline-block w-3 h-3 bg-gray-100 border border-dashed border-gray-300 rounded mr-1"></span>Historical (actual)</span>
        </div>
      </div>

      {/* Monthly Breakdown Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-4 py-3 border-b bg-gray-50">
          <h2 className="text-lg font-semibold">Monthly Breakdown</h2>
        </div>
        <div className="divide-y">
          {forecast.months.map(month => {
            const key = `${month.year}-${month.month}`;
            const isExpanded = expandedMonths.has(key);
            const isOverCapacity = month.scheduled_hours > month.allocated_hours;
            
            return (
              <div key={key}>
                {/* Month Header Row */}
                <div
                  className={`flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-gray-50 ${
                    isOverCapacity ? 'bg-red-50' : ''
                  } ${month.is_historical ? 'bg-gray-50/50' : ''}`}
                  onClick={() => toggleMonth(month.year, month.month)}
                >
                  <button className="p-1">
                    {isExpanded ? (
                      <ChevronDown className="w-4 h-4 text-gray-500" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-gray-500" />
                    )}
                  </button>
                  <div className="flex-1">
                    <div className="font-medium flex items-center gap-2">
                      {formatMonthLong(month.year, month.month)}
                      {month.is_historical && (
                        <span className="text-xs px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">Historical</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      {month.tickets.length} tickets
                      {month.is_historical && ' worked'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1">
                      {month.immediate_hours > 0 && (
                        <span className="text-sm text-red-600">{month.immediate_hours.toFixed(0)}h imm</span>
                      )}
                      {month.immediate_hours > 0 && month.deferrable_hours > 0 && (
                        <span className="text-gray-400">+</span>
                      )}
                      {month.deferrable_hours > 0 && (
                        <span className="text-sm text-blue-600">{month.deferrable_hours.toFixed(0)}h {month.is_historical ? 'other' : 'def'}</span>
                      )}
                    </div>
                    <div className={`text-sm ${isOverCapacity ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                      {month.scheduled_hours.toFixed(0)} / {month.allocated_hours}h
                      {month.is_historical && ' actual'}
                    </div>
                  </div>
                  <div className="w-32">
                    <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${month.is_historical ? 'bg-gray-400' : getCapacityColor(month.scheduled_hours, month.allocated_hours)}`}
                        style={{ width: `${Math.min(100, (month.scheduled_hours / month.allocated_hours) * 100)}%` }}
                      />
                    </div>
                    <div className="text-xs text-right text-gray-500 mt-0.5">
                      {month.is_historical 
                        ? `${((month.scheduled_hours / month.allocated_hours) * 100).toFixed(0)}% used`
                        : month.remaining_capacity > 0
                          ? `${month.remaining_capacity.toFixed(0)}h available`
                          : `${Math.abs(month.remaining_capacity).toFixed(0)}h over`}
                    </div>
                  </div>
                </div>

                {/* Expanded Ticket List */}
                {isExpanded && (
                  <div className="bg-gray-50 border-t">
                    {month.tickets.length === 0 ? (
                      <div className="px-4 py-8 text-center text-gray-500">
                        {month.is_historical 
                          ? 'No hours recorded for this month'
                          : 'No tickets scheduled for this month'}
                      </div>
                    ) : (
                      <table className="w-full">
                        <thead>
                          <tr className="text-xs text-gray-500 uppercase">
                            <th className="px-4 py-2 text-left">Key</th>
                            <th className="px-4 py-2 text-left">Summary</th>
                            <th className="px-4 py-2 text-left">Priority</th>
                            <th className="px-4 py-2 text-left">Type</th>
                            <th className="px-4 py-2 text-right">{month.is_historical ? 'Actual Hours' : 'Hours'}</th>
                            {!month.is_historical && <th className="px-4 py-2 text-right">Actions</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {month.tickets.map(ticket => (
                            <tr key={ticket.key} className="hover:bg-white">
                              <td className="px-4 py-2">
                                <a
                                  href={`https://drivestream.atlassian.net/browse/${ticket.key}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono text-sm text-primary hover:underline flex items-center gap-1"
                                >
                                  {ticket.key}
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </td>
                              <td className="px-4 py-2">
                                <div className="max-w-sm truncate text-sm" title={ticket.summary}>
                                  {ticket.summary}
                                </div>
                                {ticket.notes && (
                                  <div className="text-xs text-gray-500 truncate" title={ticket.notes}>
                                    Note: {ticket.notes}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-2">
                                <span className={`px-2 py-1 text-xs rounded-full ${getPriorityBadgeColor(ticket.priority, ticket.is_immediate)}`}>
                                  {ticket.priority || 'None'}
                                </span>
                              </td>
                              <td className="px-4 py-2">
                                {month.is_historical ? (
                                  <span className="text-xs text-gray-500">Completed</span>
                                ) : ticket.is_immediate ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-red-600">
                                    <Zap className="w-3 h-3" /> Immediate
                                  </span>
                                ) : (
                                  <span className="text-xs text-blue-600">
                                    {ticket.auto_scheduled ? 'Auto-scheduled' : 'Manual'}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2 text-right text-sm">
                                {month.is_historical 
                                  ? (ticket.actual_hours ?? 0).toFixed(1)
                                  : (ticket.scheduled_hours ?? ticket.loe_hours ?? 0).toFixed(1)}h
                              </td>
                              {!month.is_historical && (
                                <td className="px-4 py-2 text-right">
                                  {!ticket.is_immediate && (
                                    <button
                                      onClick={e => {
                                        e.stopPropagation();
                                        setScheduleModal({
                                          ticket,
                                          month: { year: month.year, month: month.month },
                                        });
                                      }}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded"
                                    >
                                      <MoveRight className="w-3 h-3" /> Move
                                    </button>
                                  )}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Schedule Modal */}
      {scheduleModal && (
        <ScheduleModal
          ticket={scheduleModal.ticket}
          currentMonth={scheduleModal.month}
          onClose={() => setScheduleModal(null)}
          onSchedule={handleScheduleTicket}
          availableMonths={availableMonths}
        />
      )}
    </div>
  );
}
