import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { Users } from 'lucide-react';

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  canAuthorizeJobs: boolean;
}

export function UsersList() {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  
  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setIsLoading(true);
    setError('');
    try {
      const data = await apiFetch('/users');
      setUsers(data);
    } catch (err: any) {
      setError(err.message || 'Failed to load users');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleAuthorize = async (userId: string, currentStatus: boolean) => {
    try {
      const updatedUser = await apiFetch(`/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ canAuthorizeJobs: !currentStatus })
      });
      setUsers(users.map(u => u.id === userId ? updatedUser : u));
    } catch (err: any) {
      alert(err.message || 'Failed to update user');
    }
  };

  return (
    <div className="page-enter">
      <div className="page-header">
        <h2 style={{ margin: 0 }} className="flex items-center gap-2">
          <Users size={24} className="text-primary" /> Team / Users
        </h2>
      </div>

      {error && (
        <div className="page-error">
          {error}
        </div>
      )}

      {isLoading ? (
        <p>Loading users...</p>
      ) : (
        <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ margin: 0, border: 'none', borderRadius: 0, boxShadow: 'none' }}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Approver Access</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u, idx) => (
                <tr key={u.id} className={`stagger-${(idx % 5) + 1}`}>
                  <td className="font-medium">{u.name}</td>
                  <td className="text-secondary">{u.email}</td>
                  <td>
                    <span className="status-badge quoted">
                      {u.role}
                    </span>
                  </td>
                  <td>
                    <label className="flex items-center gap-2" style={{ cursor: 'pointer' }}>
                      <input 
                        type="checkbox" 
                        checked={u.canAuthorizeJobs} 
                        onChange={() => toggleAuthorize(u.id, u.canAuthorizeJobs)}
                        disabled={u.role === 'ADMIN' || u.role === 'OWNER'} // They already have it implicitly
                      />
                      {u.canAuthorizeJobs ? 'Yes' : 'No'}
                    </label>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 'var(--space-xl)' }}>
                    <div className="empty-state" style={{ border: 'none' }}>
                      <Users size={48} className="text-muted" style={{ opacity: 0.5, marginBottom: 'var(--space-sm)' }} />
                      <p className="font-medium" style={{ margin: 0 }}>No users found</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
