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
        const res = await fetch(`http://localhost:3000/api/job-media`, {
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
    <div style={{ background: 'var(--surface-color)', padding: 'var(--spacing-md)', borderRadius: 'var(--border-radius)', border: '1px solid var(--border-color)', marginTop: 'var(--spacing-md)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Job Media</h3>
        <select value={uploadType} onChange={(e) => setUploadType(e.target.value as any)} style={{ padding: '0.2rem' }}>
          <option value="DIAGNOSTIC">Diagnostic Photos</option>
          <option value="COMPLETION">Completion Photos</option>
        </select>
      </div>

      {error && <div style={{ color: 'var(--status-cancelled-text)', marginBottom: 'var(--spacing-sm)' }}>{error}</div>}

      <div {...getRootProps()} style={{ 
        border: '2px dashed var(--border-color)', 
        padding: 'var(--spacing-lg)', 
        textAlign: 'center', 
        borderRadius: 'var(--border-radius)',
        backgroundColor: isDragActive ? 'var(--status-checked-bg)' : 'transparent',
        cursor: 'pointer',
        marginBottom: 'var(--spacing-md)'
      }}>
        <input {...getInputProps()} />
        {isDragActive ? (
          <p>Drop the files here ...</p>
        ) : (
          <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Drag & drop some images here, or click to select files</p>
        )}
      </div>

      {isLoading ? <p>Loading media...</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 'var(--spacing-sm)' }}>
          {mediaList.map(media => (
            <div key={media.id} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius)', overflow: 'hidden' }}>
              {media.presignedUrl ? (
                <img src={media.presignedUrl} alt="Job Media" style={{ width: '100%', height: '120px', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: '100%', height: '120px', background: '#eee', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>No Preview</div>
              )}
              <div style={{ padding: 'var(--spacing-xs)', fontSize: '0.75rem', textAlign: 'center', backgroundColor: 'var(--bg-color)' }}>
                {media.type}
              </div>
            </div>
          ))}
          {mediaList.length === 0 && (
            <div style={{ gridColumn: '1 / -1', textAlign: 'center', color: 'var(--text-secondary)' }}>No media uploaded yet.</div>
          )}
        </div>
      )}
    </div>
  );
}
