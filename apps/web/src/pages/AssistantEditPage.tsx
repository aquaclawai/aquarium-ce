import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api, ApiError } from '../api';
import { PageHeaderSkeleton, CardSkeleton } from '@/components/skeletons';
import type { Instance } from '@aquarium/shared';
import { AvatarPicker } from '../components/AvatarPicker';
import './MyAssistantsPage.css';
import {
  Button,
  Input,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui';

export function AssistantEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();

  const [instance, setInstance] = useState<Instance | null>(null);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('');
  const [principles, setPrinciples] = useState('');
  const [identityDescription, setIdentityDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [loadError, setLoadError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchInstance() {
      if (!id) return;
      try {
        const data = await api.get<Instance>(`/instances/${id}`);
        if (!cancelled) {
          setInstance(data);
          setName(data.name);
          setAvatar(data.avatar ?? '');
          setPrinciples(typeof data.config.soulmd === 'string' ? data.config.soulmd : '');
          setIdentityDescription(
            typeof data.config.identitymd === 'string'
              ? data.config.identitymd
              : '',
          );
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err instanceof ApiError ? err.message : t('assistantEdit.loadError'),
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchInstance();
    return () => {
      cancelled = true;
    };
  }, [id, t]);

  async function handleSave() {
    if (!id || saving) return;
    setSaving(true);
    setSaveStatus('idle');

    try {
      // Build avatar payload matching backend expectation: { type, presetId?, image? }
      let avatarPayload: { type: string; presetId?: string; image?: string };
      if (!avatar) {
        avatarPayload = { type: 'remove' };
      } else if (avatar.startsWith('preset:')) {
        avatarPayload = { type: 'preset', presetId: avatar.slice('preset:'.length) };
      } else {
        avatarPayload = { type: 'custom', image: avatar };
      }

      await Promise.all([
        api.patch(`/instances/${id}/config`, {
          soulmd: principles,
          identitymd: identityDescription,
          agentName: name,
        }),
        api.put(`/instances/${id}/avatar`, avatarPayload),
      ]);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch {
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!id || deleting) return;

    setDeleting(true);
    try {
      await api.delete(`/instances/${id}`);
      navigate('/assistants');
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t('assistantEdit.deleteError'));
      setDeleting(false);
      setShowDeleteModal(false);
    }
  }

  if (loading) {
    return (
      <div className="aep-page aep-page--loading">
        <PageHeaderSkeleton />
        <CardSkeleton lines={8} />
      </div>
    );
  }

  const displayName = instance?.name ?? name;

  return (
    <div className="aep-page">
      <div className="aep-content">
        <Button variant="ghost" className="aep-back-btn" onClick={() => navigate('/assistants')}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M10 3L5 8L10 13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {t('assistantEdit.backButton')}
        </Button>

        <div className="aep-header">
          <div className="aep-header-text">
            <h1 className="aep-title">{t('assistantEdit.title')}</h1>
            <p className="aep-subtitle">
              {t('assistantEdit.subtitle')}
              <span className="aep-subtitle-name"> {displayName} </span>
              {t('assistantEdit.subtitleOf')}
            </p>
          </div>
          <Button
            className={`aep-save-btn${saving ? ' aep-save-btn--saving' : ''}${saveStatus === 'saved' ? ' aep-save-btn--saved' : ''}${saveStatus === 'error' ? ' aep-save-btn--error' : ''}`}
            onClick={handleSave}
            disabled={saving}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M13 10v2.5a.5.5 0 01-.5.5h-9a.5.5 0 01-.5-.5V10M8 2v7M5.5 6.5L8 9l2.5-2.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            {saving
              ? t('assistantEdit.savingText')
              : saveStatus === 'saved'
                ? t('assistantEdit.savedText')
                : t('assistantEdit.saveButton')}
          </Button>
        </div>

        {loadError && (
          <div className="aep-alert aep-alert--warning">{loadError}</div>
        )}
        {saveStatus === 'error' && (
          <div className="aep-alert aep-alert--error">{t('assistantEdit.saveError')}</div>
        )}

        <div className="aep-sections">
          <section className="aep-section">
            <div className="aep-section-header">
              <span className="aep-section-icon aep-section-icon--name">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path
                    d="M10.5 1.5L13.5 4.5M2 13l1.5-4.5L11 1 14 4l-7.5 7.5L2 13z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <h2 className="aep-section-title">{t('assistantEdit.nameSection')}</h2>
            </div>
            <Input
              className="aep-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('assistantEdit.nameSection')}
            />
          </section>

          <section className="aep-section">
            <div className="aep-section-header">
              <span className="aep-section-icon aep-section-icon--avatar">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <rect x="1" y="1" width="13" height="13" rx="3" stroke="currentColor" strokeWidth="1.3" />
                  <circle cx="7.5" cy="6" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                  <path d="M3 13c0-2.5 2-4.5 4.5-4.5S12 10.5 12 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </span>
              <h2 className="aep-section-title">{t('assistantEdit.avatarSection')}</h2>
            </div>
            <AvatarPicker value={avatar} onChange={(v) => setAvatar(v ?? '')} />
          </section>

          <section className="aep-section">
            <div className="aep-section-header">
              <span className="aep-section-icon aep-section-icon--principles">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <path
                    d="M7.5 1L9.18 5.28l4.57.38-3.46 3 1.04 4.46L7.5 10.5l-3.83 2.62 1.04-4.46-3.46-3 4.57-.38L7.5 1z"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <h2 className="aep-section-title">{t('assistantEdit.principlesSection')}</h2>
            </div>
            <textarea
              className="aep-textarea"
              value={principles}
              onChange={(e) => setPrinciples(e.target.value)}
              rows={9}
              placeholder={t('assistantEdit.principlesSection')}
            />
          </section>

          <section className="aep-section">
            <div className="aep-section-header">
              <span className="aep-section-icon aep-section-icon--identity">
                <svg width="15" height="15" viewBox="0 0 15 15" fill="none">
                  <circle cx="7.5" cy="4.5" r="2.5" stroke="currentColor" strokeWidth="1.3" />
                  <path
                    d="M2 13c0-3.038 2.462-5.5 5.5-5.5S13 9.962 13 13"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <h2 className="aep-section-title">{t('assistantEdit.identitySection')}</h2>
            </div>
            <textarea
              className="aep-textarea"
              value={identityDescription}
              onChange={(e) => setIdentityDescription(e.target.value)}
              rows={7}
              placeholder={t('assistantEdit.identitySection')}
            />
          </section>
        </div>

        <section className="aep-danger-zone">
          <h2 className="aep-danger-zone-title">{t('assistantEdit.dangerZone.title')}</h2>
          <p className="aep-danger-zone-desc">{t('assistantEdit.dangerZone.description')}</p>
          <Button
            variant="destructive"
            className="danger"
            onClick={() => setShowDeleteModal(true)}
            disabled={deleting}
          >
            {t('assistantEdit.dangerZone.deleteButton')}
          </Button>
        </section>
      </div>

      <Dialog open={showDeleteModal} onOpenChange={open => { if (!open && !deleting) setShowDeleteModal(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('assistantEdit.deleteModal.title')}</DialogTitle>
            <DialogDescription>
              {t('assistantEdit.deleteModal.description')}
              {' '}{t('assistantEdit.deleteModal.warning')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowDeleteModal(false)}
              disabled={deleting}
            >
              {t('assistantEdit.deleteModal.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? t('assistantEdit.dangerZone.deleting') : t('assistantEdit.deleteModal.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Button variant="ghost" size="icon" className="aep-help-btn" aria-label="Help">
        <span>?</span>
      </Button>
    </div>
  );
}
