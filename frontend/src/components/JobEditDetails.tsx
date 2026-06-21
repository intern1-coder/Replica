import { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';
import type { Job } from '../pages/JobList';
import CreatableSelect from 'react-select/creatable';

interface QuoteLineItem {
  id: string;
  description: string;
  price: string | number;
  status: string;
}

export function JobEditDetails({ job, onUpdated }: { job: Job, onUpdated: () => void }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [description, setDescription] = useState(job.description || '');
  const [materials, setMaterials] = useState(job.materials || '');
  
  // React-select multi-select expects an array of objects
  const [selectedContractors, setSelectedContractors] = useState<{label: string, value: string}[]>(
    job.assignedContractors?.map(c => ({ label: c.name, value: c.id })) || []
  );
  const [availableContractors, setAvailableContractors] = useState<{id: string, name: string}[]>([]);

  // Line Items State
  const [lineItems, setLineItems] = useState<QuoteLineItem[]>([]);
  const [deletedLineItemIds, setDeletedLineItemIds] = useState<string[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(true);

  useEffect(() => {
    loadLineItems();
  }, [job.id]);

  useEffect(() => {
    if (isEditing) {
      loadContractors();
    }
  }, [isEditing]);

  const loadLineItems = async () => {
    setIsLoadingItems(true);
    try {
      const res = await apiFetch(`/jobs/${job.id}/line-items`);
      setLineItems(res || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingItems(false);
    }
  };

  const loadContractors = async () => {
    try {
      const res = await apiFetch('/users?role=CONTRACTOR');
      setAvailableContractors(res);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateContractor = async (inputValue: string) => {
    setIsSubmitting(true);
    try {
      const res = await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({ name: inputValue, role: 'CONTRACTOR' })
      });
      setAvailableContractors(prev => [...prev, res]);
      setSelectedContractors(prev => [...prev, { label: res.name, value: res.id }]);
    } catch (err: any) {
      setError('Failed to create contractor: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const addLineItem = () => {
    setLineItems([...lineItems, { id: `temp-${Date.now()}`, description: '', price: 0, status: 'COMPLETED' }]);
  };

  const removeLineItem = (id: string) => {
    if (!id.startsWith('temp-')) {
      setDeletedLineItemIds([...deletedLineItemIds, id]);
    }
    setLineItems(lineItems.filter(item => item.id !== id));
  };

  const updateLineItem = (id: string, field: keyof QuoteLineItem, value: string | number) => {
    setLineItems(lineItems.map(item => item.id === id ? { ...item, [field]: value } : item));
  };

  const handleSave = async () => {
    setIsSubmitting(true);
    setError('');
    try {
      // 1. Update Job Details (Contractors & internal Description)
      await apiFetch(`/jobs/${job.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          description,
          materials,
          assignedContractorIds: selectedContractors.map(c => c.value)
        })
      });

      // 2. Process Line Items Deletions
      for (const id of deletedLineItemIds) {
        await apiFetch(`/jobs/${job.id}/line-items/${id}`, { method: 'DELETE' });
      }

      // 3. Process Line Items Additions & Updates
      for (const item of lineItems) {
        if (item.id.startsWith('temp-')) {
          await apiFetch(`/jobs/${job.id}/line-items`, {
            method: 'POST',
            body: JSON.stringify({ description: item.description, price: Number(item.price) || 0, status: item.status })
          });
        } else {
          await apiFetch(`/jobs/${job.id}/line-items/${item.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ description: item.description, price: Number(item.price) || 0, status: item.status })
          });
        }
      }

      setIsEditing(false);
      setDeletedLineItemIds([]);
      await loadLineItems(); // Reload fresh IDs from server
      onUpdated();
    } catch (err: any) {
      setError(err.message || 'Failed to update job');
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalNetPrice = lineItems.reduce((sum, item) => sum + (Number(item.price) || 0), 0);

  if (!isEditing) {
    return (
      <div className="section-card">
        <div className="section-card-header flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
          <h3 style={{ fontSize: '1rem', margin: 0 }}>Job Details & Contractors</h3>
          <button onClick={() => setIsEditing(true)} className="button secondary small">Edit</button>
        </div>
        
        <div className="form-row" style={{ marginBottom: 'var(--space-md)' }}>
          <p style={{ margin: 0 }}><strong>Contractors:</strong> <span className="text-secondary">{job.assignedContractors && job.assignedContractors.length > 0 ? job.assignedContractors.map(c => c.name).join(', ') : 'Unassigned'}</span></p>
        </div>

        <div>
          <strong style={{ display: 'block', marginBottom: 'var(--space-sm)' }}>Diagnostic & Completion Report (Quote)</strong>
          {isLoadingItems ? <p>Loading...</p> : (
            <table className="dense-table" style={{ width: '100%', marginBottom: 'var(--space-sm)' }}>
              <thead>
                <tr>
                  <th style={{ width: '70%' }}>Description</th>
                  <th style={{ textAlign: 'right', width: '30%' }}>Quote Price</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.length === 0 ? (
                  <tr><td colSpan={2} className="empty-state text-center" style={{ border: 'none' }}>No line items added yet.</td></tr>
                ) : (
                  lineItems.map(item => (
                    <tr key={item.id}>
                      <td className="font-medium">{item.description}</td>
                      <td className="tabular-nums" style={{ textAlign: 'right', fontWeight: '500' }}>£{Number(item.price).toFixed(2)}</td>
                    </tr>
                  ))
                )}
                <tr style={{ background: 'var(--color-bg)' }}>
                  <td style={{ textAlign: 'right', fontWeight: 'bold' }}>TOTAL NET Price:</td>
                  <td className="tabular-nums text-primary" style={{ textAlign: 'right', fontWeight: 'bold' }}>£{totalNetPrice.toFixed(2)}</td>
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
        <label className="form-label">Assigned Contractors</label>
        <CreatableSelect
          isMulti
          isDisabled={isSubmitting}
          isLoading={isSubmitting}
          onChange={(newValue: any) => setSelectedContractors(newValue || [])}
          onCreateOption={handleCreateContractor}
          options={availableContractors.map(c => ({ label: c.name, value: c.id }))}
          value={selectedContractors}
          placeholder="Select or type to create..."
          styles={{ container: (base) => ({ ...base, width: '100%' }) }}
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
            {lineItems.map(item => (
              <tr key={item.id}>
                <td>
                  <input 
                    type="text" 
                    value={item.description} 
                    onChange={e => updateLineItem(item.id, 'description', e.target.value)} 
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
                    onChange={e => updateLineItem(item.id, 'price', e.target.value)} 
                    style={{ width: '100%', padding: '0.3rem' }} 
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button type="button" onClick={() => removeLineItem(item.id)} className="button danger small" style={{ padding: '0.2rem 0.5rem' }}>✕</button>
                </td>
              </tr>
            ))}
            {lineItems.length === 0 && (
              <tr><td colSpan={3} className="empty-state text-center" style={{ border: 'none' }}>Click "+ Add Row" to add quote line items.</td></tr>
            )}
            <tr style={{ background: 'var(--color-bg)' }}>
              <td style={{ textAlign: 'right', fontWeight: 'bold' }}>TOTAL NET Price:</td>
              <td colSpan={2} className="tabular-nums" style={{ fontWeight: 'bold' }}>£{totalNetPrice.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="form-row">
        <label className="form-label">Materials (for Job Sheet)</label>
        <input 
          type="text"
          value={materials} 
          onChange={e => setMaterials(e.target.value)} 
          style={{ width: '100%' }} 
          placeholder="E.g. Door knob, hinges, screws. Leave blank for N/A."
        />
      </div>

      <div className="form-row">
        <label className="form-label">Internal General Notes (Optional)</label>
        <textarea 
          value={description} 
          onChange={e => setDescription(e.target.value)} 
          rows={3} 
          style={{ width: '100%' }} 
          placeholder="Any internal notes that shouldn't appear on the quote..."
        />
      </div>

      <div className="form-actions">
        <button onClick={handleSave} className="button primary" disabled={isSubmitting}>
          {isSubmitting ? 'Saving...' : 'Save Changes'}
        </button>
        <button onClick={() => {
          setIsEditing(false);
          loadLineItems(); // Reset unsaved changes
          setDeletedLineItemIds([]);
        }} className="button secondary" disabled={isSubmitting}>
          Cancel
        </button>
      </div>
    </div>
  );
}
