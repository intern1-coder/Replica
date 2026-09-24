import { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { applyPermissionToggle } from '../utils/permissions';
import { Users, UserPlus, KeyRound, Shield, Trash2, Pencil, X, MailPlus } from 'lucide-react';
import { motion } from 'motion/react';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
  canAuthorizeJobs: boolean;
  hasPassword?: boolean;
  permissionOverrides?: Record<string, boolean> | null;
}

interface PermGroup {
  resource: string;
  label: string;
  actions: string[];
}

const ADMIN_ASSIGNABLE_ROLES = ['PM', 'ADMIN', 'ACCOUNTS', 'CONTRACTOR'];
const SUPER_ADMIN_ASSIGNABLE_ROLES = ['SUPER_ADMIN', 'PM', 'ADMIN', 'ACCOUNTS', 'OWNER', 'CONTRACTOR'];

function assignableRoles(viewerRole: string | undefined): string[] {
  if (viewerRole === 'SUPER_ADMIN') return SUPER_ADMIN_ASSIGNABLE_ROLES;
  return ADMIN_ASSIGNABLE_ROLES;
}

export function UsersList() {
  const { can, socket, user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [groups, setGroups] = useState<PermGroup[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [resetId, setResetId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sessionReady = user !== null;
  const canView = can('users:view');
  const canEdit = canView && can('users:edit');
  const canCreate = canView && can('users:create');
  const canDelete = canView && can('users:delete');

  const clearPageState = useCallback(() => {
    setMembers([]);
    setGroups([]);
    setAddOpen(false);
    setEditId(null);
    setResetId(null);
    setError('');
  }, []);

  const load = useCallback(async (background = false) => {
    if (!canView) {
      clearPageState();
      return;
    }
    if (!background) {
      setIsLoading(true);
      setError('');
    }
    try {
      const [data, meta] = await Promise.all([
        apiFetch('/users'),
        apiFetch('/users/meta/permissions'),
      ]);
      setMembers(data);
      setGroups(meta.groups);
    } catch (err: any) {
      if (err.status === 403) {
        clearPageState();
        return;
      }
      if (!background) setError(err.message || 'Failed to load team');
    } finally {
      if (!background) setIsLoading(false);
    }
  }, [canView, clearPageState]);

  useEffect(() => {
    if (sessionReady && canView) load();
    if (sessionReady && !canView) clearPageState();
  }, [sessionReady, canView, load, clearPageState]);

  useEffect(() => {
    if (!socket || !canView) return;
    const handler = () => load(true);
    socket.on('users:changed', handler);
    return () => {
      socket.off('users:changed', handler);
    };
  }, [socket, load, canView]);

  if (sessionReady && !canView) {
    return <Navigate to="/" replace />;
  }

  const handleResendInvite = async (m: Member) => {
    try {
      const res = await apiFetch(`/users/${m.id}/resend-invite`, { method: 'POST' });
      setNotice(res.message || `Invite sent to ${m.email}.`);
    } catch (err: any) {
      alert(err.message || 'Failed to resend invite');
    }
  };

  const handleDeactivate = async (m: Member) => {
    if (!confirm(`Deactivate ${m.name}? They will no longer be able to log in.`)) return;
    try {
      await apiFetch(`/users/${m.id}`, { method: 'DELETE' });
      setMembers((prev) => prev.filter((x) => x.id !== m.id));
    } catch (err: any) {
      alert(err.message || 'Failed to deactivate member');
    }
  };

  const listItem: any = {
    hidden: { opacity: 0, y: 10 },
    show: { opacity: 1, y: 0, transition: { type: 'spring', duration: 0.4, bounce: 0 } }
  };

  return (
    <div className="page-enter">
      <div className="page-header flex items-center justify-between">
        <h2 style={{ margin: 0 }} className="flex items-center gap-2">
          <Users size={24} className="text-primary" /> Team Access
        </h2>
        {canCreate && (
          <button className="button primary flex items-center gap-2" onClick={() => setAddOpen(true)}>
            <UserPlus size={18} /> Add Member
          </button>
        )}
      </div>

      {error && <div className="page-error">{error}</div>}
      {notice && (
        <div className="section-card flex items-center justify-between" style={{ padding: 'var(--space-sm) var(--space-md)', marginBottom: 'var(--space-md)' }}>
          <span className="text-secondary">{notice}</span>
          <button className="button secondary" style={{ padding: 6 }} onClick={() => setNotice(null)}><X size={16} /></button>
        </div>
      )}

      {isLoading ? (
        <p>Loading team…</p>
      ) : (
        <div className="section-card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="min-w-full divide-y divide-border">
              <thead>
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                    Name
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                    Email
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                    Role
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                    Customised
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-secondary uppercase tracking-wider whitespace-nowrap align-middle">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {members.length > 0 ? (
                  members.map((m) => {
                    const overrideCount = m.permissionOverrides
                      ? Object.keys(m.permissionOverrides).length
                      : 0;
                    return (
                      <motion.tr
                        key={m.id}
                        variants={listItem}
                        className="cursor-pointer hover:bg-gray-50/80 dark:hover:bg-zinc-900/50 transition-colors"
                      >
                        <td className="px-4 py-4 whitespace-nowrap align-middle">
                          <div className="font-medium" data-label="Name">{m.name}</div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap align-middle">
                          <div className="text-secondary" data-label="Email">
                            <span className="member-email" title={m.email}>{m.email}</span>
                            {m.email.endsWith('@noemail.local') && (
                              <span className="status-badge" title="Placeholder address — set a real email so this member can log in" style={{ marginLeft: 6 }}>no email</span>
                            )}
                            {m.hasPassword === false && !m.email.endsWith('@noemail.local') && (
                              <span className="status-badge quoted" title="Member has not set a password yet" style={{ marginLeft: 6 }}>invite pending</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap align-middle">
                          <div data-label="Role"><span className="status-badge quoted">{m.role}</span></div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap align-middle">
                          <div data-label="Customised">
                            {overrideCount > 0 ? (
                              <span className="status-badge authorised">{overrideCount} override{overrideCount > 1 ? 's' : ''}</span>
                            ) : (
                              <span className="text-muted">Role defaults</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 whitespace-nowrap align-middle text-right">
                          <div className="list-cell-action flex items-center gap-2 flex-wrap">
                            {canEdit && (
                              <button className="button secondary" title="Edit & permissions" onClick={() => setEditId(m.id)}>
                                <Pencil size={16} /> Edit
                              </button>
                            )}
                            {canCreate && m.hasPassword === false && !m.email.endsWith('@noemail.local') && (
                              <button className="button secondary" title="Resend invite email" onClick={() => handleResendInvite(m)}>
                                <MailPlus size={16} /> Resend
                              </button>
                            )}
                            {canEdit && (
                              <button className="button secondary" title="Reset password" onClick={() => setResetId(m.id)}>
                                <KeyRound size={16} /> Reset
                              </button>
                            )}
                            {canDelete && (
                              <button className="button danger" title="Deactivate" onClick={() => handleDeactivate(m)}>
                                <Trash2 size={16} /> Remove
                              </button>
                            )}
                          </div>
                        </td>
                      </motion.tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-secondary">
                      <div className="empty-state" style={{ border: 'none' }}>
                        <Users size={48} className="text-muted" style={{ opacity: 0.5, marginBottom: 'var(--space-sm)' }} />
                        <p className="font-medium" style={{ margin: 0 }}>No members found</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {addOpen && (
        <AddMemberModal
          groups={groups}
          roles={assignableRoles(user?.role)}
          onClose={() => setAddOpen(false)}
          onCreated={(message) => { setAddOpen(false); setNotice(message); load(); }}
        />
      )}
      {editId && (
        <EditMemberModal
          memberId={editId}
          groups={groups}
          roles={assignableRoles(user?.role)}
          onClose={() => setEditId(null)}
          onSaved={() => { setEditId(null); load(); }}
        />
      )}
      {resetId && (
        <ResetPasswordModal
          memberId={resetId}
          memberName={members.find((m) => m.id === resetId)?.name || ''}
          onClose={() => setResetId(null)}
        />
      )}
    </div>
  );
}

// ── Modal shell ──────────────────────────────────────────────────────────────
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '4vh 1rem' }}
      onClick={onClose}
    >
      <div
        className="section-card"
        style={{ width: '100%', maxWidth: wide ? 720 : 440, margin: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between" style={{ marginBottom: 'var(--space-md)' }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <button className="button secondary" onClick={onClose} style={{ padding: 6 }}><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Permission matrix ─────────────────────────────────────────────────────────
function PermissionMatrix({
  groups,
  effective,
  rolePreset,
  onToggle,
}: {
  groups: PermGroup[];
  effective: Record<string, boolean>;
  rolePreset: Record<string, boolean>;
  onToggle: (key: string, value: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
      {groups.map((g) => (
        <div key={g.resource} className="flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 6 }}>
          <span className="font-medium" style={{ minWidth: 160 }}>{g.label}</span>
          <div className="flex items-center gap-3" style={{ flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {g.actions.map((a) => {
              const key = `${g.resource}:${a}`;
              const checked = !!effective[key];
              const overridden = checked !== !!rolePreset[key];
              return (
                <label key={key} className="flex items-center gap-1" style={{ cursor: 'pointer', fontSize: '0.8rem' }} title={overridden ? 'Differs from role default' : 'Role default'}>
                  <input type="checkbox" checked={checked} onChange={(e) => onToggle(key, e.target.checked)} />
                  <span style={{ color: overridden ? 'var(--color-brand)' : 'var(--color-text-secondary)', fontWeight: overridden ? 700 : 400 }}>
                    {a}{overridden ? ' *' : ''}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      ))}
      <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>
        <span style={{ color: 'var(--color-brand)', fontWeight: 700 }}>*</span> differs from the role default.
      </p>
    </div>
  );
}

// ── Add member ─────────────────────────────────────────────────────────────
function AddMemberModal({ groups, roles, onClose, onCreated }: { groups: PermGroup[]; roles: string[]; onClose: () => void; onCreated: (message: string) => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('PM');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    if (!name.trim()) return setError('Name is required.');
    if (!email.trim()) return setError('Email address is required.');
    if (password && password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');

    setSaving(true);
    try {
      const created = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          role,
          password: password || undefined,
        }),
      });
      onCreated(
        created.warning
          ? created.warning
          : password
            ? `${name.trim()} created. Share their password securely.`
            : `Invite sent to ${email.trim()} — they'll set their own password from the link.`
      );
    } catch (err: any) {
      setError(err.message || 'Failed to create member');
      setSaving(false);
    }
  };

  return (
    <Modal title="Add Member" onClose={onClose}>
      {error && <div className="page-error" style={{ padding: 'var(--space-sm)' }}>{error}</div>}
      <form onSubmit={submit} className="form-section">
        <div className="form-row">
          <label className="form-label">Full name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="form-row">
          <label className="form-label">Email address</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="member@company.com" />
        </div>
        <div className="form-row">
          <label className="form-label">Role</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            {roles.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label">Password (optional)</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="Leave blank to email a set-password link" />
        </div>
        <div className="form-row">
          <label className="form-label">Confirm password</label>
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </div>
        <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>
          The member starts with their role's default permissions. Fine-tune them after creating via the Edit button. (Groups available: {groups.length})
        </p>
        <div className="form-actions">
          <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="button primary" disabled={saving}>{saving ? 'Creating…' : 'Create member'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ── Edit member (profile + matrix) ─────────────────────────────────────────
function EditMemberModal({ memberId, groups, roles, onClose, onSaved }: { memberId: string; groups: PermGroup[]; roles: string[]; onClose: () => void; onSaved: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('PM');
  const [rolePreset, setRolePreset] = useState<Record<string, boolean>>({});
  const [effective, setEffective] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch(`/users/${memberId}`);
        setName(data.member.name);
        setEmail(data.member.email);
        setRole(data.member.role);
        setRolePreset(data.rolePermissions);
        setEffective(data.effectivePermissions);
      } catch (err: any) {
        setError(err.message || 'Failed to load member');
      } finally {
        setLoading(false);
      }
    })();
  }, [memberId]);

  const toggle = (key: string, value: boolean) => {
    setEffective((prev) => applyPermissionToggle(prev, key, value, groups));
  };

  const resetToDefaults = () => setEffective({ ...rolePreset });

  const save = async () => {
    setSaving(true);
    setError('');
    // Diff effective against the role preset → sparse overrides.
    const overrides: Record<string, boolean> = {};
    for (const key of Object.keys(effective)) {
      if (!!effective[key] !== !!rolePreset[key]) overrides[key] = !!effective[key];
    }
    try {
      await apiFetch(`/users/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          role,
          permissionOverrides: overrides,
        }),
      });
      onSaved();
    } catch (err: any) {
      setError(err.message || 'Failed to save member');
      setSaving(false);
    }
  };

  return (
    <Modal title="Edit Member" onClose={onClose} wide>
      {error && <div className="page-error" style={{ padding: 'var(--space-sm)' }}>{error}</div>}
      {loading ? (
        <p>Loading…</p>
      ) : (
        <div className="form-section">
          <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
            <div className="form-row" style={{ flex: 1, minWidth: 180 }}>
              <label className="form-label">Full name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="form-row" style={{ flex: 1, minWidth: 180 }}>
              <label className="form-label">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="form-row" style={{ minWidth: 140 }}>
              <label className="form-label">Role</label>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between" style={{ marginTop: 'var(--space-sm)' }}>
            <h4 className="flex items-center gap-2" style={{ margin: 0 }}><Shield size={18} /> Permissions</h4>
            <button type="button" className="button secondary" onClick={resetToDefaults}>Reset to role defaults</button>
          </div>
          <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>
            Changing the role changes the baseline. Save, then reopen to fine-tune against the new role's defaults.
          </p>

          <PermissionMatrix groups={groups} effective={effective} rolePreset={rolePreset} onToggle={toggle} />

          <div className="form-actions">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="button primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Reset password ─────────────────────────────────────────────────────────
function ResetPasswordModal({ memberId, memberName, onClose }: { memberId: string; memberName: string; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirm) return setError('Passwords do not match.');
    setSaving(true);
    try {
      await apiFetch(`/users/${memberId}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      setDone(true);
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
      setSaving(false);
    }
  };

  return (
    <Modal title={`Reset password — ${memberName}`} onClose={onClose}>
      {error && <div className="page-error" style={{ padding: 'var(--space-sm)' }}>{error}</div>}
      {done ? (
        <div className="form-section">
          <p className="text-secondary">Password updated. Share the new password securely with the member.</p>
          <div className="form-actions"><button className="button primary" onClick={onClose}>Done</button></div>
        </div>
      ) : (
        <form onSubmit={submit} className="form-section">
          <div className="form-row">
            <label className="form-label">New password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />
          </div>
          <div className="form-row">
            <label className="form-label">Confirm new password</label>
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
          </div>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Set password'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}