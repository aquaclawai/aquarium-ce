import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { rpc } from '../../utils/rpc';
import type { Instance } from '@aquarium/shared';

interface FilesTabProps {
  instanceId: string;
  instanceStatus: Instance['status'];
}

interface GatewayFile {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
}

interface FilesListResult {
  agentId: string;
  workspace: string;
  files: GatewayFile[];
}

interface FileGetResult {
  agentId: string;
  workspace: string;
  file: GatewayFile;
}

function formatBytes(bytes: number, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

export function FilesTab({ instanceId, instanceStatus }: FilesTabProps) {
  const { t } = useTranslation();
  const [files, setFiles] = useState<GatewayFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewingFile, setViewingFile] = useState<{ name: string; content: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const fetchFiles = useCallback(async () => {
    if (instanceStatus !== 'running') return;
    
    setLoading(true);
    setError(null);
    try {
      const result = await rpc<FilesListResult>(instanceId, 'agents.files.list', { agentId: 'main' });
      setFiles((result?.files || []).filter(f => !f.missing));
    } catch (err) {
      console.error('Failed to list files:', err);
      setError(t('files.errors.listFailed'));
    } finally {
      setLoading(false);
    }
  }, [instanceId, instanceStatus, t]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  const handleView = async (file: GatewayFile) => {
    setPreviewLoading(true);
    try {
      const result = await rpc<FileGetResult>(instanceId, 'agents.files.get', { agentId: 'main', name: file.name });
      setViewingFile({
        name: file.name,
        content: result.file.content || '',
      });
    } catch (err) {
      console.error('Failed to read file:', err);
      alert(t('files.errors.readFailed'));
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDownload = async (file: GatewayFile) => {
    try {
      const result = await rpc<FileGetResult>(instanceId, 'agents.files.get', { agentId: 'main', name: file.name });
      const content = result.file.content || '';
      const blob = new Blob([content], { type: 'text/plain' });

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.style.display = 'none';
      a.href = url;
      a.download = file.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Failed to download file:', err);
      alert(t('files.errors.readFailed'));
    }
  };

  if (instanceStatus !== 'running') {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
        <p>{t('files.startRequired')}</p>
      </div>
    );
  }

  return (
    <div className="files-tab" style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>{t('instance.tabs.files')}</h3>
        <button 
          onClick={fetchFiles} 
          disabled={loading}
          style={{
            background: 'var(--color-surface-hover)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text)',
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer'
          }}
        >
          {loading ? '...' : t('files.refresh')}
        </button>
      </div>

      {error && (
        <div style={{ 
          padding: '1rem', 
          marginBottom: '1rem', 
          background: 'var(--color-error-bg)', 
          color: 'var(--color-error-text)',
          borderRadius: '4px' 
        }}>
          {error}
        </div>
      )}

      {loading && files.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          Loading...
        </div>
      ) : files.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          {t('files.emptyState')}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem' }}>{t('files.table.name')}</th>
                <th style={{ padding: '0.75rem' }}>{t('files.table.size')}</th>
                <th style={{ padding: '0.75rem' }}>{t('files.table.type')}</th>
                <th style={{ padding: '0.75rem' }}>{t('files.table.modified')}</th>
                <th style={{ padding: '0.75rem', textAlign: 'right' }}>{t('files.table.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {files.map((file) => (
                <tr key={file.path} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                  <td style={{ padding: '0.75rem' }}>{file.name}</td>
                  <td style={{ padding: '0.75rem', color: 'var(--color-text-secondary)' }}>
                    {file.size != null ? formatBytes(file.size) : '-'}
                  </td>
                  <td style={{ padding: '0.75rem', color: 'var(--color-text-secondary)' }}>
                    {file.name.includes('.') ? file.name.split('.').pop() : '-'}
                  </td>
                  <td style={{ padding: '0.75rem', color: 'var(--color-text-secondary)' }}>
                    {file.updatedAtMs ? new Date(file.updatedAtMs).toLocaleDateString() : '-'}
                  </td>
                  <td style={{ padding: '0.75rem', textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                    <button
                      onClick={() => handleView(file)}
                      disabled={previewLoading}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-primary)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        cursor: 'pointer'
                      }}
                    >
                      {t('files.actions.view')}
                    </button>
                    <button
                      onClick={() => handleDownload(file)}
                      style={{
                        background: 'transparent',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text)',
                        padding: '0.25rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.8rem',
                        cursor: 'pointer'
                      }}
                    >
                      {t('files.actions.download')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewingFile && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.8)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000,
          padding: '2rem'
        }}>
          <div style={{
            background: 'var(--color-surface)',
            borderRadius: '8px',
            maxWidth: '90vw',
            maxHeight: '90vh',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            boxShadow: '0 4px 24px rgba(0, 0, 0, 0.5)',
            width: '800px'
          }}>
            <div style={{
              padding: '1rem',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <h4 style={{ margin: 0 }}>{viewingFile.name}</h4>
              <button
                onClick={() => setViewingFile(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text-secondary)',
                  cursor: 'pointer',
                  fontSize: '1.2rem',
                  lineHeight: 1
                }}
              >
                ×
              </button>
            </div>
            <div style={{ overflow: 'auto', padding: '1rem', flex: 1, display: 'flex', justifyContent: 'center' }}>
              <pre style={{ 
                margin: 0, 
                fontFamily: 'monospace', 
                whiteSpace: 'pre-wrap', 
                wordBreak: 'break-all',
                width: '100%'
              }}>
                {viewingFile.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
