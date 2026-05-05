import { Navigate, Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function AppLayout() {
  const { user, loading, logout, isStaff, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const navLinks = [
    { to: '/', label: 'Meine IPA', show: true },
    { to: '/dashboard', label: 'Dashboard', show: isStaff },
    { to: '/overview', label: 'Übersicht', show: isStaff },
    { to: '/missing-grades', label: 'Fehlende Noten', show: isStaff },
    { to: '/admin', label: 'Admin', show: isAdmin },
  ];

  return (
    <div className="min-h-screen">
      {/* Navbar */}
      <nav className="bg-gradient-to-r from-primary-600 to-primary-800 shadow-lg">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <Link to="/" className="text-white font-bold text-lg">
                Notenkonferenz
              </Link>
              <div className="hidden md:flex gap-1">
                {navLinks
                  .filter((l) => l.show)
                  .map((link) => (
                    <Link
                      key={link.to}
                      to={link.to}
                      className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                        location.pathname === link.to
                          ? 'bg-white/20 text-white'
                          : 'text-white/80 hover:bg-white/10 hover:text-white'
                      }`}
                    >
                      {link.label}
                    </Link>
                  ))}
              </div>
            </div>
            <div className="flex items-center gap-4">
              {isAdmin && (
                <div className="hidden md:flex gap-1">
                  <Link
                    to="/collect?typ=ungenuegend"
                    className="px-2 py-1 rounded text-xs bg-red-500/80 text-white hover:bg-red-500"
                  >
                    Ungenügend
                  </Link>
                  <Link
                    to="/collect?typ=knapp"
                    className="px-2 py-1 rounded text-xs bg-yellow-500/80 text-white hover:bg-yellow-500"
                  >
                    Knapp
                  </Link>
                  <Link
                    to="/collect?typ=gut"
                    className="px-2 py-1 rounded text-xs bg-green-500/80 text-white hover:bg-green-500"
                  >
                    Gut
                  </Link>
                  <Link
                    to="/collect?typ=sehrgut"
                    className="px-2 py-1 rounded text-xs bg-blue-500/80 text-white hover:bg-blue-500"
                  >
                    Sehr gut
                  </Link>
                </div>
              )}
              <span className="text-white/80 text-sm">{user.email}</span>
              <button
                onClick={logout}
                className="text-white/80 hover:text-white text-sm transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
