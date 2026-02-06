import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { AlertTriangle, TrendingUp, TrendingDown, Target, Calendar, Clock } from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

interface DateMismatch {
  key: string;
  summary: string;
  application: string | null;
  applicationName: string | null;
  phase: string | null;
  status: string;
  approvedMonth: string;
  approvedAt: string;
  workMonths: string[];
  totalHours: number;
  hoursByMonth: Record<string, number>;
}

interface DateMismatchesResponse {
  mismatches: DateMismatch[];
  summary: {
    ticketCount: number;
    totalHours: number;
    description: string;
  };
}

interface ApprovedNoLoeTicket {
  key: string;
  summary: string;
  application: string | null;
  application_name: string | null;
  phase: string | null;
  status: string;
  loe_hours: number | null;
  loe_approved_at: string | null;
  hours_burnt: number;
}

interface ApprovedNoLoeResponse {
  tickets: ApprovedNoLoeTicket[];
  summary: {
    ticketCount: number;
    ticketsWithHours: number;
    totalHours: number;
    description: string;
  };
}

interface WaitingTicket {
  key: string;
  summary: string;
  application: string | null;
  application_name: string | null;
  priority: string | null;
  phase: string | null;
  status: string;
  loe_hours: number | null;
  loe_approved_at: string | null;
  jira_created_at: string | null;
  jira_updated_at: string | null;
  days_waiting?: number;
  days_since_work?: number;
  hours_burnt?: number;
  last_work_date?: string;
  ready_reason?: string;
}

interface WaitingOnVendorResponse {
  notStarted: WaitingTicket[];
  stalled: WaitingTicket[];
  summary: {
    notStartedCount: number;
    stalledCount: number;
    criticalCount: number;
    warningCount: number;
    totalLoeHoursWaiting: number;
    description: string;
  };
}

