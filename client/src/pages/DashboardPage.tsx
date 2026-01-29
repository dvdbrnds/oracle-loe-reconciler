import { useState, useEffect, useCallback } from 'react';
import { api, BudgetOverview } from '../services/api';
import { AlertTriangle, TrendingUp, Clock, Target, Ticket, CheckCircle, FileText, Info, Calendar, ChevronDown } from 'lucide-react';
import { InfoTooltip } from '../components/ui/tooltip';

const STATUS_COLORS: Record<string, string> = {
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
};

interface PeriodsResponse {
  periods: Array<{ year: number; month: number }>;
  years: number[];
  currentPeriod: { year: number; month: number };
}

interface PeriodFilter {
  type: 'month' | 'year' | 'all';
  year?: number;
  month?: number;
}

function buildPeriodQuery(filter: PeriodFilter): string {
  if (filter.type === 'all') {
    return '?period=all';
  }
  if (filter.type === 'year' && filter.year) {
    return `?year=${filter.year}&period=year`;
  }
  if (filter.type === 'month' && filter.year && filter.month) {
    return `?year=${filter.year}&month=${filter.month}`;
  }
  return '';
}

function formatPeriodLabel(filter: PeriodFilter): string {
  if (filter.type === 'all') {
    return 'All Time';
  }
  if (filter.type === 'year' && filter.year) {
    return `${filter.year}`;
  }
  if (filter.type === 'month' && filter.year && filter.month) {
    return new Date(filter.year, filter.month - 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }
  return 'Current Month';
}

interface TicketOverview {
  totals: {
    total_tickets: number;
    open_tickets: number;
    total_loe_hours: number;
    tickets_with_loe: number;
  };
  productionTotals: {
    total_tickets: number;
    open_tickets: number;
    total_loe_hours: number;
    tickets_with_loe: number;
  };
  byApplication: Array<{
    application: string;
    count: number;
    open_count: number;
    total_loe_hours: number;
  }>;
  byPhase: Array<{
    phase: string;
    project_key: string;
    project_name: string;
    count: number;
    open_count: number;
    total_loe_hours: number;
    tickets_with_loe: number;
  }>;
  productionLoe: Array<{
    application: string;
    phase: string;
    tickets: number;
    open_tickets: number;
    loe_hours: number;
    with_loe: number;
  }>;
  byStatus: Array<{ status: string; count: number }>;
  recentTickets: Array<{
    key: string;
    summary: string;
    application: string;
    status: string;
    priority: string;
    loe_hours: number;
    phase: string;
    updated_at: string;
  }>;
}

export function DashboardPage() {
  const [budget, setBudget] = useState<BudgetOverview | null>(null);
  const [ticketOverview, setTicketOverview] = useState<TicketOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [periods, setPeriods] = useState<PeriodsResponse | null>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>({ type: 'month' });
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);

  // Fetch available periods on mount
  useEffect(() => {
    async function fetchPeriods() {
      try {
        const periodsData = await api.get<PeriodsResponse>('/dashboard/periods');
        setPeriods(periodsData);
        // Set initial filter to current month
        if (periodsData.currentPeriod) {
          setPeriodFilter({
            type: 'month',
            year: periodsData.currentPeriod.year,
            month: periodsData.currentPeriod.month,
          });
        }
      } catch (error) {
        console.error('Failed to fetch periods:', error);
      }
    }
    fetchPeriods();
  }, []);

  // Fetch dashboard data when period filter changes
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildPeriodQuery(periodFilter);
      const [budgetData, ticketData] = await Promise.all([
        api.get<BudgetOverview>(`/dashboard/budget-overview${query}`),
        api.get<TicketOverview>('/dashboard/ticket-overview'),
      ]);
      setBudget(budgetData);
      setTicketOverview(ticketData);
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  }, [periodFilter]);

  useEffect(() => {
    if (periodFilter.type === 'month' && periodFilter.year && periodFilter.month) {
      fetchData();
    } else if (periodFilter.type === 'all' || periodFilter.type === 'year') {
      fetchData();
    }
  }, [periodFilter, fetchData]);

  if (loading && !budget) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  const periodLabel = formatPeriodLabel(periodFilter);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">{periodLabel} Budget Overview</p>
        </div>
        
        {/* Period Selector */}
        <div className="relative">
          <button
            onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
            className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <Calendar className="w-4 h-4 text-gray-500" />
            <span className="font-medium">{periodLabel}</span>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showPeriodDropdown ? 'rotate-180' : ''}`} />
          </button>
          
          {showPeriodDropdown && (
            <div className="absolute right-0 mt-2 w-64 bg-white border rounded-lg shadow-lg z-50 max-h-96 overflow-auto">
              {/* All Time Option */}
              <button
                onClick={() => {
                  setPeriodFilter({ type: 'all' });
                  setShowPeriodDropdown(false);
                }}
                className={`w-full px-4 py-2 text-left hover:bg-gray-100 ${periodFilter.type === 'all' ? 'bg-blue-50 text-blue-700' : ''}`}
              >
                All Time
              </button>
              
              <div className="border-t my-1" />
              
              {/* Years */}
              {periods?.years.map((year) => (
                <div key={year}>
                  <button
                    onClick={() => {
                      setPeriodFilter({ type: 'year', year });
                      setShowPeriodDropdown(false);
                    }}
                    className={`w-full px-4 py-2 text-left font-semibold hover:bg-gray-100 ${
                      periodFilter.type === 'year' && periodFilter.year === year ? 'bg-blue-50 text-blue-700' : ''
                    }`}
                  >
                    {year}
                  </button>
                  
                  {/* Months within year */}
                  <div className="pl-4">
                    {periods?.periods
                      .filter((p) => p.year === year)
                      .map((p) => (
                        <button
                          key={`${p.year}-${p.month}`}
                          onClick={() => {
                            setPeriodFilter({ type: 'month', year: p.year, month: p.month });
                            setShowPeriodDropdown(false);
                          }}
                          className={`w-full px-4 py-1.5 text-left text-sm hover:bg-gray-100 ${
                            periodFilter.type === 'month' && periodFilter.year === p.year && periodFilter.month === p.month
                              ? 'bg-blue-50 text-blue-700'
                              : ''
                          }`}
                        >
                          {new Date(p.year, p.month - 1).toLocaleDateString('en-US', { month: 'long' })}
                        </button>
                      ))}
                  </div>
                </div>
              ))}

              {/* If no periods available, show current month option */}
              {(!periods?.periods || periods.periods.length === 0) && (
                <div className="px-4 py-2 text-gray-500 text-sm">
                  No data available yet. Import burnt hours to see periods.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      
      {/* Click outside to close dropdown */}
      {showPeriodDropdown && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setShowPeriodDropdown(false)}
        />
      )}

      {budget?.isExhausted && (
        <div className="bg-red-600 text-white rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 flex-shrink-0" />
          <div>
            <p className="font-semibold">BUDGET EXHAUSTED</p>
            <p className="text-sm text-red-100">
              Only Critical (P1), High (P2), and Payroll tickets are eligible for work.
            </p>
          </div>
        </div>
      )}

      {/* Budget Progress - Stacked Bar */}
      {budget && (
        <InfoTooltip
          content={
            <div className="space-y-2">
              <p className="font-semibold text-gray-900">Budget Progress Tracker</p>
              <p>Visual representation of budget consumption {periodFilter.type === 'all' ? 'across all time' : 'for the selected period'}.</p>
              {periodFilter.type === 'month' && (
                <p className="text-sm text-gray-600">
                  Hours are attributed to months based on when tickets were LOE Approved.
                </p>
              )}
              {budget.workTypeBreakdown && (
                <div className="text-sm space-y-1 pt-2 border-t">
                  <p className="font-medium">Work Type Breakdown:</p>
                  <p><span className="inline-block w-3 h-3 bg-red-500 rounded mr-2"></span>Urgent (P1/P2): {budget.workTypeBreakdown.urgent}h</p>
                  <p><span className="inline-block w-3 h-3 bg-purple-500 rounded mr-2"></span>Payroll: {budget.workTypeBreakdown.payroll}h</p>
                  <p><span className="inline-block w-3 h-3 bg-blue-500 rounded mr-2"></span>Regular: {budget.workTypeBreakdown.regular}h</p>
                  <p><span className="inline-block w-3 h-3 bg-gray-400 rounded mr-2"></span>Admin: {budget.workTypeBreakdown.admin}h</p>
                </div>
              )}
            </div>
          }
          side="bottom"
        >
          <div className="bg-white rounded-xl shadow-sm border p-6 cursor-help">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                Budget Progress <Info className="w-4 h-4 opacity-40" />
              </h2>
              <span className="text-sm text-gray-600">
                {budget.totalBurnt.toFixed(1)} / {budget.allocatedHours} hours
              </span>
            </div>
            {/* Only show day markers for current month */}
            {periodFilter.type === 'month' && 
             periodFilter.year === new Date().getFullYear() && 
             periodFilter.month === new Date().getMonth() + 1 && (() => {
              const now = new Date();
              const currentDay = now.getDate();
              const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
              const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
              
              return (
                <div className="flex justify-between mb-2">
                  {days.map((day) => (
                    <span
                      key={day}
                      className={`text-[10px] w-5 text-center ${
                        day === currentDay
                          ? 'font-bold text-blue-600 bg-blue-100 rounded px-0.5'
                          : 'text-gray-400'
                      }`}
                    >
                      {day}
                    </span>
                  ))}
                </div>
              );
            })()}
            
            {/* Stacked Progress Bar */}
            <div className="h-6 bg-gray-200 rounded-full overflow-hidden flex">
              {budget.workTypeBreakdown && budget.allocatedHours > 0 ? (
                <>
                  {/* Urgent (P1/P2) - Red */}
                  {budget.workTypeBreakdown.urgent > 0 && (
                    <div
                      className="bg-red-500 h-full transition-all duration-500 relative group"
                      style={{ width: `${(budget.workTypeBreakdown.urgent / budget.allocatedHours) * 100}%` }}
                      title={`Urgent (P1/P2): ${budget.workTypeBreakdown.urgent}h`}
                    />
                  )}
                  {/* Payroll - Purple */}
                  {budget.workTypeBreakdown.payroll > 0 && (
                    <div
                      className="bg-purple-500 h-full transition-all duration-500"
                      style={{ width: `${(budget.workTypeBreakdown.payroll / budget.allocatedHours) * 100}%` }}
                      title={`Payroll: ${budget.workTypeBreakdown.payroll}h`}
                    />
                  )}
                  {/* Regular - Blue */}
                  {budget.workTypeBreakdown.regular > 0 && (
                    <div
                      className="bg-blue-500 h-full transition-all duration-500"
                      style={{ width: `${(budget.workTypeBreakdown.regular / budget.allocatedHours) * 100}%` }}
                      title={`Regular: ${budget.workTypeBreakdown.regular}h`}
                    />
                  )}
                  {/* Admin - Gray */}
                  {budget.workTypeBreakdown.admin > 0 && (
                    <div
                      className="bg-gray-400 h-full transition-all duration-500"
                      style={{ width: `${(budget.workTypeBreakdown.admin / budget.allocatedHours) * 100}%` }}
                      title={`Admin/Overhead: ${budget.workTypeBreakdown.admin}h`}
                    />
                  )}
                </>
              ) : (
                // Fallback to simple progress bar if no breakdown available
                <div
                  className={`h-full transition-all duration-500 ${STATUS_COLORS[budget.status || 'green']}`}
                  style={{ width: `${Math.min(100, budget.burnPercent || 0)}%` }}
                />
              )}
            </div>
            
            {/* Legend */}
            {budget.workTypeBreakdown && (
              <div className="flex flex-wrap gap-4 mt-3 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-red-500 rounded"></span>
                  <span className="text-gray-600">Urgent (P1/P2)</span>
                  <span className="font-semibold">{budget.workTypeBreakdown.urgent}h</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-purple-500 rounded"></span>
                  <span className="text-gray-600">Payroll</span>
                  <span className="font-semibold">{budget.workTypeBreakdown.payroll}h</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-blue-500 rounded"></span>
                  <span className="text-gray-600">Regular</span>
                  <span className="font-semibold">{budget.workTypeBreakdown.regular}h</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 bg-gray-400 rounded"></span>
                  <span className="text-gray-600">Admin</span>
                  <span className="font-semibold">{budget.workTypeBreakdown.admin}h</span>
                </span>
              </div>
            )}
            
            {/* Percentage markers */}
            <div className="flex justify-between mt-2 text-xs text-gray-500">
              <span>0%</span>
              <span className="text-yellow-600">50%</span>
              <span className="text-orange-600">75%</span>
              <span className="text-red-600">90%</span>
              <span>100%</span>
            </div>
          </div>
        </InfoTooltip>
      )}

      {/* Production Support Stats */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-lg p-6 text-white">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Target className="w-5 h-5" />
          Production Support (HCM/ERP)
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-blue-200 text-sm">Open Tickets</p>
            <p className="text-3xl font-bold">{ticketOverview?.productionTotals.open_tickets.toLocaleString() || 0}</p>
          </div>
          <div>
            <p className="text-blue-200 text-sm">Total LOE Hours</p>
            <p className="text-3xl font-bold">{ticketOverview?.productionTotals.total_loe_hours.toFixed(0) || 0}</p>
          </div>
          <div>
            <p className="text-blue-200 text-sm">Tickets with LOE</p>
            <p className="text-3xl font-bold">{ticketOverview?.productionTotals.tickets_with_loe.toLocaleString() || 0}</p>
          </div>
          <div>
            <p className="text-blue-200 text-sm">Total Tickets</p>
            <p className="text-3xl font-bold">{ticketOverview?.productionTotals.total_tickets.toLocaleString() || 0}</p>
          </div>
        </div>
      </div>

      {/* All Projects Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Ticket className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">All Tickets</p>
              <p className="text-2xl font-bold">{ticketOverview?.totals.total_tickets.toLocaleString() || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">All Open</p>
              <p className="text-2xl font-bold">{ticketOverview?.totals.open_tickets.toLocaleString() || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg">
              <FileText className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Total LOE Hours</p>
              <p className="text-2xl font-bold">{ticketOverview?.totals.total_loe_hours.toFixed(0) || 0}</p>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <CheckCircle className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">With LOE Estimate</p>
              <p className="text-2xl font-bold">{ticketOverview?.totals.tickets_with_loe.toLocaleString() || 0}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Budget Stats */}
      {budget && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <TrendingUp className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Hours Burnt</p>
                <p className="text-2xl font-bold">{budget.totalBurnt.toFixed(1)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Target className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Remaining</p>
                <p className="text-2xl font-bold">{budget.remaining.toFixed(1)}</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <Clock className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">
                  {budget.burnRate !== null ? 'Burn Rate' : 'Period'}
                </p>
                <p className="text-2xl font-bold">
                  {budget.burnRate !== null ? `${budget.burnRate.toFixed(1)}/day` : periodFilter.type === 'all' ? 'All Time' : 'Historical'}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-600">Admin/Overhead</p>
                <p className="text-2xl font-bold">{budget.adminOverhead.toFixed(1)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LOE Breakdown */}
      {budget?.loeBreakdown && (budget.loeBreakdown.hoursWithLoe > 0 || budget.loeBreakdown.hoursApprovedNoLoe > 0 || budget.loeBreakdown.hoursUrgent > 0 || budget.loeBreakdown.hoursUnapproved > 0) && (
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <FileText className="w-5 h-5 text-gray-500" />
            Hours Breakdown by LOE Status
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-green-50 rounded-lg p-4 border border-green-200">
              <p className="text-sm text-green-700 font-medium">With LOE Estimate</p>
              <p className="text-2xl font-bold text-green-800">{budget.loeBreakdown.hoursWithLoe}</p>
              <p className="text-xs text-green-600 mt-1">Approved with estimate</p>
            </div>
            <div className="bg-yellow-50 rounded-lg p-4 border border-yellow-200">
              <p className="text-sm text-yellow-700 font-medium">Approved - No LOE</p>
              <p className="text-2xl font-bold text-yellow-800">{budget.loeBreakdown.hoursApprovedNoLoe}</p>
              <p className="text-xs text-yellow-600 mt-1">Approved without estimate</p>
            </div>
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
              <p className="text-sm text-blue-700 font-medium">Urgent Work</p>
              <p className="text-2xl font-bold text-blue-800">{budget.loeBreakdown.hoursUrgent}</p>
              <p className="text-xs text-blue-600 mt-1">P1/P2/Payroll (allowed)</p>
            </div>
            <div className="bg-red-50 rounded-lg p-4 border border-red-200">
              <p className="text-sm text-red-700 font-medium">Unapproved Work</p>
              <p className="text-2xl font-bold text-red-800">{budget.loeBreakdown.hoursUnapproved}</p>
              <p className="text-xs text-red-600 mt-1">Non-urgent, no approval</p>
            </div>
          </div>
          {/* Visual bar showing breakdown */}
          <div className="mt-4">
            <div className="h-4 bg-gray-200 rounded-full overflow-hidden flex">
              {budget.totalBurnt > 0 && (
                <>
                  <div
                    className="bg-green-500 h-full"
                    style={{ width: `${(budget.loeBreakdown.hoursWithLoe / budget.totalBurnt) * 100}%` }}
                    title={`With LOE: ${budget.loeBreakdown.hoursWithLoe}h`}
                  />
                  <div
                    className="bg-yellow-500 h-full"
                    style={{ width: `${(budget.loeBreakdown.hoursApprovedNoLoe / budget.totalBurnt) * 100}%` }}
                    title={`Approved No LOE: ${budget.loeBreakdown.hoursApprovedNoLoe}h`}
                  />
                  <div
                    className="bg-blue-500 h-full"
                    style={{ width: `${(budget.loeBreakdown.hoursUrgent / budget.totalBurnt) * 100}%` }}
                    title={`Urgent: ${budget.loeBreakdown.hoursUrgent}h`}
                  />
                  <div
                    className="bg-red-500 h-full"
                    style={{ width: `${(budget.loeBreakdown.hoursUnapproved / budget.totalBurnt) * 100}%` }}
                    title={`Unapproved: ${budget.loeBreakdown.hoursUnapproved}h`}
                  />
                </>
              )}
            </div>
            <div className="flex flex-wrap justify-between mt-1 text-xs text-gray-500 gap-2">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span> With LOE
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-yellow-500 rounded-full"></span> Approved No LOE
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-blue-500 rounded-full"></span> Urgent
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 bg-red-500 rounded-full"></span> Unapproved
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Recent Tickets */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Recently Updated Tickets</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Summary</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">LOE</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ticketOverview?.recentTickets.map((ticket) => (
                <tr key={ticket.key} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <a
                      href={`https://drivestream.atlassian.net/browse/${ticket.key}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline font-medium"
                    >
                      {ticket.key}
                    </a>
                  </td>
                  <td className="px-6 py-4 max-w-md truncate" title={ticket.summary}>
                    {ticket.summary}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 text-xs font-medium rounded ${
                      ticket.status === 'Closed' || ticket.status === 'Done'
                        ? 'bg-green-100 text-green-800'
                        : ticket.status === 'In Progress'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {ticket.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right">
                    {ticket.loe_hours ? `${ticket.loe_hours}h` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
