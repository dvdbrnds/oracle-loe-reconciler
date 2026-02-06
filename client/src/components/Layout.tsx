import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import {
  LayoutDashboard,
  Upload,
  Settings,
  LogOut,
  Menu,
  X,
  CalendarClock,
} from 'lucide-react';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/forecast', label: 'Forecast', icon: CalendarClock },
  { path: '/import', label: 'Import', icon: Upload },
];

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [useMockData, setUseMockData] = useState(false);

  useEffect(() => {
    api.get<{ useMockData: boolean }>('/health')
      .then(data => setUseMockData(data.useMockData))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 overflow-x-hidden">
      {useMockData && (
        <div className="bg-yellow-500 text-yellow-900 text-center py-2 px-4 text-sm font-medium">
          DEMO MODE - Using simulated FAKE data. Configure Jira credentials for live data.
        </div>
      )}

      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-md hover:bg-gray-100"
        >
          {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <img src="/drivestream-logo.png" alt="DriveStream" className="h-6 flex-shrink-0" />
          <span className="text-gray-400 flex-shrink-0">|</span>
          <span className="font-medium text-gray-700 text-sm">Support Hours Tracker</span>
        </div>
        <div className="w-10" />
      </div>

      <div className="flex">
        <aside
          className={`
            fixed inset-y-0 left-0 z-40 w-64 bg-white border-r transform transition-transform duration-200 ease-in-out
            lg:relative lg:translate-x-0 lg:flex-shrink-0
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          `}
        >
          <div className="flex flex-col h-full">
            <div className="hidden lg:flex flex-col px-6 py-5 border-b">
              <img src="/drivestream-logo.png" alt="DriveStream" className="h-8 w-auto object-contain object-left" />
              <span className="text-xs text-gray-500 mt-1">Support Hours Tracker</span>
            </div>

            <nav className="flex-1 px-4 py-6 space-y-1 mt-14 lg:mt-0">
              {navItems.map(item => {
                const isActive = location.pathname === item.path;
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 px-4 py-3 rounded-lg transition-colors
                      ${isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-gray-700 hover:bg-gray-100'
                      }
                    `}
                  >
                    <item.icon size={20} />
                    <span>{item.label}</span>
                  </Link>
                );
              })}

              {user?.role === 'admin' && (
                <Link
                  to="/admin"
                  onClick={() => setSidebarOpen(false)}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-lg transition-colors
                    ${location.pathname === '/admin'
                      ? 'bg-primary text-primary-foreground'
                      : 'text-gray-700 hover:bg-gray-100'
                    }
                  `}
                >
                  <Settings size={20} />
                  <span>Admin</span>
                </Link>
              )}
            </nav>

            <div className="border-t px-4 py-4">
              <div className="flex items-center gap-3 px-4 py-2">
                <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                  <span className="text-sm font-medium">
                    {user?.name?.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{user?.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
                </div>
              </div>
              <button
                onClick={logout}
                className="w-full flex items-center gap-3 px-4 py-2 mt-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <LogOut size={18} />
                <span>Sign out</span>
              </button>
            </div>
          </div>
        </aside>

        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <main className="flex-1 min-h-screen min-w-0 overflow-x-hidden">
          <div className="p-6 pt-16 lg:pt-6 max-w-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
