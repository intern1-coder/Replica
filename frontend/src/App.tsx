
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { ReminderProvider } from './contexts/ReminderContext';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { ResetPassword } from './pages/ResetPassword';
import { Dashboard } from './pages/Dashboard';
import { ClientList } from './pages/ClientList';
import { PropertyList } from './pages/PropertyList';
import { JobList } from './pages/JobList';
import { JobDetail } from './pages/JobDetail';
import { JobCreate } from './pages/JobCreate';
import { LogisticsGrid } from './pages/LogisticsGrid';
import { UsersList } from './pages/UsersList';
import { AdminSettings } from './pages/AdminSettings';
import { Engineers } from './pages/Engineers';

function App() {
  return (
    <AuthProvider>
      <ToastProvider>
      <BrowserRouter>
      <ReminderProvider>
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
      </ReminderProvider>
      </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}

export default App;
