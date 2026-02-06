import { useState, useEffect, useCallback } from 'react';
import { api, BudgetOverview, Ticket, TicketsResponse } from '../services/api';
import { 
  AlertTriangle, TrendingUp, Clock, Target, Search, 
  ChevronLeft, ChevronRight, Calendar, ChevronDown, 
  Filter, AlertCircle, Info
} from 'lucide-react';
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

interface WaitingOnVendorSummary {
  notStartedCount: number;
  stalledCount: number;
  criticalCount: number;
  warningCount: number;
  totalLoeHoursWaiting: number;
}

interface ComplianceSummary {
  waitingOnVendor: WaitingOnVendorSummary;
  unapprovedHours: number;
  unapprovedCount: number;
}

type QuickFilter = 'all' | 'waiting' | 'stalled' | 'unapproved' | 'urgent';

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

export function DashboardPage() {
  const [budget, setBudget] = useState<BudgetOverview | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [periods, setPeriods] = useState<PeriodsResponse | null>(null);
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>({ type: 'month' });
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false);
  const [complianceSummary, setComplianceSummary] = useState<ComplianceSummary | null>(null);
  
  // Ticket filters
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filterOptions, setFilterOptions] = useState<any>(null);
  const [filters, setFilters] = useState({
    application: '',
    status: '',
    priority: '',
  });

  // Fetch available periods on mount
  useEffect(() => {
    async function fetchInitialData() {
      try {
        const [periodsData, filterData] = await Promise.all([
          api.get<PeriodsResponse>('/dashboard/periods'),
          api.get('/tickets/meta/filters'),
        ]);
        setPeriods(periodsData);
        setFilterOptions(filterData);
        if (periodsData.currentPeriod) {
          setPeriodFilter({
            type: 'month',
            year: periodsData.currentPeriod.year,
            month: periodsData.currentPeriod.month,
          });
        }
      } catch (error) {
        console.error('Failed to fetch initial data:', error);
      }
    }
    fetchInitialData();
  }, []);

  // Fetch budget data when period filter changes
  const fetchBudgetData = useCallback(async () => {
    setLoading(true);
    try {
      const query = buildPeriodQuery(periodFilter);
      const [budgetData, waitingData, unapprovedData] = await Promise.all([
        api.get<BudgetOverview>(`/dashboard/budget-overview${query}`),
        api.get<{ summary: WaitingOnVendorSummary }>('/compliance/waiting-on-vendor'),
        api.get<{ summary: { totalHours: number; ticketCount: number } }>('/compliance/unapproved-loe'),
      ]);
      setBudget(budgetData);
      setComplianceSummary({
        waitingOnVendor: waitingData.summary,
        unapprovedHours: unapprovedData.summary.totalHours,
        unapprovedCount: unapprovedData.summary.ticketCount,
      });
    } catch (error) {
      console.error('Failed to fetch budget data:', error);
    } finally {
      setLoading(false);
    }
  }, [periodFilter]);

  useEffect(() => {
    if (periodFilter.type === 'month' && periodFilter.year && periodFilter.month) {
      fetchBudgetData();
    } else if (periodFilter.type === 'all' || periodFilter.type === 'year') {
      fetchBudgetData();
    }
  }, [periodFilter, fetchBudgetData]);

  // Fetch tickets
  const fetchTickets = useCallback(async () => {
    setTicketsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(pagination.page));
      params.set('limit', '25');
      
      if (filters.application) params.set('application', filters.application);
      if (filters.status) params.set('status', filters.status);
      if (filters.priority) params.set('priority', filters.priority);
      if (searchTerm) params.set('search', searchTerm);
      
      // Quick filters modify the request
      if (quickFilter === 'urgent') {
        params.set('priority', 'High,Critical,Urgent,Highest');
      }

      const data = await api.get<TicketsResponse>(`/tickets?${params}`);
      
      // Client-side filtering for quick filters that need additional logic
      let filteredTickets = data.tickets;
      
      if (quickFilter === 'waiting') {
        filteredTickets = data.tickets.filter(t => 
          t.days_waiting_for_work !== null && t.days_waiting_for_work > 0
        );
      } else if (quickFilter === 'stalled') {
        filteredTickets = data.tickets.filter(t => 
          t.days_since_last_work !== null && t.days_since_last_work >= 14 &&
          !['Resolved', 'Closed', 'Done', 'Cancelled'].includes(t.status)
        );
      } else if (quickFilter === 'unapproved') {
        filteredTickets = data.tickets.filter(t => 
          t.has_compliance_issue
        );
      }
      
      setTickets(filteredTickets);
      setPagination(prev => ({
        ...prev,
        total: data.pagination.total,
        totalPages: data.pagination.totalPages,
      }));
    } catch (error) {
      console.error('Failed to fetch tickets:', error);
    } finally {
      setTicketsLoading(false);
    }
  }, [pagination.page, filters, searchTerm, quickFilter]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  const handleQuickFilterChange = (filter: QuickFilter) => {
    setQuickFilter(filter);
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'LOE Approved': return 'bg-green-100 text-green-800';
      case 'LOE Provided': return 'bg-yellow-100 text-yellow-800';
      case 'On Hold': return 'bg-gray-100 text-gray-800';
      case 'Resolved': case 'Closed': case 'Done': return 'bg-blue-100 text-blue-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityBadgeColor = (priority: string | null) => {
    switch (priority?.toLowerCase()) {
      case 'critical': case 'highest': case 'urgent': return 'bg-red-100 text-red-800';
      case 'high': return 'bg-orange-100 text-orange-800';
      case 'medium': case 'normal': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getAgingDisplay = (ticket: Ticket) => {
    const isClosed = ['Resolved', 'Closed', 'Done', 'Cancelled'].includes(ticket.status);
    
    // Tickets waiting for work to start (approved or urgent, no hours yet)
    if (ticket.days_waiting_for_work !== null && ticket.days_waiting_for_work >= 0) {
      const days = ticket.days_waiting_for_work;
      let colorClass = 'text-green-600 bg-green-50';
      let label = 'ready';
      if (days >= 14) { colorClass = 'text-red-600 bg-red-50'; label = 'waiting'; }
      else if (days >= 7) { colorClass = 'text-yellow-600 bg-yellow-50'; label = 'waiting'; }
      else if (days >= 1) { label = 'waiting'; }
      return (
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${colorClass}`}>
          {days}d {label}
        </span>
      );
    }
    
    // Tickets with work done
    if (ticket.days_since_last_work !== null) {
      const days = ticket.days_since_last_work;
      
      // Closed tickets - show when completed
      if (isClosed) {
        return (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-blue-600 bg-blue-50">
            {days}d ago ✓
          </span>
        );
      }
      
      // Open tickets - check if stalled
      if (days >= 14) {
        return (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-orange-600 bg-orange-50">
            {days}d stalled
          </span>
        );
      }
      
      // Active work
      if (days === 0) {
        return (
          <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-green-600 bg-green-50">
            today
          </span>
        );
      }
      
      return (
        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-gray-600 bg-gray-50">
          {days}d ago
        </span>
      );
    }

    // Fallback: use days_since_approved if available
    if (ticket.days_since_approved !== null) {
      const days = ticket.days_since_approved;
      return (
        <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-gray-500 bg-gray-50">
          {days}d old
        </span>
      );
    }

    // No timing data available
    return <span className="text-xs text-gray-400">-</span>;
  };

  const periodLabel = formatPeriodLabel(periodFilter);

  if (loading && !budget) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600">{periodLabel} Overview</p>
        </div>
        
        {/* Period Selector */}
        <div className="relative">
          <button
            onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
            className="flex items-center gap-2 px-4 py-2 bg-white border rounded-lg shadow-sm hover:bg-gray-50"
          >
            <Calendar className="w-4 h-4 text-gray-500" />
            <span className="font-medium">{periodLabel}</span>
            <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showPeriodDropdown ? 'rotate-180' : ''}`} />
          </button>
          
          {showPeriodDropdown && (
            <div className="absolute right-0 mt-2 w-64 bg-white border rounded-lg shadow-lg z-50 max-h-96 overflow-auto">
              <button
                onClick={() => { setPeriodFilter({ type: 'all' }); setShowPeriodDropdown(false); }}
                className={`w-full px-4 py-2 text-left hover:bg-gray-100 ${periodFilter.type === 'all' ? 'bg-blue-50 text-blue-700' : ''}`}
              >
                All Time
              </button>
              <div className="border-t my-1" />
              {periods?.years.map((year) => (
                <div key={year}>
                  <button
                    onClick={() => { setPeriodFilter({ type: 'year', year }); setShowPeriodDropdown(false); }}
                    className={`w-full px-4 py-2 text-left font-semibold hover:bg-gray-100 ${
                      periodFilter.type === 'year' && periodFilter.year === year ? 'bg-blue-50 text-blue-700' : ''
                    }`}
                  >
                    {year}
                  </button>
                  <div className="pl-4">
                    {periods?.periods.filter((p) => p.year === year).map((p) => (
                      <button
                        key={`${p.year}-${p.month}`}
                        onClick={() => { setPeriodFilter({ type: 'month', year: p.year, month: p.month }); setShowPeriodDropdown(false); }}
                        className={`w-full px-4 py-1.5 text-left text-sm hover:bg-gray-100 ${
                          periodFilter.type === 'month' && periodFilter.year === p.year && periodFilter.month === p.month
                            ? 'bg-blue-50 text-blue-700' : ''
                        }`}
                      >
                        {new Date(p.year, p.month - 1).toLocaleDateString('en-US', { month: 'long' })}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
      {showPeriodDropdown && <div className="fixed inset-0 z-40" onClick={() => setShowPeriodDropdown(false)} />}

      {/* Budget Exhausted Banner */}
      {budget?.isExhausted && (
        <div className="bg-red-600 text-white rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-6 h-6 flex-shrink-0" />
          <div>
            <p className="font-semibold">BUDGET EXHAUSTED</p>
            <p className="text-sm text-red-100">Only Critical (P1), High (P2), and Payroll tickets are eligible for work.</p>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 uppercase">Hours Burnt</p>
          <p className="text-2xl font-bold text-blue-600">{budget?.totalBurnt.toFixed(1) || 0}</p>
          <p className="text-xs text-gray-500">of {budget?.allocatedHours || 100}</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 uppercase">Remaining</p>
          <p className="text-2xl font-bold text-green-600">{budget?.remaining.toFixed(1) || 0}</p>
          <p className="text-xs text-gray-500">{budget?.burnPercent?.toFixed(0) || 0}% used</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 uppercase">Admin/Overhead</p>
          <p className="text-2xl font-bold text-gray-600">{budget?.adminOverhead.toFixed(1) || 0}</p>
        </div>
        <div className={`bg-white rounded-xl shadow-sm border p-4 ${(complianceSummary?.waitingOnVendor.criticalCount || 0) > 0 ? 'ring-2 ring-red-500' : ''}`}>
          <p className="text-xs text-gray-500 uppercase">Waiting on Vendor</p>
          <p className={`text-2xl font-bold ${(complianceSummary?.waitingOnVendor.criticalCount || 0) > 0 ? 'text-red-600' : 'text-amber-600'}`}>
            {(complianceSummary?.waitingOnVendor.notStartedCount || 0) + (complianceSummary?.waitingOnVendor.stalledCount || 0)}
          </p>
          <p className="text-xs text-gray-500">{complianceSummary?.waitingOnVendor.criticalCount || 0} critical</p>
        </div>
        <div className="bg-white rounded-xl shadow-sm border p-4">
          <p className="text-xs text-gray-500 uppercase">Stalled</p>
          <p className="text-2xl font-bold text-orange-600">{complianceSummary?.waitingOnVendor.stalledCount || 0}</p>
          <p className="text-xs text-gray-500">14+ days inactive</p>
        </div>
        <div className={`bg-white rounded-xl shadow-sm border p-4 ${(complianceSummary?.unapprovedCount || 0) > 0 ? 'ring-2 ring-red-500' : ''}`}>
          <p className="text-xs text-gray-500 uppercase">Unapproved Work</p>
          <p className="text-2xl font-bold text-red-600">{complianceSummary?.unapprovedHours?.toFixed(1) || 0}h</p>
          <p className="text-xs text-gray-500">{complianceSummary?.unapprovedCount || 0} tickets</p>
        </div>
      </div>

      {/* Budget Progress Bar */}
      {budget && (
        <InfoTooltip
          content={
            <div className="space-y-2">
              <p className="font-semibold">Budget Progress</p>
              {budget.workTypeBreakdown && (
                <div className="text-sm space-y-1">
                  <p><span className="inline-block w-3 h-3 bg-red-500 rounded mr-2"></span>Urgent: {budget.workTypeBreakdown.urgent}h</p>
                  <p><span className="inline-block w-3 h-3 bg-purple-500 rounded mr-2"></span>Payroll: {budget.workTypeBreakdown.payroll}h</p>
                  <p><span className="inline-block w-3 h-3 bg-blue-500 rounded mr-2"></span>Regular: {budget.workTypeBreakdown.regular}h</p>
                  <p><span className="inline-block w-3 h-3 bg-gray-400 rounded mr-2"></span>Admin: {budget.workTypeBreakdown.admin}h</p>
                </div>
              )}
            </div>
          }
          side="bottom"
        >
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium flex items-center gap-1">Budget Progress <Info className="w-3 h-3 opacity-40" /></span>
              <span className="text-sm text-gray-600">{budget.totalBurnt.toFixed(1)} / {budget.allocatedHours}h</span>
            </div>
            <div className="h-4 bg-gray-200 rounded-full overflow-hidden flex">
              {budget.workTypeBreakdown && budget.allocatedHours > 0 ? (
                <>
                  {budget.workTypeBreakdown.urgent > 0 && (
                    <div className="bg-red-500 h-full" style={{ width: `${(budget.workTypeBreakdown.urgent / budget.allocatedHours) * 100}%` }} />
                  )}
                  {budget.workTypeBreakdown.payroll > 0 && (
                    <div className="bg-purple-500 h-full" style={{ width: `${(budget.workTypeBreakdown.payroll / budget.allocatedHours) * 100}%` }} />
                  )}
                  {budget.workTypeBreakdown.regular > 0 && (
                    <div className="bg-blue-500 h-full" style={{ width: `${(budget.workTypeBreakdown.regular / budget.allocatedHours) * 100}%` }} />
                  )}
                  {budget.workTypeBreakdown.admin > 0 && (
                    <div className="bg-gray-400 h-full" style={{ width: `${(budget.workTypeBreakdown.admin / budget.allocatedHours) * 100}%` }} />
                  )}
                </>
              ) : (
                <div className={`h-full ${STATUS_COLORS[budget.status || 'green']}`} style={{ width: `${Math.min(100, budget.burnPercent || 0)}%` }} />
              )}
            </div>
            <div className="flex gap-4 mt-2 text-xs text-gray-500">
              <span><span className="inline-block w-2 h-2 bg-red-500 rounded mr-1"></span>Urgent</span>
              <span><span className="inline-block w-2 h-2 bg-purple-500 rounded mr-1"></span>Payroll</span>
              <span><span className="inline-block w-2 h-2 bg-blue-500 rounded mr-1"></span>Regular</span>
              <span><span className="inline-block w-2 h-2 bg-gray-400 rounded mr-1"></span>Admin</span>
            </div>
          </div>
        </InfoTooltip>
      )}

      {/* Quick Filters & Search */}
      <div className="bg-white rounded-xl shadow-sm border p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gray-700">View:</span>
          {[
            { id: 'all', label: 'All Tickets' },
            { id: 'waiting', label: 'Waiting on Vendor', count: complianceSummary?.waitingOnVendor.notStartedCount },
            { id: 'stalled', label: 'Stalled', count: complianceSummary?.waitingOnVendor.stalledCount },
            { id: 'unapproved', label: 'Unapproved', count: complianceSummary?.unapprovedCount },
            { id: 'urgent', label: 'Urgent (P1/P2)' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => handleQuickFilterChange(f.id as QuickFilter)}
              className={`px-3 py-1.5 text-sm rounded-full transition-colors flex items-center gap-1.5 ${
                quickFilter === f.id
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {f.label}
              {f.count !== undefined && f.count > 0 && (
                <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                  quickFilter === f.id ? 'bg-white/20' : 'bg-gray-200'
                }`}>
                  {f.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <input
              type="text"
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setPagination(p => ({ ...p, page: 1 })); }}
              placeholder="Search by ticket key or summary..."
              className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50 ${showFilters ? 'bg-gray-100' : ''}`}
          >
            <Filter size={18} />
            Filters
          </button>
        </div>

        {showFilters && filterOptions && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
            <select
              value={filters.application}
              onChange={e => { setFilters(f => ({ ...f, application: e.target.value })); setPagination(p => ({ ...p, page: 1 })); }}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="">All Applications</option>
              {filterOptions.applications?.map((app: any) => (
                <option key={app.code} value={app.code}>{app.name}</option>
              ))}
            </select>
            <select
              value={filters.status}
              onChange={e => { setFilters(f => ({ ...f, status: e.target.value })); setPagination(p => ({ ...p, page: 1 })); }}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="">All Statuses</option>
              {filterOptions.statuses?.map((s: string) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={filters.priority}
              onChange={e => { setFilters(f => ({ ...f, priority: e.target.value })); setPagination(p => ({ ...p, page: 1 })); }}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="">All Priorities</option>
              {filterOptions.priorities?.map((p: string) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Tickets Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {ticketsLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Key</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Summary</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Aging</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">LOE</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Burnt</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tickets.map(ticket => (
                    <tr key={ticket.key} className={`hover:bg-gray-50 ${ticket.has_compliance_issue ? 'bg-red-50/50' : ''}`}>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {ticket.has_compliance_issue && <AlertCircle className="w-4 h-4 text-red-500" />}
                          <a
                            href={`https://drivestream.atlassian.net/browse/${ticket.key}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-sm text-primary hover:underline"
                          >
                            {ticket.key}
                          </a>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-md truncate text-sm" title={ticket.summary}>{ticket.summary}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">{ticket.application_name || ticket.application || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs rounded-full ${getPriorityBadgeColor(ticket.priority)}`}>
                          {ticket.priority || 'None'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs rounded-full ${getStatusBadgeColor(ticket.status)}`}>
                          {ticket.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-center">{getAgingDisplay(ticket)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right text-sm">{ticket.loe_hours?.toFixed(1) || '-'}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">{ticket.hours_burnt.toFixed(1)}</td>
                    </tr>
                  ))}
                  {tickets.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-gray-500">
                        No tickets found matching your filters
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.totalPages} ({pagination.total} tickets)
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                  disabled={pagination.page === 1}
                  className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={18} />
                </button>
                <button
                  onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                  disabled={pagination.page >= pagination.totalPages}
                  className="p-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight size={18} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
