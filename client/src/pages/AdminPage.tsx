import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { toast } from '../components/ui/toaster';
import { Settings, Users, Database, RefreshCw } from 'lucide-react';

interface AdminConfig {
  useMockData: boolean;
  jiraInstanceUrl: string;
  jiraSyncIntervalMinutes: number;
  jiraProjects: string[];
  defaultMonthlyHours: number;
  hasGoogleChat: boolean;
  hasSlack: boolean;
  hasTeams: boolean;
}

interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: string;
  is_mock_data: boolean;
  created_at: string;
}

interface Application {
  code: string;
  name: string;
  budget_cap: number | null;
  is_active: boolean;
}

interface Project {
  key: string;
  name: string;
  phase: string;
  is_active: boolean;
}

interface ReporterMapping {
  id: number;
  reporter_name: string;
  reporter_email: string;
  application: string | null;
  application_name: string | null;
  mapping_type: string;
}

export function AdminPage() {
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [reporterMappings, setReporterMappings] = useState<ReporterMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'config' | 'users' | 'data'>('config');

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const [configData, usersData, appsData, projectsData, mappingsData] =
        await Promise.all([
          api.get<AdminConfig>('/admin/config'),
          api.get<{ users: AdminUser[] }>('/admin/users'),
          api.get<{ applications: Application[] }>('/admin/applications'),
          api.get<{ projects: Project[] }>('/admin/projects'),
          api.get<{ mappings: ReporterMapping[] }>('/admin/reporter-mappings'),
        ]);
      setConfig(configData);
      setUsers(usersData.users);
      setApplications(appsData.applications);
      setProjects(projectsData.projects);
      setReporterMappings(mappingsData.mappings);
    } catch (error) {
      console.error('Failed to fetch admin data:', error);
      toast({ title: 'Failed to load admin data', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSyncJira() {
    try {
      const result = await api.post<{ success: boolean; message: string }>('/sync/jira', {});
      toast({
        title: result.success ? 'Sync complete' : 'Sync not available',
        description: result.message,
      });
    } catch (error) {
      toast({
        title: 'Sync failed',
        description: error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      });
    }
  }

  async function handleUserRoleChange(userId: number, newRole: string) {
    try {
      await api.put(`/admin/users/${userId}/role`, { role: newRole });
      toast({ title: 'User role updated' });
      fetchData();
    } catch (error) {
      toast({
        title: 'Failed to update role',
        description: error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Admin Settings</h1>
        <p className="text-gray-600">Manage configuration, users, and data</p>
      </div>

      {/* Tabs */}
      <div className="border-b">
        <nav className="flex gap-4">
          {[
            { id: 'config', label: 'Configuration', icon: Settings },
            { id: 'users', label: 'Users', icon: Users },
            { id: 'data', label: 'Data Management', icon: Database },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Configuration Tab */}
      {activeTab === 'config' && (
        <div className="space-y-6">
          {/* Jira Connection */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Jira Connection</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium">Mode</p>
                  <p className="text-sm text-gray-600">
                    {config?.useMockData ? 'Using FAKE/Mock Data' : 'Connected to Live Jira'}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-sm ${
                    config?.useMockData
                      ? 'bg-yellow-100 text-yellow-800'
                      : 'bg-green-100 text-green-800'
                  }`}
                >
                  {config?.useMockData ? 'Demo Mode' : 'Live'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-600">Instance URL</p>
                  <p className="font-medium">{config?.jiraInstanceUrl || 'Not configured'}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">Sync Interval</p>
                  <p className="font-medium">{config?.jiraSyncIntervalMinutes} minutes</p>
                </div>
              </div>

              <div>
                <p className="text-sm text-gray-600 mb-2">Configured Projects</p>
                <div className="flex flex-wrap gap-2">
                  {config?.jiraProjects?.map((proj: string) => (
                    <span
                      key={proj}
                      className="px-2 py-1 bg-gray-100 rounded text-sm font-mono"
                    >
                      {proj}
                    </span>
                  ))}
                </div>
              </div>

              <button
                onClick={handleSyncJira}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90"
              >
                <RefreshCw size={18} />
                Sync Now
              </button>
            </div>
          </div>

          {/* Budget Settings */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Budget Settings</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-600">Default Monthly Hours</p>
                <p className="text-2xl font-bold">{config?.defaultMonthlyHours}</p>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-4">
              Edit .env file to change these settings.
            </p>
          </div>

          {/* Notification Channels */}
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="text-lg font-semibold mb-4">Notification Channels</h2>
            <div className="space-y-3">
              {[
                { name: 'Google Chat', enabled: config?.hasGoogleChat },
                { name: 'Slack', enabled: config?.hasSlack },
                { name: 'Microsoft Teams', enabled: config?.hasTeams },
              ].map(channel => (
                <div
                  key={channel.name}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <span>{channel.name}</span>
                  <span
                    className={`px-2 py-1 text-xs rounded-full ${
                      channel.enabled
                        ? 'bg-green-100 text-green-800'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {channel.enabled ? 'Configured' : 'Not configured'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Users Tab */}
      {activeTab === 'users' && (
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-semibold">User Management</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Role
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {users.map(user => (
                  <tr key={user.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium">{user.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{user.email}</td>
                    <td className="px-6 py-4">
                      <select
                        value={user.role}
                        onChange={e => handleUserRoleChange(user.id, e.target.value)}
                        className="px-2 py-1 border rounded text-sm"
                      >
                        <option value="user">User</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      {user.is_mock_data ? (
                        <span className="px-2 py-1 text-xs bg-yellow-100 text-yellow-800 rounded-full">
                          FAKE
                        </span>
                      ) : (
                        <span className="px-2 py-1 text-xs bg-green-100 text-green-800 rounded-full">
                          Real
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Data Management Tab */}
      {activeTab === 'data' && (
        <div className="space-y-6">
          {/* Applications */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Applications</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Code
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Name
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      Budget Cap
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Active
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {applications.map(app => (
                    <tr key={app.code} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-mono font-medium">{app.code}</td>
                      <td className="px-6 py-4">{app.name}</td>
                      <td className="px-6 py-4 text-right">
                        {app.budget_cap ? `${app.budget_cap}h` : '-'}
                      </td>
                      <td className="px-6 py-4 text-center">
                        {app.is_active ? '✓' : '✗'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Jira Projects */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Jira Projects</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Key
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Phase
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                      Active
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {projects.map(proj => (
                    <tr key={proj.key} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-mono font-medium">{proj.key}</td>
                      <td className="px-6 py-4">{proj.name}</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">
                          {proj.phase}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {proj.is_active ? '✓' : '✗'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Reporter Mappings */}
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Reporter Mappings</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Reporter
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Email
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Application
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                      Type
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {reporterMappings.map(mapping => (
                    <tr key={mapping.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium">{mapping.reporter_name}</td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {mapping.reporter_email}
                      </td>
                      <td className="px-6 py-4">
                        {mapping.application_name || mapping.application || '-'}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`px-2 py-1 text-xs rounded-full ${
                            mapping.mapping_type === 'auto-map'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {mapping.mapping_type}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
