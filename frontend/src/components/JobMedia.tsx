import { useState, useEffect, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { X } from 'lucide-react';
import { apiFetch } from '../utils/api';
import { API_BASE } from '../config';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { mergeById, prependById } from '../utils/refetch';

interface JobMediaItem {
  id: string;
  jobId: string;
  mediaType: 'DIAGNOSTIC' | 'COMPLETION';
  storageKey: string;
  presignedUrl?: string;
  createdAt: string;
}

export function JobMediaUpload({ jobId }: { jobId: string }) {
  const { socket, user, can } = useAuth();
  const { showToast } = useToast();
  const [mediaList, setMediaList] = useState<JobMediaItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadingDiag, setUploadingDiag] = useState(false);
  const [uploadingComp, setUploadingComp] = useState(false);
  const [uploadStatusDiag, setUploadStatusDiag] = useState('');
  const [uploadStatusComp, setUploadStatusComp] = useState('');
  const [error, setError] = useState('');
  const [deleteState, setDeleteState] = useState<Record<string, 'confirm'>>({});

  const canDeleteMedia = can('media:delete');

  const loadMedia = useCallback(async (background = false) => {
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
      setMediaList((prev) => (background ? mergeById(prev, withUrls) : withUrls));
    } catch {
      if (!background) {
        setError('Failed to load media.');
      }
    } finally {
      if (!background) {
        setIsLoading(false);
      }
    }
  }, [jobId]);

  const appendMediaItem = useCallback(async (item: JobMediaItem) => {
    try {
      const urlRes = await apiFetch(`/job-media/${item.id}/url`);
      setMediaList((prev) => prependById(prev, [{ ...item, presignedUrl: urlRes.url }]));
    } catch {
      setMediaList((prev) => prependById(prev, [item]));
    }
  }, []);

  useEffect(() => {
    loadMedia(false);
  }, [loadMedia]);

  useEffect(() => {
    if (!socket) return;

    const handleUploaded = (payload: { jobId: string; actorId?: string; media?: JobMediaItem }) => {
      if (payload.jobId !== jobId) return;
      if (payload.actorId && payload.actorId === user?.id) return;
      if (payload.media) {
        appendMediaItem(payload.media);
        return;
      }
      loadMedia(true);
    };

    const handleDeleted = (payload: { jobId: string; mediaId: string }) => {
      if (payload.jobId === jobId) {
        setMediaList((prev) => prev.filter((m) => m.id !== payload.mediaId));
      }
    };

    socket.on('media:uploaded', handleUploaded);
    socket.on('media:deleted', handleDeleted);
    return () => {
      socket.off('media:uploaded', handleUploaded);
      socket.off('media:deleted', handleDeleted);
    };
  }, [socket, jobId, user?.id, loadMedia, appendMediaItem]);

  const uploadFiles = useCallback(
    async (files: File[], type: 'DIAGNOSTIC' | 'COMPLETION') => {
      if (files.length === 0) return;
      const setUploading = type === 'DIAGNOSTIC' ? setUploadingDiag : setUploadingComp;
      const setStatus = type === 'DIAGNOSTIC' ? setUploadStatusDiag : setUploadStatusComp;

      setUploading(true);
      setError('');

      for (const file of files) {
        setStatus(`Uploading ${file.name}…`);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('mediaType', type);
        formData.append('jobId', String(jobId));

        try {
          const token = localStorage.getItem('affinity_token');
          const res = await fetch(`${API_BASE}/job-media`, {
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
          setMediaList((prev) =>
            prependById(prev, [{ ...newMedia, mediaType: newMedia.mediaType || type }])
          );
          showToast(`${file.name} uploaded`, 'success');
        } catch {
          setError(`Failed to upload ${file.name}`);
          showToast(`Failed to upload ${file.name}`, 'error');
        }
      }

      setStatus('');
      setUploading(false);
    },
    [jobId, showToast]
  );

  const handleDelete = useCallback(
    async (media: JobMediaItem) => {
      if (!canDeleteMedia) {
        showToast('You do not have permission to delete media', 'error');
        return;
      }

      setMediaList((prev) => prev.filter((m) => m.id !== media.id));
      setDeleteState((prev) => {
        const next = { ...prev };
        delete next[media.id];
        return next;
      });

      try {
        await apiFetch(`/job-media/${media.id}`, { method: 'DELETE' });
      } catch {
        setMediaList((prev) => prependById(prev, [media]));
        showToast('Failed to delete image', 'error');
      }
    },
    [canDeleteMedia, showToast]
  );

  const diagRootProps = useDropzone({
    onDrop: (files) => uploadFiles(files, 'DIAGNOSTIC'),
    accept: { 'image/*': [] },
    disabled: uploadingDiag,
  });

  const compRootProps = useDropzone({
    onDrop: (files) => uploadFiles(files, 'COMPLETION'),
    accept: { 'image/*': [] },
    disabled: uploadingComp,
  });

  const handlePaste = useCallback(
    (e: React.ClipboardEvent, type: 'DIAGNOSTIC' | 'COMPLETION') => {
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
        uploadFiles(imageFiles, type);
      }
    },
    [uploadFiles]
  );

  const diagMedia = mediaList.filter((m) => m.mediaType === 'DIAGNOSTIC');
  const compMedia = mediaList.filter((m) => m.mediaType === 'COMPLETION');

  const renderMediaGrid = (items: JobMediaItem[]) => (
    <div className="media-grid">
      {items.map((media) => {
        const isConfirming = deleteState[media.id] === 'confirm';
        return (
          <div key={media.id} className="media-item" style={{ position: 'relative' }}>
            {media.presignedUrl ? (
              <a href={media.presignedUrl} target="_blank" rel="noopener noreferrer">
                <img src={media.presignedUrl} alt="Job media" />
              </a>
            ) : (
              <div
                className="flex items-center justify-center text-muted"
                style={{ width: '100%', height: '120px', background: 'var(--color-bg)' }}
              >
                No Preview
              </div>
            )}

            {canDeleteMedia && !isConfirming && (
              <button
                className="media-delete-btn"
                title="Delete image"
                onClick={() =>
                  setDeleteState((prev) => ({ ...prev, [media.id]: 'confirm' }))
                }
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            )}

            {canDeleteMedia && isConfirming && (
              <div className="media-confirm-row">
                <button
                  className="media-confirm-delete"
                  onClick={() => handleDelete(media)}
                >
                  Delete
                </button>
                <button
                  className="media-confirm-cancel"
                  onClick={() =>
                    setDeleteState((prev) => {
                      const next = { ...prev };
                      delete next[media.id];
                      return next;
                    })
                  }
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        );
      })}
      {items.length === 0 && (
        <div
          className="empty-state"
          style={{ gridColumn: '1 / -1', border: 'none', padding: 'var(--space-sm) 0', fontSize: '0.8125rem' }}
        >
          No photos yet.
        </div>
      )}
    </div>
  );

  return (
    <div className="section-card">
      <div className="section-card-header" style={{ marginBottom: 'var(--space-md)' }}>
        <h3 style={{ fontSize: '1rem', margin: 0 }}>Job Media</h3>
      </div>

      {error && <div className="page-error" style={{ marginBottom: 'var(--space-sm)' }}>{error}</div>}

      {isLoading ? (
        <p className="text-secondary" style={{ fontSize: '0.875rem' }}>Loading media…</p>
      ) : (
        <div className="media-sections-layout">
          <div className="media-section">
            <div className="media-section-header">
              <span className="media-section-title">Diagnostic Photos</span>
              <span className="media-section-badge before">Before</span>
            </div>

            {uploadStatusDiag && (
              <p className="text-secondary" style={{ fontSize: '0.8125rem', marginBottom: 'var(--space-xs)' }}>
                {uploadStatusDiag}
              </p>
            )}

            <div
              {...diagRootProps.getRootProps()}
              className={`dropzone dropzone--compact${diagRootProps.isDragActive ? ' active' : ''}${uploadingDiag ? ' uploading' : ''}`}
              onPaste={(e) => handlePaste(e, 'DIAGNOSTIC')}
              tabIndex={0}
            >
              <input {...diagRootProps.getInputProps()} />
              {uploadingDiag ? (
                <span>Uploading…</span>
              ) : diagRootProps.isDragActive ? (
                <span>Drop here…</span>
              ) : (
                <span>Drop or click to add diagnostic photos</span>
              )}
            </div>

            {renderMediaGrid(diagMedia)}
          </div>

          <div className="media-section">
            <div className="media-section-header">
              <span className="media-section-title">Completion Photos</span>
              <span className="media-section-badge after">After</span>
            </div>

            {uploadStatusComp && (
              <p className="text-secondary" style={{ fontSize: '0.8125rem', marginBottom: 'var(--space-xs)' }}>
                {uploadStatusComp}
              </p>
            )}

            <div
              {...compRootProps.getRootProps()}
              className={`dropzone dropzone--compact${compRootProps.isDragActive ? ' active' : ''}${uploadingComp ? ' uploading' : ''}`}
              onPaste={(e) => handlePaste(e, 'COMPLETION')}
              tabIndex={0}
            >
              <input {...compRootProps.getInputProps()} />
              {uploadingComp ? (
                <span>Uploading…</span>
              ) : compRootProps.isDragActive ? (
                <span>Drop here…</span>
              ) : (
                <span>Drop or click to add completion photos</span>
              )}
            </div>

            {renderMediaGrid(compMedia)}
          </div>
        </div>
      )}
    </div>
  );
}
