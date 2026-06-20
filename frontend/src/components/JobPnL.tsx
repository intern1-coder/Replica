import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';

interface PnLData {
  id: string;
  jobNumber: string;
  revenue: number;
  laborCost: number;
  materialCost: number;
  profit: number;
}

export function JobPnL({ jobId }: { jobId: string }) {
  const [pnl, setPnl] = useState<PnLData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const { socket } = useAuth();

  useEffect(() => {
    loadPnL();
  }, [jobId]);

  // Realtime updates when work logs are added
  useEffect(() => {
    if (!socket || !jobId) return;
    const handleRefresh = (payload: { jobId: string }) => {
      if (payload.jobId === jobId) {
        loadPnL();
      }
    };
    socket.on('workLog:created', handleRefresh);
    socket.on('job:statusChanged', handleRefresh);
    return () => {
      socket.off('workLog:created', handleRefresh);
      socket.off('job:statusChanged', handleRefresh);
    };
  }, [socket, jobId]);

  const loadPnL = async () => {
    setIsLoading(true);
    try {
      const data: PnLData = await apiFetch(`/pnl/jobs/${jobId}`);
      setPnl(data);
    } catch (err: any) {
      if (err.status === 403) {
         setError('You do not have permission to view financials.');
      } else {
         setError('Failed to load financials.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) return <p>Loading financials...</p>;
  if (error) return <div style={{ color: 'var(--status-cancelled-text)' }}>{error}</div>;
  if (!pnl) return <p>No financial data available yet.</p>;

  const totalCost = pnl.laborCost + pnl.materialCost;

  return (
    <div style={{ background: 'var(--surface-color)', padding: 'var(--spacing-md)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)', marginTop: 'var(--spacing-md)' }}>
      <h3 style={{ fontSize: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--spacing-sm)', marginBottom: 'var(--spacing-sm)' }}>Financials (P&L)</h3>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--spacing-md)' }}>
        <div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total Revenue (Quoted)</div>
          <div className="tabular-nums" style={{ fontSize: '1.2rem', fontWeight: 600 }}>£{Number(pnl.revenue || 0).toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total Cost</div>
          <div className="tabular-nums" style={{ fontSize: '1.2rem', fontWeight: 600 }}>£{Number(totalCost || 0).toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Labor Cost</div>
          <div className="tabular-nums" style={{ fontSize: '1.1rem' }}>£{Number(pnl.laborCost || 0).toFixed(2)}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Profit</div>
          <div className="tabular-nums" style={{ fontSize: '1.2rem', fontWeight: 600, color: (pnl.profit || 0) >= 0 ? 'var(--status-authorised-text)' : 'var(--status-cancelled-text)' }}>
            £{Number(pnl.profit || 0).toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}
