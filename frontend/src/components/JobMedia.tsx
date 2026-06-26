import { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { apiFetch } from '../utils/api';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

interface JobMediaItem {
  id: string;
  jobId: string;
  mediaType: 'DIAGNOSTIC' | 'COMPLETION';
  storageKey: string;
  presignedUrl?: string;
  createdAt: string;
}

const MEDIA_LABELS: Record<string, string> = {
  DIAGNOSTIC: 'Diagnostic',
  COMPLETION: 'Completion',
};

export function JobMediaUpload({ jobId }: { jobId: string }) {
  const { socket } = useAuth();
  const { showToast } = useToast();
  const [mediaList, setMediaList] = useState<JobMediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [error, setError] = useState('');
  const [uploadType, setUploadType] = useState<'DIAGNOSTIC' | 'COMPLETION'>('DIAGNOSTIC');

  const loadMedia = useCallback(async () => {
    try {
      const response = await apiFetch(`/job-media?jobId=${jobId}`);
      const items: JobMediaItem[] = Array.isArray(response) ? response : response.data || [];
      const withUrls = await Promise.all(
        items.map(async (item) => {
          try {
            const urlRes = await apiFetch(`/job-media/${item.id}/url`);
            return { ...item, presignedUrl: urlRes.url };
          } catch {
            return item;
          }
        })
      );
      setMediaList(withUrls);
    } catch {
      setError('Failed to load media.');
    } finally {
      setIsLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    loadMedia();
  }, [loadMedia]);

  useEffect(() => {
    if (!socket) return;
    // Refresh the gallery when another session uploads to the same job.
    const handleUploaded = (payload: { jobId: string }) => {
      if (payload.jobId === jobId) loadMedia();
    };
    socket.on('media:uploaded', handleUploaded);
    return () => {
      socket.off('media:uploaded', handleUploaded);
    };
  }, [socket, jobId, loadMedia]);

  const uploadFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return;
    setIsUploading(true);
    setError('');

    for (const file of files) {
      setUploadStatus(`Uploading ${file.name}…`);
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mediaType', uploadType);
      formData.append('jobId', String(jobId));

      try {
        const token = localStorage.getItem('affinity_token');
        const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';
        // Use native fetch (not apiFetch) because FormData must not have a Content-Type
        // header set manually — the browser sets it with the correct multipart boundary.
        const res = await fetch(`${apiBase}/job-media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        if (!res.ok) throw new Error('Upload failed');
        const newMedia = await res.json();
        try {
          const urlRes = await apiFetch(`/job-media/${newMedia.id}/url`);
          newMedia.presignedUrl = urlRes.url;
        } catch { /* preview optional */ }
        setMediaList((prev) => [{ ...newMedia, mediaType: newMedia.mediaType || uploadType }, ...prev]);
        showToast(`${file.name} uploaded`, 'success');
      } catch {
        setError(`Failed to upload ${file.name}`);
        showToast(`Failed to upload ${file.name}`, 'error');
      }
    }

    setUploadStatus('');
    setIsUploading(false);
  }, [jobId, uploadType, showToast]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    uploadFiles(acceptedFiles);
  }, [uploadFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      uploadFiles(imageFiles);
    }
  }, [uploadFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    disabled: isUploading,
  });

  return (
    <div className="section-card">
      <div className="section-card-header flex justify-between items-center" style={{ marginBottom: 'var(--space-md)' }}>
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Job Media</h3>
        <select
          value={uploadType}
          onChange={(e) => setUploadType(e.target.value as 'DIAGNOSTIC' | 'COMPLETION')}
          className="segment-control"
          style={{ padding: '0.35rem 0.75rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}
          disabled={isUploading}
        >
          <option value="DIAGNOSTIC">Diagnostic Photos</option>
          <option value="COMPLETION">Completion Photos</option>
        </select>
      </div>

      {error && <div className="page-error">{error}</div>}
      {uploadStatus && (
        <p className="text-secondary" style={{ fontSize: '0.8125rem', marginBottom: 'var(--space-sm)' }}>
          {uploadStatus}
        </p>
      )}

      <div
        {...getRootProps()}
        className={`dropzone${isDragActive ? ' active' : ''}${isUploading ? ' uploading' : ''}`}
        onPaste={handlePaste}
        tabIndex={0}
      >
        <input {...getInputProps()} />
        {isUploading ? (
          <p className="font-medium text-primary" style={{ margin: 0 }}>Uploading…</p>
        ) : isDragActive ? (
          <p className="font-medium text-primary" style={{ margin: 0 }}>Drop the files here…</p>
        ) : (
          <p className="text-secondary" style={{ margin: 0 }}>
            Drag & drop images here, click to select, or <strong>Ctrl+V</strong> to paste
          </p>
        )}
      </div>

      {isLoading ? (
        <p>Loading media...</p>
      ) : (
        <div className="media-grid">
          {mediaList.map((media) => (
            <div key={media.id} className="media-item">
              {media.presignedUrl ? (
                <img src={media.presignedUrl} alt="Job Media" />
              ) : (
                <div className="flex items-center justify-center text-muted" style={{ width: '100%', height: '120px', background: 'var(--color-bg)' }}>
                  No Preview
                </div>
              )}
              <div className="media-item-label">{MEDIA_LABELS[media.mediaType] || media.mediaType}</div>
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
