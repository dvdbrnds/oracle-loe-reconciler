import { useState, useEffect } from 'react';
import { api, Ticket, TicketsResponse } from '../services/api';
import { Search, ChevronLeft, ChevronRight, AlertCircle, Filter } from 'lucide-react';

interface FiltersState {
  application: string;
  phase: string;
  status: string;
  priority: string;
  search: string;
}

export function TicketsPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [filterOptions, setFilterOptions] = useState<any>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<FiltersState>({
    application: '',
    phase: '',
    status: '',
    priority: '',
    search: '',
  });

  useEffect(() => {
    api.get('/tickets/meta/filters').then(setFilterOptions).catch(console.error);
  }, []);

  useEffect(() => {
    async function fetchTickets() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set('page', String(pagination.page));
        if (filters.application) params.set('application', filters.application);
        if (filters.phase) params.set('phase', filters.phase);
        if (filters.status) params.set('status', filters.status);
        if (filters.priority) params.set('priority', filters.priority);
        if (filters.search) params.set('search', filters.search);

        const data = await api.get<TicketsResponse>(`/tickets?${params}`);
        setTickets(data.tickets);
        setPagination(prev => ({
          ...prev,
          total: data.pagination.total,
          totalPages: data.pagination.totalPages,
        }));
      } catch (error) {
        console.error('Failed to fetch tickets:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchTickets();
  }, [pagination.page, filters]);

  const handleFilterChange = (key: keyof FiltersState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({ application: '', phase: '', status: '', priority: '', search: '' });
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const getStatusBadgeColor = (status: string) => {
    switch (status) {
      case 'LOE Approved':
        return 'bg-green-100 text-green-800';
      case 'LOE Provided':
        return 'bg-yellow-100 text-yellow-800';
      case 'On Hold':
        return 'bg-gray-100 text-gray-800';
      case 'Resolved':
        return 'bg-blue-100 text-blue-800';
      case 'Client Clarification Requested':
        return 'bg-orange-100 text-orange-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getPriorityBadgeColor = (priority: string | null) => {
    switch (priority?.toLowerCase()) {
      case 'critical':
        return 'bg-red-100 text-red-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      case 'low':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tickets</h1>
          <p className="text-gray-600">
            {pagination.total} tickets across all projects
          </p>
        </div>
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50"
        >
          <Filter size={18} />
          Filters
        </button>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-xl shadow-sm border p-4 space-y-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            value={filters.search}
            onChange={e => handleFilterChange('search', e.target.value)}
            placeholder="Search tickets by key or summary..."
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>

        {/* Filters */}
        {showFilters && filterOptions && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-4 border-t">
            <select
              value={filters.application}
              onChange={e => handleFilterChange('application', e.target.value)}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="">All Applications</option>
              {filterOptions.applications?.map((app: any) => (
                <option key={app.code} value={app.code}>
                  {app.name}
                </option>
              ))}
            </select>

            <select
              value={filters.phase}
              onChange={e => handleFilterChange('phase', e.target.value)}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="">All Phases</option>
              {filterOptions.phases?.map((phase: string) => (
                <option key={phase} value={phase}>
                  {phase}
                </option>
              ))}
            </select>

            <select
              value={filters.status}
              onChange={e => handleFilterChange('status', e.target.value)}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="">All Statuses</option>
              {filterOptions.statuses?.map((status: string) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>

            <select
              value={filters.priority}
              onChange={e => handleFilterChange('priority', e.target.value)}
              className="px-3 py-2 border rounded-lg"
            >
              <option value="">All Priorities</option>
              {filterOptions.priorities?.map((priority: string) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>

            <button
              onClick={clearFilters}
              className="text-sm text-primary hover:underline text-left"
            >
              Clear all filters
            </button>
          </div>
        )}
      </div>

      {/* Tickets Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Key
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Summary
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Application
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Phase
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Priority
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      LOE
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Burnt
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tickets.map(ticket => (
                    <tr
                      key={ticket.key}
                      className={`hover:bg-gray-50 ${
                        ticket.has_compliance_issue ? 'compliance-issue' : ''
                      }`}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {ticket.has_compliance_issue && (
                            <AlertCircle className="w-4 h-4 text-red-500" />
                          )}
                          <span className="font-mono text-sm text-primary">
                            {ticket.key}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="max-w-md truncate text-sm" title={ticket.summary}>
                          {ticket.summary}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {ticket.application_name || ticket.application || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        {ticket.phase || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs rounded-full ${getPriorityBadgeColor(
                            ticket.priority
                          )}`}
                        >
                          {ticket.priority || 'None'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 text-xs rounded-full ${getStatusBadgeColor(
                            ticket.status
                          )}`}
                        >
                          {ticket.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                        {ticket.loe_hours?.toFixed(1) || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                        {ticket.hours_burnt.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="px-4 py-3 border-t flex items-center justify-between">
              <p className="text-sm text-gray-600">
                Page {pagination.page} of {pagination.totalPages}
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
