import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { useAuth } from './contexts/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { IndexPage } from './pages/IndexPage';
import { DashboardPage } from './pages/DashboardPage';
import { OverviewPage } from './pages/OverviewPage';
import { DetailPage } from './pages/DetailPage';
import { ChangePage } from './pages/ChangePage';
import { MissingGradesPage } from './pages/MissingGradesPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { UserManagementPage } from './pages/UserManagementPage';
import { LogsPage } from './pages/LogsPage';
import { MissingPortfoliosPage } from './pages/MissingPortfoliosPage';
import { ReactNode } from 'react';

function StaffRoute({ children }: { children: ReactNode }) {
  const { isStaff } = useAuth();
  if (!isStaff) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold mb-2">Zugang nicht erlaubt</h2>
        <p className="text-gray-500">Sie benötigen Staff-Rechte für den Zugriff.</p>
      </div>
    );
  }
  return <>{children}</>;
}

function AdminRoute({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-bold mb-2">Zugang nicht erlaubt</h2>
        <p className="text-gray-500">Sie benötigen Admin-Rechte für den Zugriff.</p>
      </div>
    );
  }
  return <>{children}</>;
}

export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/register',
    element: <RegisterPage />,
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      // All authenticated users
      { index: true, element: <IndexPage /> },
      { path: 'details/:kandidatId', element: <DetailPage /> },
      { path: 'change/:kandidatId', element: <ChangePage /> },
      // Staff + Admin
      { path: 'dashboard', element: <StaffRoute><DashboardPage /></StaffRoute> },
      { path: 'overview', element: <StaffRoute><OverviewPage /></StaffRoute> },
      { path: 'missing-grades', element: <StaffRoute><MissingGradesPage /></StaffRoute> },
      // Admin only
      { path: 'admin', element: <AdminRoute><AdminDashboardPage /></AdminRoute> },
      { path: 'admin/users', element: <AdminRoute><UserManagementPage /></AdminRoute> },
      { path: 'admin/logs', element: <AdminRoute><LogsPage /></AdminRoute> },
      { path: 'admin/missing-portfolios', element: <AdminRoute><MissingPortfoliosPage /></AdminRoute> },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
