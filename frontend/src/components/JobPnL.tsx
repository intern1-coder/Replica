import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api';
import { shallowEqual, type FetchOptions } from '../utils/refetch';
import { useAuth } from '../contexts/AuthContext';

interface PnLData {
  id: string;
  jobNumber: string;
  revenue: number;
  laborCost: number;
  materialCost: number;
  profit: number;
}

const PNL_KEYS: (keyof PnLData)[] = ['id', 'jobNumber', 'revenue', 'laborCost', 'materialCost', 'profit'];

export function JobPnL({ jobId }: { jobId: string }) {
  const [pnl, setPnl] = useState<PnLData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const { socket, can, user } = useAuth();

  const loadPnL = useCallback(async (options?: FetchOptions) => {
    const background = options?.background ?? false;
    if (!background) {
      setIsLoading(true);
    }
    try {
      const data: PnLData = await apiFetch(`/pnl/jobs/${jobId}`);
      setPnl((prev) => (prev && shallowEqual(prev, data, PNL_KEYS) ? prev : data));
    } catch (err: any) {
      if (!background) {
        if (err.status === 403) {
          setError('You do not have permission to view financials.');
        } else {
          setError('Failed to load financials.');
        }
      }
    } finally {
      if (!background) {
        setIsLoading(false);
      }
    }
  }, [jobId]);

  const loadPnLRef = useRef(loadPnL);
  loadPnLRef.current = loadPnL;

  useEffect(() => {
    if (!can('financials:view')) {
      setError('You do not have permission to view financials.');
      setIsLoading(false);
      return;
    }
    loadPnL();
  }, [jobId, can, loadPnL]);

  useEffect(() => {
    if (!socket || !jobId) return;

    const handleWorkLog = (payload: { jobId: string; actorId?: string }) => {
      if (payload.jobId !== jobId) return;
      if (payload.actorId === user?.id) return;
      loadPnLRef.current({ background: true });
    };

    const handleJobEvent = (payload: { jobId: string }) => {
      if (payload.jobId !== jobId) return;
      loadPnLRef.current({ background: true });
    };

    socket.on('workLog:created', handleWorkLog);
    socket.on('job:statusChanged', handleJobEvent);
    socket.on('lineItems:changed', handleJobEvent);
    return () => {
      socket.off('workLog:created', handleWorkLog);
      socket.off('job:statusChanged', handleJobEvent);
      socket.off('lineItems:changed', handleJobEvent);
    };
  }, [socket, jobId, user?.id]);

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
