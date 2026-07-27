import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import { Save } from 'lucide-react';

export function AdminSettings() {
  const [vatPercent, setVatPercent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // API stores VAT as a fraction (e.g. 0.2) but the UI shows percentages (e.g. 20).
    // Multiply by 100 on load, divide by 100 on save.
    apiFetch('/settings/vat-rate')
      .then((data) => {
        setVatPercent((data.vatRate * 100).toString());
      })
      .catch(() => setError('Failed to load settings.'))
      .finally(() => setIsLoading(false));
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    setError('');
    setSuccess('');
    const vatRate = parseFloat(vatPercent) / 100;
    if (isNaN(vatRate) || vatRate < 0 || vatRate > 1) {
      setError('VAT must be between 0% and 100%.');
      setIsSaving(false);
      return;
    }
    try {
      await apiFetch('/settings/vat-rate', {
        method: 'PATCH',
        body: JSON.stringify({ vatRate }),
      });
      setSuccess('VAT rate updated successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to save settings.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div className="section-card" style={{ maxWidth: '480px' }}>
        <div className="section-card-header">
          <h3 style={{ fontSize: '1rem', margin: 0 }}>Tax Configuration</h3>
        </div>

        {isLoading ? (
          <p>Loading…</p>
        ) : (
          <div style={{ padding: 'var(--space-md)' }}>
            {error && <div className="page-error" style={{ marginBottom: 'var(--space-md)' }}>{error}</div>}
            {success && (
              <div style={{ padding: '0.75rem', backgroundColor: '#d1fae5', color: '#065f46', borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-md)', fontSize: '0.875rem' }}>
                {success}
              </div>
            )}

            <div className="form-row">
              <label className="form-label">VAT Rate (%)</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={vatPercent}
                  onChange={(e) => setVatPercent(e.target.value)}
                  style={{ width: '120px' }}
                  disabled={isSaving}
                />
                <span className="text-secondary" style={{ fontSize: '0.875rem' }}>%</span>
              </div>
              <p className="text-muted" style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
                Applied to all new Diagnostic Report and Completion Report PDFs. Existing PDFs retain the rate they were generated with.
              </p>
            </div>

            <button
              onClick={handleSave}
              className="button primary flex items-center gap-2"
              disabled={isSaving}
            >
              <Save size={16} />
              {isSaving ? 'Saving…' : 'Save Settings'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
