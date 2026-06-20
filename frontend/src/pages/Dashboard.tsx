

export function Dashboard() {
  return (
    <div>
      <h1 style={{ marginBottom: '0.5rem' }}>Dashboard</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-lg)' }}>
        Welcome to the Affinity Workspace.
      </p>

      <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--status-authorised-bg)', color: 'var(--status-authorised-text)', borderRadius: 'var(--border-radius)', display: 'inline-block' }}>
        <strong>Authentication Successful!</strong> You are securely logged in. Phase 1 Frontend is complete.
      </div>
    </div>
  );
}
