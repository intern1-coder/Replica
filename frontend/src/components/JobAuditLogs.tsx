import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { ChevronDown, ChevronRight, Code2 } from 'lucide-react';

interface AuditLog {
  id: string;
  entityType: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE';
  performedById: string;
  before: any | null;
  after: any | null;
  createdAt: string;
  performedBy?: { name: string };
}

const FIELD_LABELS: Record<string, string> = {
  status: 'Status',
  scheduledDate: 'Scheduled Date',
  description: 'Description',
  materials: 'Materials',
  diagnosticNotes: 'Diagnostic Notes',
  completionNotes: 'Completion Notes',
  quotedValue: 'Quoted Value',
  tenantSnapshotName: 'Tenant Name',
  tenantSnapshotPhone: 'Tenant Phone',
  clientId: 'Client',
  propertyId: 'Property',
  tenantId: 'Tenant',
  currentClientId: 'Assigned Client',
  address: 'Address',
  accessNotes: 'Access Notes',
  keyLocation: 'Key Location',
  assignedContractors: 'Assigned Engineers',
  // WorkLog fields
  hoursWorked: 'Hours Worked',
  rateApplied: 'Rate Applied',
  materialCost: 'Material Cost',
  workDate: 'Work Date',
  notes: 'Notes',
  contractor: 'Engineer',
  loggedBy: 'Logged By',
};

function formatAuditValue(key: string, val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Yes' : 'No';

  // Arrays: join display names
  if (Array.isArray(val)) {
    if (val.length === 0) return '—';
    return val
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>;
          return String(obj.name || obj.address || obj.id || JSON.stringify(item));
        }
        return String(item);
      })
      .join(', ');
  }

  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (obj.name) return String(obj.name);
    if (obj.address) return String(obj.address);
    return JSON.stringify(val);
  }

  if (key.toLowerCase().includes('date') || key === 'createdAt' || key === 'updatedAt' || key === 'completedAt') {
    const d = new Date(String(val));
    if (!isNaN(d.getTime())) return d.toLocaleString('en-GB');
  }

  const str = String(val);
  if (str.length === 36 && str.split('-').length === 5) return '(updated)';
  return str.replace(/_/g, ' ') || '—';
}

