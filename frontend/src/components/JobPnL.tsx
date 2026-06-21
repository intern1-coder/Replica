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
  if (error) return <div className="page-error">{error}</div>;
  if (!pnl) return <p>No financial data available yet.</p>;

  const totalCost = pnl.laborCost + pnl.materialCost;

  return (
    <div className="section-card">
      <div className="section-card-header">
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Financials (P&L)</h3>
      </div>
      
      <div className="detail-grid">
        <div className="section-card" style={{ marginBottom: 0 }}>
          <div className="text-secondary" style={{ fontSize: '0.8rem' }}>Total Revenue (Quoted)</div>
          <div className="tabular-nums font-medium" style={{ fontSize: '1.2rem' }}>£{Number(pnl.revenue || 0).toFixed(2)}</div>
        </div>
        <div className="section-card" style={{ marginBottom: 0 }}>
          <div className="text-secondary" style={{ fontSize: '0.8rem' }}>Total Cost</div>
          <div className="tabular-nums font-medium" style={{ fontSize: '1.2rem' }}>£{Number(totalCost || 0).toFixed(2)}</div>
        </div>
        <div className="section-card" style={{ marginBottom: 0 }}>
          <div className="text-secondary" style={{ fontSize: '0.8rem' }}>Labor Cost</div>
          <div className="tabular-nums font-medium" style={{ fontSize: '1.1rem' }}>£{Number(pnl.laborCost || 0).toFixed(2)}</div>
        </div>
        <div className="section-card" style={{ marginBottom: 0 }}>
          <div className="text-secondary" style={{ fontSize: '0.8rem' }}>Profit</div>
          <div className="tabular-nums font-medium" style={{ fontSize: '1.2rem', color: (pnl.profit || 0) >= 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
            £{Number(pnl.profit || 0).toFixed(2)}
          </div>
        </div>
      </div>
    </div>
  );
}