export function CompliancePage() {
  const [unapproved, setUnapproved] = useState<any>(null);
  const [accuracy, setAccuracy] = useState<any>(null);
  const [overages, setOverages] = useState<any>(null);
  const [dateMismatches, setDateMismatches] = useState<DateMismatchesResponse | null>(null);
  const [approvedNoLoe, setApprovedNoLoe] = useState<ApprovedNoLoeResponse | null>(null);
  const [waitingOnVendor, setWaitingOnVendor] = useState<WaitingOnVendorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'waitingOnVendor' | 'unapproved' | 'approvedNoLoe' | 'accuracy' | 'overages' | 'dateMismatches'>('waitingOnVendor');

  useEffect(() => {
    async function fetchData() {
      try {
        const [unapprovedData, approvedNoLoeData, accuracyData, overagesData, dateMismatchesData, waitingData] = await Promise.all([
          api.get('/compliance/unapproved-loe'),
          api.get<ApprovedNoLoeResponse>('/compliance/approved-no-loe'),
          api.get('/compliance/loe-accuracy'),
          api.get('/compliance/overages'),
          api.get<DateMismatchesResponse>('/compliance/date-mismatches'),
          api.get<WaitingOnVendorResponse>('/compliance/waiting-on-vendor'),
        ]);
        setUnapproved(unapprovedData);
        setApprovedNoLoe(approvedNoLoeData);
        setAccuracy(accuracyData);
        setOverages(overagesData);
        setDateMismatches(dateMismatchesData);
        setWaitingOnVendor(waitingData);
      } catch (error) {
        console.error('Failed to fetch compliance data:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Compliance</h1>
        <p className="text-gray-600">Monitor LOE compliance and budget overages</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${(waitingOnVendor?.summary?.criticalCount || 0) > 0 ? 'bg-red-100' : 'bg-amber-100'}`}>
              <Clock className={`w-5 h-5 ${(waitingOnVendor?.summary?.criticalCount || 0) > 0 ? 'text-red-600' : 'text-amber-600'}`} />
            </div>
            <div>
              <p className="text-sm text-gray-600">Waiting on Vendor</p>
              <p className={`text-2xl font-bold ${(waitingOnVendor?.summary?.criticalCount || 0) > 0 ? 'text-red-600' : 'text-amber-600'}`}>
                {(waitingOnVendor?.summary?.notStartedCount || 0) + (waitingOnVendor?.summary?.stalledCount || 0)}
              </p>
              <p className="text-xs text-gray-500">
                {waitingOnVendor?.summary?.criticalCount || 0} critical (14d+)
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Unapproved Hours</p>
              <p className="text-2xl font-bold text-red-600">
                {unapproved?.summary?.totalHours?.toFixed(1) || 0}
              </p>
              <p className="text-xs text-gray-500">
                {unapproved?.summary?.ticketCount || 0} non-urgent
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <TrendingDown className="w-5 h-5 text-yellow-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Approved No LOE</p>
              <p className="text-2xl font-bold text-yellow-600">
                {approvedNoLoe?.summary?.totalHours?.toFixed(1) || 0}
              </p>
              <p className="text-xs text-gray-500">
                {approvedNoLoe?.summary?.ticketCount || 0} tickets
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <Target className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">LOE Accuracy</p>
              <p className="text-2xl font-bold text-blue-600">
                {accuracy?.summary?.accuracyRate || 0}%
              </p>
              <p className="text-xs text-gray-500">
                {accuracy?.summary?.accurateCount || 0} of {accuracy?.summary?.totalTickets || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <TrendingUp className="w-5 h-5 text-orange-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Budget Overage</p>
              <p className="text-2xl font-bold text-orange-600">
                {overages?.summary?.totalOverage?.toFixed(1) || 0}
              </p>
              <p className="text-xs text-gray-500">
                {overages?.summary?.monthsOver || 0} months over
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Calendar className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <p className="text-sm text-gray-600">Date Mismatch</p>
              <p className="text-2xl font-bold text-purple-600">
                {dateMismatches?.summary?.totalHours?.toFixed(1) || 0}
              </p>
              <p className="text-xs text-gray-500">
                {dateMismatches?.summary?.ticketCount || 0} tickets
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex gap-4 overflow-x-auto">
          {[
            { id: 'waitingOnVendor', label: 'Waiting on Vendor', count: (waitingOnVendor?.summary?.notStartedCount || 0) + (waitingOnVendor?.summary?.stalledCount || 0) },
            { id: 'unapproved', label: 'Unapproved Work' },
            { id: 'approvedNoLoe', label: 'Approved No LOE' },
            { id: 'accuracy', label: 'LOE Accuracy' },
            { id: 'overages', label: 'Budget Overages' },
            { id: 'dateMismatches', label: 'Date Mismatches' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex items-center gap-2 ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className={`px-1.5 py-0.5 text-xs rounded-full ${
                  activeTab === tab.id ? 'bg-primary/10' : 'bg-gray-100'
                }`}>
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'waitingOnVendor' && (
        <div className="space-y-6">
          {/* Not Started Section */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-6 py-4 border-b bg-amber-50">
              <h2 className="text-lg font-semibold text-amber-800">Not Started - Waiting for Vendor</h2>
              <p className="text-sm text-amber-600 mt-1">
                Tickets ready for work (LOE Approved or P1/P2 priority) but vendor has not logged any hours
              </p>
            </div>
            {waitingOnVendor?.notStarted && waitingOnVendor.notStarted.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ticket</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ready Via</th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Days Waiting</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">LOE Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {waitingOnVendor.notStarted.map((ticket) => {
                      const days = ticket.days_waiting || 0;
                      let statusColor = 'bg-green-100 text-green-800';
                      if (days >= 14) statusColor = 'bg-red-100 text-red-800';
                      else if (days >= 7) statusColor = 'bg-yellow-100 text-yellow-800';
                      
                      return (
                        <tr key={ticket.key} className="hover:bg-gray-50">
                          <td className="px-6 py-4">
                            <a 
                              href={`https://drivestream.atlassian.net/browse/${ticket.key}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-mono text-sm text-primary hover:underline"
                            >
                              {ticket.key}
                            </a>
                            <p className="text-sm text-gray-600 truncate max-w-md">{ticket.summary}</p>
                          </td>
                          <td className="px-6 py-4 text-sm">{ticket.application_name || ticket.application || '-'}</td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              ticket.priority === 'Critical' || ticket.priority === 'Highest' || ticket.priority === 'Urgent'
                                ? 'bg-red-100 text-red-800'
                                : ticket.priority === 'High'
                                ? 'bg-orange-100 text-orange-800'
                                : 'bg-gray-100 text-gray-700'
                            }`}>
                              {ticket.priority || 'None'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className={`px-2 py-1 text-xs rounded-full ${
                              ticket.ready_reason === 'Urgent Priority'
                                ? 'bg-red-50 text-red-700'
                                : 'bg-green-50 text-green-700'
                            }`}>
                              {ticket.ready_reason || 'LOE Approved'}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className={`px-2 py-1 text-xs font-medium rounded-full ${statusColor}`}>
                              {days} days
                            </span>
                          </td>
                          <td className="px-6 py-4 text-right font-medium">
                            {ticket.loe_hours ? `${ticket.loe_hours}h` : '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500">
                No tickets waiting for vendor to start work!
              </div>
            )}
          </div>

          {/* Stalled Section */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-6 py-4 border-b bg-orange-50">
              <h2 className="text-lg font-semibold text-orange-800">Stalled - No Recent Work</h2>
              <p className="text-sm text-orange-600 mt-1">
                Open tickets with no work logged in 14+ days
              </p>
            </div>
            {waitingOnVendor?.stalled && waitingOnVendor.stalled.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ticket</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Work</th>
                      <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Days Stalled</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours Burnt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {waitingOnVendor.stalled.map((ticket) => (
                      <tr key={ticket.key} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <a 
                            href={`https://drivestream.atlassian.net/browse/${ticket.key}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-sm text-primary hover:underline"
                          >
                            {ticket.key}
                          </a>
                          <p className="text-sm text-gray-600 truncate max-w-md">{ticket.summary}</p>
                        </td>
                        <td className="px-6 py-4 text-sm">{ticket.application_name || ticket.application || '-'}</td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-full">
                            {ticket.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {ticket.last_work_date 
                            ? new Date(ticket.last_work_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : '-'
                          }
                        </td>
                        <td className="px-6 py-4 text-center">
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-orange-100 text-orange-800">
                            {ticket.days_since_work} days
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-medium">
                          {ticket.hours_burnt ? `${ticket.hours_burnt.toFixed(1)}h` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500">
                No stalled tickets!
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'unapproved' && (
        <div className="space-y-6">
          {/* Urgent Work Section - Not a compliance issue */}
          {unapproved?.urgentTickets?.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="px-6 py-4 border-b bg-blue-50">
                <h2 className="text-lg font-semibold text-blue-800">Urgent Work (P1/P2/Payroll)</h2>
                <p className="text-sm text-blue-600 mt-1">
                  These tickets are allowed to proceed without LOE approval ({unapproved.summary?.urgentHours?.toFixed(1) || 0} hours)
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ticket</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {unapproved.urgentTickets.map((ticket: any) => (
                      <tr key={ticket.key} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <p className="font-mono text-sm text-primary">{ticket.key}</p>
                          <p className="text-sm text-gray-600 truncate max-w-md">{ticket.summary}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            ticket.priority === 'Critical' || ticket.priority === 'Highest'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-orange-100 text-orange-800'
                          }`}>
                            {ticket.priority || 'Payroll'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm">{ticket.application_name || ticket.application}</td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-full">
                            {ticket.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-blue-600">
                          {ticket.hours_burnt?.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Non-Urgent Unapproved Work - Compliance Issue */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Unapproved Work (Compliance Issue)</h2>
              <p className="text-sm text-gray-600 mt-1">
                Non-urgent tickets with hours burned but no LOE approval
              </p>
            </div>
            {unapproved?.tickets?.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ticket</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Priority</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours Burnt</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {unapproved.tickets.map((ticket: any) => (
                      <tr key={ticket.key} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <p className="font-mono text-sm text-primary">{ticket.key}</p>
                          <p className="text-sm text-gray-600 truncate max-w-md">{ticket.summary}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded-full">
                            {ticket.priority || 'None'}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm">{ticket.application_name || ticket.application}</td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full">
                            {ticket.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-red-600">
                          {ticket.hours_burnt?.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-gray-500">
                No compliance issues found - all non-urgent work has approved LOE!
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'approvedNoLoe' && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Tickets Approved Without LOE Estimate</h2>
            <p className="text-sm text-gray-600 mt-1">
              {approvedNoLoe?.summary?.description || 'Tickets that were approved for work but have no LOE hours estimate'}
            </p>
          </div>
          {approvedNoLoe?.tickets && approvedNoLoe.tickets.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ticket</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">LOE Estimate</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Approved</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours Burnt</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {approvedNoLoe.tickets.map((ticket) => (
                    <tr key={ticket.key} className="hover:bg-gray-50">
                      <td className="px-6 py-4">
                        <p className="font-mono text-sm text-primary">{ticket.key}</p>
                        <p className="text-sm text-gray-600 truncate max-w-md">{ticket.summary}</p>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {ticket.application_name || ticket.application || 'Unclassified'}
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">
                          No LOE
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {ticket.loe_approved_at 
                          ? new Date(ticket.loe_approved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                          : '-'
                        }
                      </td>
                      <td className="px-6 py-4 text-right font-medium">
                        {ticket.hours_burnt > 0 ? (
                          <span className="text-yellow-600">{ticket.hours_burnt.toFixed(1)}</span>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">
              All approved tickets have LOE estimates!
            </div>
          )}
        </div>
      )}

      {activeTab === 'accuracy' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">LOE Accuracy by Application</h2>
            {accuracy?.byApplication?.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={accuracy.byApplication} layout="vertical">
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="application" width={80} />
                  <Tooltip
                    formatter={(value: number, name: string) => [
                      `${value.toFixed(1)} hours`,
                      name === 'estimated' ? 'Estimated' : 'Actual',
                    ]}
                  />
                  <Bar dataKey="estimated" name="Estimated" fill="#94a3b8" />
                  <Bar dataKey="actual" name="Actual" fill="#3b82f6" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-gray-500">
                No data available
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'overages' && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Monthly Budget History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Allocated</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Burnt</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Overage</th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {overages?.periods?.map((period: any) => {
                  const monthName = new Date(period.year, period.month - 1).toLocaleDateString(
                    'en-US',
                    { month: 'long', year: 'numeric' }
                  );
                  return (
                    <tr key={`${period.year}-${period.month}`} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium">{monthName}</td>
                      <td className="px-6 py-4 text-right">{period.allocated}h</td>
                      <td className="px-6 py-4 text-right">{period.burnt}h</td>
                      <td className="px-6 py-4 text-right">
                        {period.overage > 0 ? (
                          <span className="text-red-600">+{period.overage.toFixed(1)}h</span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {period.isOver ? (
                          <span className="px-2 py-1 text-xs bg-red-100 text-red-800 rounded-full">
                            Over Budget
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                            Within Budget
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'dateMismatches' && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">Date Mismatches</h2>
            <p className="text-sm text-gray-600 mt-1">
              {dateMismatches?.summary?.description || 'Tickets where hours were billed in a different month than the LOE approval'}
            </p>
          </div>
          {dateMismatches?.mismatches && dateMismatches.mismatches.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ticket</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Application</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Approved Month</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Work Recorded In</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dateMismatches.mismatches.map((mismatch) => {
                    const approvedMonthName = mismatch.approvedMonth 
                      ? new Date(mismatch.approvedMonth + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                      : 'Unknown';
                    
                    return (
                      <tr key={mismatch.key} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <p className="font-mono text-sm text-primary">{mismatch.key}</p>
                          <p className="text-sm text-gray-600 truncate max-w-md">{mismatch.summary}</p>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          {mismatch.applicationName || mismatch.application || 'Unclassified'}
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                            {approvedMonthName}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-1">
                            {mismatch.workMonths.map((month) => {
                              const monthName = new Date(month + '-01').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                              const hours = mismatch.hoursByMonth[month];
                              const isMatch = month === mismatch.approvedMonth;
                              return (
                                <span
                                  key={month}
                                  className={`px-2 py-1 text-xs rounded-full ${
                                    isMatch
                                      ? 'bg-green-100 text-green-800'
                                      : 'bg-purple-100 text-purple-800'
                                  }`}
                                  title={hours ? `${hours.toFixed(1)} hours` : undefined}
                                >
                                  {monthName}
                                  {hours && <span className="ml-1 opacity-75">({hours.toFixed(1)}h)</span>}
                                </span>
                              );
                            })}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-purple-600">
                          {mismatch.totalHours.toFixed(1)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center text-gray-500">
              No date mismatches found - all hours are billed in the same month as LOE approval!
            </div>
          )}
        </div>
      )}
    </div>
  );
}
