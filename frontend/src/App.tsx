
import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ReminderProvider } from './contexts/ReminderContext';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';

// Route-level code splitting: each page loads on demand
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const ClientList = lazy(() => import('./pages/ClientList').then(m => ({ default: m.ClientList })));
const PropertyList = lazy(() => import('./pages/PropertyList').then(m => ({ default: m.PropertyList })));
const JobList = lazy(() => import('./pages/JobList').then(m => ({ default: m.JobList })));
const JobDetail = lazy(() => import('./pages/JobDetail').then(m => ({ default: m.JobDetail })));
const JobCreate = lazy(() => import('./pages/JobCreate').then(m => ({ default: m.JobCreate })));
const LogisticsGrid = lazy(() => import('./pages/LogisticsGrid').then(m => ({ default: m.LogisticsGrid })));
const UsersList = lazy(() => import('./pages/UsersList').then(m => ({ default: m.UsersList })));
const AdminSettings = lazy(() => import('./pages/AdminSettings').then(m => ({ default: m.AdminSettings })));
const Engineers = lazy(() => import('./pages/Engineers').then(m => ({ default: m.Engineers })));

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
      <ReminderProvider>
        <Suspense fallback={<div className="text-secondary" style={{ padding: 'var(--space-xl)', textAlign: 'center' }}>Loading…</div>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          
          <Route element={<AppShell />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/clients" element={<ClientList />} />
            <Route path="/properties" element={<PropertyList />} />
            <Route path="/jobs" element={<JobList />} />
            <Route path="/jobs/new" element={<JobCreate />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/logistics" element={<LogisticsGrid />} />
            <Route path="/team" element={<UsersList />} />
            <Route path="/engineers" element={<Engineers />} />
            <Route path="/settings" element={<AdminSettings />} />
          </Route>
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </ReminderProvider>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
