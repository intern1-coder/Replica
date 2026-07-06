import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api';
import { mergeById, type FetchOptions } from '../utils/refetch';
import type { Job } from '../pages/JobList';
import CreatableSelect from 'react-select/creatable';
import { getReactSelectStyles, reactSelectMenuProps } from '../utils/reactSelectTheme';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';

interface QuoteLineItem {
  id: string;
  description: string;
  price: string | number;
  status: string;
}

// Splits an ISO timestamp into separate date/time strings for the HTML inputs.
// Uses local time (not UTC) so the displayed date matches the user's timezone.
function parseScheduledLocal(iso?: string | null) {
  if (!iso) return { date: '', time: '' };
  const d = new Date(iso);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { date, time };
}

function contractorsEqual(
  a: { id: string; name: string }[] | undefined,
  b: { id: string; name: string }[] | undefined
): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((c, i) => c.id === right[i]?.id && c.name === right[i]?.name);
}

function jobFormFieldsEqual(a: Job, b: Job): boolean {
  return (
    (a.description || '') === (b.description || '') &&
    (a.materials || '') === (b.materials || '') &&
    (a.scheduledDate ?? null) === (b.scheduledDate ?? null) &&
    contractorsEqual(a.assignedContractors, b.assignedContractors)
  );
}
function formatScheduledDisplay(iso?: string | null) {
  if (!iso) return { dateLabel: 'TBD', timeLabel: 'TBD' };
  const d = new Date(iso);
  return {
    dateLabel: d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    timeLabel: d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
  };
}