function getFieldLabel(key: string): string {
  return FIELD_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

const CREATE_SUMMARY_KEYS = ['status', 'client', 'property', 'tenant', 'tenantSnapshotName', 'tenantSnapshotPhone', 'address', 'description'];

function CreateSummary({ after }: { after: Record<string, unknown> }) {
  const entries: { label: string; value: string }[] = [];
  for (const key of CREATE_SUMMARY_KEYS) {
    if (after[key] !== undefined && after[key] !== null && after[key] !== '') {
      entries.push({ label: getFieldLabel(key), value: formatAuditValue(key, after[key]) });
    }
  }
  if (entries.length === 0) return null;
  return (
    <dl className="audit-summary-list">
      {entries.map(({ label, value }) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// Raw FK fields are excluded from diff display because the snapshot also carries
// the resolved relation object (e.g. clientId is skipped; client.name is shown).
const SKIP_DIFF_KEYS = new Set([
  'updatedAt', 'createdAt', 'version', 'deletedAt', 'completedAt',
  'clientId', 'propertyId', 'tenantId', 'performedById',
  'contractorId', 'loggedById',
  'id', 'jobId', 'entityId',
]);

// Normalise both null and undefined to JSON null so a missing key in `before`
// and an explicit null in `after` don't generate a spurious phantom diff entry.
const diffKey = (val: unknown) => JSON.stringify(val ?? null);

function ChangeTable({ before, after }: { before: Record<string, unknown>; after: Record<string, unknown> }) {
  const changes: { field: string; before: string; after: string }[] = [];
  for (const key of Object.keys(after)) {
    if (SKIP_DIFF_KEYS.has(key)) continue;
    if (diffKey(before[key]) !== diffKey(after[key])) {
      changes.push({
        field: getFieldLabel(key),
        before: formatAuditValue(key, before[key]),
        after: formatAuditValue(key, after[key]),
      });
    }
  }
  if (changes.length === 0) {
    return <span className="text-muted" style={{ fontSize: '0.8125rem' }}>No significant changes recorded.</span>;
  }
  return (
    <table className="audit-changes-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Before</th>
          <th>After</th>
        </tr>
      </thead>
      <tbody>
        {changes.map((c) => (
          <tr key={c.field}>
            <td>{c.field}</td>
            <td>{c.before}</td>
            <td>{c.after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function JobAuditLogs({ jobId }: { jobId: string }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [technicalLogId, setTechnicalLogId] = useState<string | null>(null);
  const [hasPermission, setHasPermission] = useState(true);

  useEffect(() => {
    // Pre-flight role check from the JWT payload avoids a guaranteed 403 round-trip.
    // The backend still enforces the same restriction; this is purely UX.
    const token = localStorage.getItem('affinity_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.role !== 'ADMIN' && payload.role !== 'OWNER' && payload.role !== 'PM') {
          setHasPermission(false);
          setIsLoading(false);
          return;
        }
      } catch (e) {
        console.error('Failed to parse token', e);
      }
    }
    loadLogs();
  }, [jobId]);

  const loadLogs = async () => {
    try {
      const response = await apiFetch(`/audit-logs?jobId=${jobId}`);
      const data = response.data || [];
      setLogs(data);
    } catch (err: any) {
      if (err.status === 403) {
        setError('You do not have permission to view audit logs.');
      } else {
        setError('Failed to load audit logs.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const toggleEntry = (id: string) => {
    if (expandedLogId === id) {
      setExpandedLogId(null);
      setTechnicalLogId(null);
    } else {
      setExpandedLogId(id);
      setTechnicalLogId(null);
    }
  };

  const generateHumanReadableDiff = (log: AuditLog) => {
    if (log.action === 'CREATE') return `Created new ${log.entityType}.`;
    if (log.action === 'DELETE') return `Deleted ${log.entityType}.`;
    if (log.action === 'UPDATE') {
      if (!log.before || !log.after) return `Updated ${log.entityType}.`;
      const changeCount = Object.keys(log.after).filter(
        (k) => !SKIP_DIFF_KEYS.has(k) && diffKey(log.before[k]) !== diffKey(log.after[k])
      ).length;
      if (changeCount === 0) return `Updated ${log.entityType} (no significant changes).`;
      return `${changeCount} field${changeCount === 1 ? '' : 's'} changed`;
    }
    return `${log.action} on ${log.entityType}`;
  };

  if (!hasPermission) return null;

  return (
    <div className="section-card audit-trail-section">
      <div className="section-card-header">
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Audit Trail (Immutable)</h3>
        {logs.length > 0 && (
          <span className="text-muted" style={{ fontSize: '0.8125rem' }}>{logs.length} events</span>
        )}
      </div>

      {error && <div className="page-error">{error}</div>}

      {isLoading && !error ? (
        <p>Loading audit trail...</p>
      ) : !error && (
        <div className="audit-trail-list">
          {logs.map((log) => {
            const isExpanded = expandedLogId === log.id;
            const showJson = technicalLogId === log.id;
            return (
              <div key={log.id} className={`audit-entry${isExpanded ? ' audit-entry-open' : ''}`}>
                <button
                  type="button"
                  className="audit-entry-header"
                  onClick={() => toggleEntry(log.id)}
                  aria-expanded={isExpanded}
                >
                  <span className="audit-entry-chevron">
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                  <span className={`status-badge ${log.action === 'DELETE' ? 'cancelled' : log.action === 'CREATE' ? 'authorised' : 'quoted'}`}>
                    {log.action}
                  </span>
                  <strong>{log.entityType}</strong>
                  <span className="text-secondary audit-entry-summary">{generateHumanReadableDiff(log)}</span>
                  <span className="text-muted audit-entry-meta">
                    {log.performedBy?.name || 'Unknown'} · {new Date(log.createdAt).toLocaleString()}
                  </span>
                </button>

                {isExpanded && (
                  <div className="audit-entry-body">
                    {log.action === 'CREATE' && log.after && <CreateSummary after={log.after} />}
                    {log.action === 'UPDATE' && log.before && log.after && (
                      <ChangeTable before={log.before} after={log.after} />
                    )}

                    <button
                      type="button"
                      className="audit-json-toggle"
                      onClick={() => setTechnicalLogId(showJson ? null : log.id)}
                    >
                      <Code2 size={14} />
                      {showJson ? 'Hide JSON' : 'View JSON'}
                    </button>

                    {showJson && (
                      <div className="detail-grid audit-json-grid">
                        <div className="audit-json-block">
                          <strong>Before</strong>
                          <pre>{log.before ? JSON.stringify(log.before, null, 2) : 'null'}</pre>
                        </div>
                        <div className="audit-json-block">
                          <strong>After</strong>
                          <pre>{log.after ? JSON.stringify(log.after, null, 2) : 'null'}</pre>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {logs.length === 0 && <p className="text-secondary empty-state" style={{ border: 'none' }}>No audit events found.</p>}
        </div>
      )}
    </div>
  );
}
