import './ExportWizardPage.css';
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { ExportTemplateResponse } from '@aquarium/shared';

type PreviewTab = 'overview' | 'files' | 'mcp' | 'warnings';

export function ExportWizardPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exportData, setExportData] = useState<ExportTemplateResponse | null>(null);

  const [editedName, setEditedName] = useState('');
  const [editedSlug, setEditedSlug] = useState('');
  const [editedDescription, setEditedDescription] = useState('');
  const [editedTags, setEditedTags] = useState('');

  const [activeTab, setActiveTab] = useState<PreviewTab>('overview');
  const [saving, setSaving] = useState(false);

  const fetchExport = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const data = await api.post<ExportTemplateResponse>(`/templates/from-instance/${id}`);
      setExportData(data);
      setEditedName(data.draft.name);
      setEditedSlug(data.draft.slug);
      setEditedDescription(data.draft.description ?? '');
      setEditedTags((data.draft.tags ?? []).join(', '));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('exportWizard.error'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => {
    void fetchExport();
  }, [fetchExport]);

  function handleDownloadJson() {
    if (!exportData) return;
    const payload = {
      ...exportData.draft,
      name: editedName,
      slug: editedSlug,
      description: editedDescription,
      tags: editedTags.split(',').map(s => s.trim()).filter(Boolean),
      content: exportData.content,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${editedSlug || 'template'}.template.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleSaveTemplate() {
    if (!exportData) return;
    setSaving(true);
    setError('');
    try {
      await api.post('/templates', {
        ...exportData.draft,
        name: editedName,
        slug: editedSlug,
        description: editedDescription,
        tags: editedTags.split(',').map(s => s.trim()).filter(Boolean),
        content: exportData.content,
      });
      navigate('/assistants');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('exportWizard.error'));
    } finally {
      setSaving(false);
    }
  }

  const warningCount = exportData?.securityWarnings.length ?? 0;

  return (
    <div className="export-wizard">
      <div className="export-wizard__topbar">
        <button className="export-wizard__back-link" onClick={() => navigate(-1)}>
          &larr; {t('exportWizard.cancel')}
        </button>
      </div>

      <div className="export-wizard__header">
        <h1 className="export-wizard__title">{t('exportWizard.title')}</h1>
        <p className="export-wizard__subtitle">
          {exportData ? editedName : ''}
        </p>
      </div>

      {loading && (
        <div className="export-wizard__loading">
          <div className="export-wizard__spinner" />
          <span>{t('exportWizard.loading')}</span>
        </div>
      )}

      {!loading && error && !exportData && (
        <div className="export-wizard__error">
          <p className="export-wizard__error-msg">{error}</p>
          <button className="export-wizard__error-btn" onClick={() => void fetchExport()}>
            {t('exportWizard.retry')}
          </button>
        </div>
      )}

      {!loading && exportData && (
        <>
          {error && (
            <div className="export-wizard__error" style={{ marginBottom: 'var(--space-4)', maxWidth: '1100px' }}>
              <p className="export-wizard__error-msg">{error}</p>
            </div>
          )}

          <div className="export-wizard__content">
            <div className="export-wizard__metadata">
              <div className="export-wizard__field">
                <label className="export-wizard__label">{t('exportWizard.name')}</label>
                <input
                  className="export-wizard__input"
                  value={editedName}
                  onChange={e => setEditedName(e.target.value)}
                />
              </div>
              <div className="export-wizard__field">
                <label className="export-wizard__label">{t('exportWizard.slug')}</label>
                <input
                  className="export-wizard__input"
                  value={editedSlug}
                  onChange={e => setEditedSlug(e.target.value)}
                />
              </div>
              <div className="export-wizard__field">
                <label className="export-wizard__label">{t('exportWizard.description')}</label>
                <textarea
                  className="export-wizard__textarea"
                  value={editedDescription}
                  onChange={e => setEditedDescription(e.target.value)}
                  rows={3}
                />
              </div>
              <div className="export-wizard__field">
                <label className="export-wizard__label">{t('exportWizard.tags')}</label>
                <input
                  className="export-wizard__input"
                  value={editedTags}
                  onChange={e => setEditedTags(e.target.value)}
                  placeholder={t('exportWizard.tagsHint')}
                />
                <span className="export-wizard__hint">{t('exportWizard.tagsHint')}</span>
              </div>
              <div className="export-wizard__field">
                <label className="export-wizard__label">{t('exportWizard.category')}</label>
                <span className="export-wizard__readonly">{exportData.draft.category ?? 'custom'}</span>
              </div>
              <div className="export-wizard__field">
                <label className="export-wizard__label">{t('exportWizard.agentType')}</label>
                <span className="export-wizard__readonly">{exportData.draft.agentType ?? 'openclaw'}</span>
              </div>
            </div>

            <div className="export-wizard__preview">
              <div className="export-wizard__tabs">
                {(['overview', 'files', 'mcp', 'warnings'] as const).map(tab => (
                  <button
                    key={tab}
                    className={`export-wizard__tab${activeTab === tab ? ' export-wizard__tab--active' : ''}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {t(`exportWizard.tabs.${tab}`)}
                    {tab === 'warnings' && warningCount > 0 && (
                      <span className="export-wizard__tab-badge">{warningCount}</span>
                    )}
                  </button>
                ))}
              </div>

              <div className="export-wizard__tab-panel">
                {activeTab === 'overview' && (
                  <OverviewPanel exportData={exportData} t={t} />
                )}
                {activeTab === 'files' && (
                  <FilesPanel exportData={exportData} t={t} />
                )}
                {activeTab === 'mcp' && (
                  <McpPanel exportData={exportData} t={t} />
                )}
                {activeTab === 'warnings' && (
                  <WarningsPanel exportData={exportData} t={t} />
                )}
              </div>
            </div>
          </div>

          <div className="export-wizard__actions">
            <button
              className="export-wizard__btn export-wizard__btn--cancel"
              onClick={() => navigate(-1)}
            >
              {t('exportWizard.cancel')}
            </button>
            <button
              className="export-wizard__btn export-wizard__btn--secondary"
              onClick={handleDownloadJson}
            >
              {t('exportWizard.downloadJson')}
            </button>
            <button
              className="export-wizard__btn export-wizard__btn--primary"
              onClick={() => void handleSaveTemplate()}
              disabled={saving || !editedName.trim()}
            >
              {saving ? t('exportWizard.saving') : t('exportWizard.saveTemplate')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

interface PanelProps {
  exportData: ExportTemplateResponse;
  t: (key: string) => string;
}

function OverviewPanel({ exportData, t }: PanelProps) {
  const fileCount = Object.keys(exportData.content.workspaceFiles).length;
  const mcpCount = Object.keys(exportData.content.mcpServerConfigs).length;
  const skillCount = (exportData.draft.skills ?? []).length;
  const credentialCount = (exportData.draft.requiredCredentials ?? []).length;
  const channelCount = (exportData.draft.suggestedChannels ?? []).length;
  const pluginCount = (exportData.draft.pluginDependencies ?? []).length;

  const items = [
    { value: fileCount, label: t('exportWizard.summary.files') },
    { value: mcpCount, label: t('exportWizard.summary.mcpServers') },
    { value: skillCount, label: t('exportWizard.summary.skills') },
    { value: credentialCount, label: t('exportWizard.summary.credentials') },
    { value: channelCount, label: t('exportWizard.summary.channels') },
    { value: pluginCount, label: t('exportWizard.summary.plugins') },
  ];

  return (
    <div className="export-wizard__summary-grid">
      {items.map(item => (
        <div key={item.label} className="export-wizard__summary-card">
          <span className="export-wizard__summary-value">{item.value}</span>
          <span className="export-wizard__summary-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function FilesPanel({ exportData, t }: PanelProps) {
  const files = Object.entries(exportData.content.workspaceFiles);
  if (files.length === 0) {
    return <div className="export-wizard__empty">{t('exportWizard.noFiles')}</div>;
  }

  return (
    <div className="export-wizard__file-list">
      {files.map(([name, content]) => (
        <div key={name} className="export-wizard__file-item">
          <div className="export-wizard__file-name">{name}</div>
          <div className="export-wizard__file-preview">
            {typeof content === 'string'
              ? content.split('\n').slice(0, 3).join('\n')
              : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function McpPanel({ exportData, t }: PanelProps) {
  const servers = Object.entries(exportData.content.mcpServerConfigs);
  if (servers.length === 0) {
    return <div className="export-wizard__empty">{t('exportWizard.noMcp')}</div>;
  }

  return (
    <div className="export-wizard__mcp-list">
      {servers.map(([name, cfg]) => {
        const envCount = cfg && typeof cfg === 'object'
          ? Object.keys((cfg as Record<string, unknown>).env ?? {}).length
          : 0;
        return (
          <div key={name} className="export-wizard__mcp-item">
            <span className="export-wizard__mcp-name">{name}</span>
            <span className="export-wizard__mcp-meta">
              {envCount} env var{envCount !== 1 ? 's' : ''}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function WarningsPanel({ exportData, t }: PanelProps) {
  const warnings = exportData.securityWarnings;
  if (warnings.length === 0) {
    return (
      <div className="export-wizard__no-warnings">
        &#10003; {t('exportWizard.noWarnings')}
      </div>
    );
  }

  return (
    <div className="export-wizard__warning-list">
      {warnings.map((w, i) => (
        <div key={i} className="export-wizard__warning-item">
          <div className="export-wizard__warning-type">{w.type.replace(/_/g, ' ')}</div>
          <div className="export-wizard__warning-location">{w.location}</div>
          {w.suggestion && (
            <div className="export-wizard__warning-suggestion">{w.suggestion}</div>
          )}
        </div>
      ))}
    </div>
  );
}