export function JobEditDetails({ job, onUpdated }: { job: Job; onUpdated: () => void }) {
  const { showToast } = useToast();
  const { socket, user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [description, setDescription] = useState(job.description || '');
  const [materials, setMaterials] = useState(job.materials || '');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');

  const [selectedContractors, setSelectedContractors] = useState<{ label: string; value: string }[]>(
    job.assignedContractors?.map((c) => ({ label: c.name, value: c.id })) || []
  );
  const [availableContractors, setAvailableContractors] = useState<{ id: string; name: string }[]>([]);

  const [lineItems, setLineItems] = useState<QuoteLineItem[]>([]);
  const [deletedLineItemIds, setDeletedLineItemIds] = useState<string[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);

  const jobFormSnapshot = useRef(job);

  const resetFormFromJob = useCallback((j: Job) => {
    const { date, time } = parseScheduledLocal(j.scheduledDate);
    setScheduledDate(date);
    setScheduledTime(time);
    setDescription(j.description || '');
    setMaterials(j.materials || '');
    setSelectedContractors(j.assignedContractors?.map((c) => ({ label: c.name, value: c.id })) || []);
    setDeletedLineItemIds([]);
  }, []);

  const loadLineItems = useCallback(async (options?: FetchOptions) => {
    const background = options?.background ?? false;
    if (!background) {
      setIsLoadingItems(true);
    }
    try {
      const res = await apiFetch(`/jobs/${job.id}/line-items`);
      setLineItems((prev) => mergeById(prev, res || []));
    } catch (err) {
      console.error(err);
    } finally {
      if (!background) {
        setIsLoadingItems(false);
      }
    }
  }, [job.id]);

  const loadLineItemsRef = useRef(loadLineItems);
  loadLineItemsRef.current = loadLineItems;

  useEffect(() => {
    loadLineItems();
  }, [loadLineItems]);

  useEffect(() => {
    if (!socket) return;
    const handler = (payload: {
      jobId: string;
      actorId?: string;
      lineItems?: QuoteLineItem[];
      lineItem?: QuoteLineItem;
      deletedLineItemId?: string;
    }) => {
      if (payload.jobId !== job.id) return;
      if (payload.actorId === user?.id) return;
      if (isEditing) return;
      if (payload.lineItems) {
        setLineItems((prev) => mergeById(prev, payload.lineItems!));
        return;
      }
      if (payload.lineItem) {
        setLineItems((prev) => mergeById(prev, [payload.lineItem!]));
        return;
      }
      if (payload.deletedLineItemId) {
        setLineItems((prev) => prev.filter((item) => item.id !== payload.deletedLineItemId));
        return;
      }
      loadLineItemsRef.current({ background: true });
    };
    socket.on('lineItems:changed', handler);
    return () => { socket.off('lineItems:changed', handler); };
  }, [socket, job.id, user?.id, isEditing]);

  useEffect(() => {
    if (isEditing) return;
    if (jobFormFieldsEqual(jobFormSnapshot.current, job)) return;
    jobFormSnapshot.current = job;
    resetFormFromJob(job);
  }, [job, isEditing, resetFormFromJob]);

  useEffect(() => {
    if (isEditing) {
      loadContractors();
    }
  }, [isEditing]);

  const loadContractors = async () => {
    try {
      const res = await apiFetch('/engineers');
      setAvailableContractors(res);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateContractor = async (inputValue: string) => {
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/engineers', {
        method: 'POST',
        body: JSON.stringify({ name: inputValue }),
      });
      setAvailableContractors((prev) => [...prev, res]);
      setSelectedContractors((prev) => [...prev, { label: res.name, value: res.id }]);
    } catch (err: any) {
      setError('Failed to create contractor: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEdit = () => {
    resetFormFromJob(job);
    setIsEditing(true);
  };

  const handleCancel = () => {
    resetFormFromJob(job);
    loadLineItems();
    setIsEditing(false);
    setError('');
  };

  const addLineItem = () => {
    // `temp-` prefix marks unsaved rows — handleSave uses this to decide POST vs PATCH.
    setLineItems([...lineItems, { id: `temp-${Date.now()}`, description: '', price: 0, status: 'COMPLETED' }]);
  };

  const removeLineItem = (id: string) => {
    if (!id.startsWith('temp-')) {
      setDeletedLineItemIds([...deletedLineItemIds, id]);
    }
    setLineItems(lineItems.filter((item) => item.id !== id));
  };

  const updateLineItem = (id: string, field: keyof QuoteLineItem, value: string | number) => {
    setLineItems(lineItems.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        description,
        materials,
        assignedContractorIds: selectedContractors.map((c) => c.value),
      };

      if (scheduledDate) {
        payload.scheduledDate = new Date(`${scheduledDate}T${scheduledTime || '00:00'}`).toISOString();
      } else if (job.scheduledDate) {
        payload.scheduledDate = null;
      }

      await apiFetch(`/jobs/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      for (const id of deletedLineItemIds) {
        await apiFetch(`/jobs/${job.id}/line-items/${id}`, { method: 'DELETE' });
      }

      for (const item of lineItems) {
        if (item.id.startsWith('temp-')) {
          await apiFetch(`/jobs/${job.id}/line-items`, {
            method: 'POST',
            body: JSON.stringify({ description: item.description, price: Number(item.price) || 0, status: item.status }),
          });
        } else {
          await apiFetch(`/jobs/${job.id}/line-items/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ description: item.description, price: Number(item.price) || 0, status: item.status }),
          });
        }
      }

      setIsEditing(false);
      setDeletedLineItemIds([]);
      await loadLineItems();
      onUpdated();
      showToast('Job details saved', 'success');
    } catch (err: any) {
      setError(err.message || 'Failed to update job');
      showToast(err.message || 'Failed to update job', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalNetPrice = lineItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const { dateLabel, timeLabel } = formatScheduledDisplay(job.scheduledDate);

  if (!isEditing) {
    return (
      <div className="section-card">
        <div className="section-card-header flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', margin: 0 }}>Job Details & Contractors</h3>
          <button onClick={openEdit} className="button secondary small">Edit</button>
        </div>

        <div className="form-row" style={{ marginBottom: 'var(--space-md)' }}>
          <p style={{ margin: 0 }}>
            <strong>Engineers:</strong>{' '}
            <span className="text-secondary">
              {job.assignedContractors && job.assignedContractors.length > 0
                ? job.assignedContractors.map((c) => c.name).join(', ')
                : 'Unassigned'}
            </span>
          </p>
        </div>
        <div className="form-row" style={{ marginBottom: 'var(--space-md)' }}>
          <p style={{ margin: 0 }}>
            <strong>Job Date:</strong> <span className="text-secondary">{dateLabel}</span>
            {' · '}
            <strong>Time:</strong> <span className="text-secondary">{timeLabel}</span>
          </p>
          {!job.scheduledDate && (
            <p className="text-secondary" style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem' }}>
              No date set — required before generating Job Sheet. Click Edit to set.
            </p>
          )}
        </div>

        <div>
          <strong style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Diagnostic & Completion Report (Quote)</strong>
          {isLoadingItems ? (
            <p>Loading...</p>
          ) : (
            <table className="dense-table" style={{ width: '100%', marginBottom: 'var(--space-sm)' }}>
              <thead>
                <tr>
                  <th style={{ width: '70%' }}>Description</th>
                  <th style={{ textAlign: 'right', width: '30%' }}>Quote Price</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="empty-state text-center" style={{ border: 'none' }}>
                      No line items added yet.
                    </td>
                  </tr>
                ) : (
                  lineItems.map((item) => (
                    <tr key={item.id}>
                      <td className="font-medium">{item.description}</td>
                      <td className="tabular-nums" style={{ textAlign: 'right', fontWeight: '500' }}>
                        £{Number(item.price).toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
                <tr style={{ background: 'var(--color-bg)' }}>
                  <td style={{ textAlign: 'right', fontWeight: 'bold' }}>TOTAL NET Price:</td>
                  <td className="tabular-nums text-primary" style={{ textAlign: 'right', fontWeight: 'bold' }}>
                    £{totalNetPrice.toFixed(2)}
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </div>

        {job.description && (
          <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-sm)', borderTop: '1px dashed var(--color-border)' }}>
            <strong>Internal General Description / Notes:</strong>
            <p className="text-secondary" style={{ whiteSpace: 'pre-wrap', marginTop: '0.25rem', margin: 0 }}>{job.description}</p>
          </div>
        )}

        <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-sm)', borderTop: '1px dashed var(--color-border)' }}>
          <strong>Materials:</strong>
          <p className="text-secondary" style={{ marginTop: '0.25rem', margin: 0 }}>{job.materials || 'N/A'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="section-card form-section">
      <div className="section-card-header">
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Edit Job Details</h3>
      </div>

      {error && <div className="page-error">{error}</div>}

      <div className="form-row">
        <label className="form-label">Job Date & Time</label>
        <p className="text-secondary" style={{ margin: '0 0 0.25rem', fontSize: '0.8125rem' }}>
          Required for Job Sheet generation
        </p>
        <div className="flex gap-2">
          <input
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            style={{ flex: 1 }}
            disabled={isSubmitting}
          />
          <input
            type="time"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            style={{ width: '120px' }}
            disabled={isSubmitting}
          />
        </div>
      </div>

      <div className="form-row">
        <label className="form-label">Assigned Engineers</label>
        <CreatableSelect
          isMulti
          isDisabled={isSubmitting}
          isLoading={isSubmitting}
          onChange={(newValue: any) => setSelectedContractors(newValue || [])}
          onCreateOption={handleCreateContractor}
          options={availableContractors.map((c) => ({ label: c.name, value: c.id }))}
          value={selectedContractors}
          placeholder="Select or type to create..."
          styles={getReactSelectStyles()}
          {...reactSelectMenuProps}
        />
      </div>

      <div className="form-row">
        <div className="flex justify-between items-center" style={{ marginBottom: 'var(--space-sm)' }}>
          <label className="form-label" style={{ margin: 0 }}>Quote Line Items</label>
          <button type="button" onClick={addLineItem} className="button secondary small">+ Add Row</button>
        </div>

        <table className="dense-table" style={{ width: '100%', marginBottom: 'var(--space-sm)' }}>
          <thead>
            <tr>
              <th style={{ width: '70%' }}>Description</th>
              <th style={{ width: '20%' }}>Quote Price (£)</th>
              <th style={{ width: '10%', textAlign: 'center' }}></th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((item) => (
              <tr key={item.id}>
                <td>
                  <input
                    type="text"
                    value={item.description}
                    onChange={(e) => updateLineItem(item.id, 'description', e.target.value)}
                    style={{ width: '100%', padding: '0.3rem' }}
                    placeholder="E.g. Change door knob"
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.price}
                    onChange={(e) => updateLineItem(item.id, 'price', e.target.value)}
                    style={{ width: '100%', padding: '0.3rem' }}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button type="button" onClick={() => removeLineItem(item.id)} className="button danger small" style={{ padding: '0.2rem 0.5rem' }}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {lineItems.length === 0 && (
              <tr>
                <td colSpan={3} className="empty-state text-center" style={{ border: 'none' }}>
                  Click "+ Add Row" to add quote line items.
                </td>
              </tr>
            )}
            <tr style={{ background: 'var(--color-bg)' }}>
              <td style={{ textAlign: 'right', fontWeight: 'bold' }}>TOTAL NET Price:</td>
              <td colSpan={2} className="tabular-nums" style={{ fontWeight: 'bold' }}>
                £{totalNetPrice.toFixed(2)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="form-row">
        <label className="form-label">Materials (for Job Sheet)</label>
        <input
          type="text"
          value={materials}
          onChange={(e) => setMaterials(e.target.value)}
          style={{ width: '100%' }}
          placeholder="E.g. Door knob, hinges, screws. Leave blank for N/A."
        />
      </div>

      <div className="form-row">
        <label className="form-label">Internal General Notes (Optional)</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          style={{ width: '100%' }}
          placeholder="Any internal notes that shouldn't appear on the quote..."
        />
      </div>

      <div className="form-actions">
        <button onClick={handleSave} className="button primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save Changes'}
        </button>
        <button onClick={handleCancel} className="button secondary" disabled={isSubmitting}>
          Cancel
        </button>
      </div>
    </div>
  );
}
