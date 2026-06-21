import { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { apiFetch } from '../utils/api';

interface JobMedia {
  id: string;
  jobId: string;
  type: 'DIAGNOSTIC' | 'COMPLETION';
  storageKey: string;
  presignedUrl?: string; // Appended by the backend response
  createdAt: string;
}

export function JobMediaUpload({ jobId }: { jobId: string }) {
  const [mediaList, setMediaList] = useState<JobMedia[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploadType, setUploadType] = useState<'DIAGNOSTIC' | 'COMPLETION'>('DIAGNOSTIC');

  useEffect(() => {
    loadMedia();
  }, [jobId]);

  const loadMedia = async () => {
    try {
      const response = await apiFetch(`/job-media?jobId=${jobId}`);
      // Pagination response
      setMediaList(response.data || []);
    } catch (err: any) {
      setError('Failed to load media.');
    } finally {
      setIsLoading(false);
    }
  };

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    
    setError('');
    for (const file of acceptedFiles) {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', uploadType);
      formData.append('jobId', String(jobId));

      try {
        const token = localStorage.getItem('affinity_token');
        const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        const res = await fetch(`${apiBase}/job-media`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });

        if (!res.ok) throw new Error('Upload failed');
        const newMedia = await res.json();
        setMediaList(prev => [newMedia, ...prev]);
      } catch (err: any) {
        setError(`Failed to upload ${file.name}`);
      }
    }
  }, [jobId, uploadType]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'image/*': [] } });

  return (
    <div className="section-card">
      <div className="section-card-header flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Job Media</h3>
        <select value={uploadType} onChange={(e) => setUploadType(e.target.value as any)} style={{ padding: '0.2rem' }}>
          <option value="DIAGNOSTIC">Diagnostic Photos</option>
          <option value="COMPLETION">Completion Photos</option>
        </select>
      </div>

      {error && <div className="page-error">{error}</div>}

      <div {...getRootProps()} className="dropzone" style={{ 
        backgroundColor: isDragActive ? 'var(--color-bg)' : 'transparent',
        borderColor: isDragActive ? 'var(--color-brand)' : 'var(--color-border)',
        marginBottom: 'var(--space-md)'
      }}>
        <input {...getInputProps()} />
        {isDragActive ? (
          <p className="font-medium text-primary">Drop the files here ...</p>
        ) : (
          <p className="text-secondary" style={{ margin: 0 }}>Drag & drop some images here, or click to select files</p>
        )}
      </div>

      {isLoading ? <p>Loading media...</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--space-sm)' }}>
          {mediaList.map(media => (
            <div key={media.id} className="section-card" style={{ marginBottom: 0, padding: 0, overflow: 'hidden' }}>
              {media.presignedUrl ? (
                <img src={media.presignedUrl} alt="Job Media" style={{ width: '100%', height: '120px', objectFit: 'cover' }} />
              ) : (
                <div className="flex items-center justify-center text-muted" style={{ width: '100%', height: '120px', background: 'var(--color-bg)' }}>No Preview</div>
              )}
              <div className="font-medium text-secondary" style={{ padding: 'var(--space-xs)', fontSize: '0.75rem', textAlign: 'center', backgroundColor: 'var(--color-bg)', borderTop: '1px solid var(--color-border)' }}>
                {media.type}
              </div>
            </div>
          ))}
          {mediaList.length === 0 && (
            <div className="empty-state" style={{ gridColumn: '1 / -1', border: 'none' }}>No media uploaded yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
