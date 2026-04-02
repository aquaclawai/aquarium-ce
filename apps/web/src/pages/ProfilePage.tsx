import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import type { User, UserExtended, LoginHistoryEntry } from '@aquarium/shared';
import './ProfilePage.css';

export function ProfilePage() {
  const { t } = useTranslation();
  const { user, updateUser } = useAuth();

  const [extUser, setExtUser] = useState<UserExtended | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loginHistory, setLoginHistory] = useState<LoginHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fetchExtendedUser = useCallback(() => {
    setLoading(true);
    api.get<{ user: UserExtended }>('/auth/me')
      .then(data => {
        setExtUser(data.user);
        setDisplayName(data.user.displayName);
      })
      .catch(() => {
        if (user) {
          setExtUser({
            ...user,
            avatarUrl: null,
            passwordChangedAt: null,
            totpEnabled: false,
            role: 'user',
          });
          setDisplayName(user.displayName);
        }
      })
      .finally(() => setLoading(false));
  }, [user]);

  useEffect(() => {
    fetchExtendedUser();
  }, [fetchExtendedUser]);

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    setProfileSaving(true);
    try {
      const updated = await api.put<User>('/auth/profile', { displayName });
      setDisplayName(updated.displayName);
      updateUser({ displayName: updated.displayName });
      setExtUser(prev => prev ? { ...prev, displayName: updated.displayName } : prev);
      setProfileMsg({ type: 'success', text: t('profilePage.basicInfo.updateSuccess') });
    } catch (err) {
      setProfileMsg({ type: 'error', text: err instanceof Error ? err.message : t('profilePage.basicInfo.updateFailed') });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleDeleteAccount = () => {
    setDeleteConfirmOpen(false);
  };

  const getInitials = (name: string): string => {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const formatDate = (dateStr: string): string => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateStr: string): string => {
    const d = new Date(dateStr);
    return d.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }) + ' ' + d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatEventType = (eventType: string): string => {
    const map: Record<string, string> = {
      login_success: t('profilePage.security.eventLogin'),
      login_failed: t('profilePage.security.eventLoginFailed'),
      signup: t('profilePage.security.eventSignup'),
      password_changed: t('profilePage.security.eventPasswordChanged'),
      logout: t('profilePage.security.eventLogout'),
    };
    return map[eventType] ?? eventType;
  };

  const parseUserAgent = (ua: string | null): string => {
    if (!ua) return '—';
    const browser = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)\/[\d.]+/)?.[0]
      ?? ua.match(/(MSIE|Trident)[\s/][\d.]+/)?.[0]
      ?? '';
    const os = ua.match(/(Windows NT [\d.]+|Mac OS X [\d_.]+|Linux|Android [\d.]+|iOS [\d.]+)/)?.[0] ?? '';
    if (browser || os) return [browser, os].filter(Boolean).join(' · ');
    if (ua.length > 40) return ua.slice(0, 40) + '…';
    return ua;
  };

  useEffect(() => {
    if (!historyOpen) return;
    setHistoryLoading(true);
    setHistoryError(null);
    api.get<LoginHistoryEntry[]>('/auth/login-history')
      .then(data => setLoginHistory(data))
      .catch(err => setHistoryError(err instanceof Error ? err.message : String(err)))
      .finally(() => setHistoryLoading(false));
  }, [historyOpen]);

  if (loading || !extUser) {
    return (
      <main className="profile-page">
        <div className="profile-page__loading">{t('common.loading')}</div>
      </main>
    );
  }

  return (
    <main className="profile-page">
      {/* Header */}
      <div className="profile-page__header">
        <h1>{t('profilePage.title')}</h1>
        <p className="profile-page__subtitle">{t('profilePage.subtitle')}</p>
      </div>

      {/* Basic Info Section */}
      <section className="profile-page__section">
        <h2 className="profile-page__section-title">{t('profilePage.basicInfo.title')}</h2>

        {/* Avatar Row */}
        <div className="profile-page__avatar-row">
          <div className="profile-page__avatar">
            {getInitials(extUser.displayName || extUser.email)}
          </div>
          <div className="profile-page__avatar-info">
            <span className="profile-page__avatar-name">{extUser.displayName}</span>
            <span className="profile-page__avatar-email">{extUser.email}</span>
          </div>

        </div>

        {/* Info Grid */}
        <div className="profile-page__info-grid">
          <div className="profile-page__info-item">
            <span className="profile-page__info-label">{t('profilePage.basicInfo.email')}</span>
            <span className="profile-page__info-value">{extUser.email}</span>
          </div>
          <div className="profile-page__info-item">
            <span className="profile-page__info-label">{t('profilePage.basicInfo.role')}</span>
            <span className={`profile-page__badge profile-page__badge--${extUser.role}`}>
              {extUser.role === 'admin' ? t('profilePage.basicInfo.roleAdmin') : t('profilePage.basicInfo.roleUser')}
            </span>
          </div>
          <div className="profile-page__info-item">
            <span className="profile-page__info-label">{t('profilePage.basicInfo.memberId')}</span>
            <span className="profile-page__info-value profile-page__info-value--mono">{extUser.id}</span>
          </div>
          <div className="profile-page__info-item">
            <span className="profile-page__info-label">{t('profilePage.basicInfo.memberSince')}</span>
            <span className="profile-page__info-value">{formatDate(extUser.createdAt)}</span>
          </div>
        </div>

        {/* Editable Display Name */}
        {profileMsg && (
          <div className={`profile-page__message profile-page__message--${profileMsg.type}`}>
            {profileMsg.text}
          </div>
        )}
        <form className="profile-page__form-row" onSubmit={handleProfileUpdate}>
          <div className="profile-page__form-field">
            <label htmlFor="profile-display-name">{t('profilePage.basicInfo.displayName')}</label>
            <input
              id="profile-display-name"
              className="profile-page__input"
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              required
            />
          </div>
          <button
            className="profile-page__btn profile-page__btn--primary"
            type="submit"
            disabled={profileSaving || displayName === extUser.displayName}
          >
            {profileSaving ? t('profilePage.basicInfo.updating') : t('profilePage.basicInfo.updateProfile')}
          </button>
        </form>
      </section>

      {/* Security Section */}
      <section className="profile-page__section">
        <h2 className="profile-page__section-title">{t('profilePage.security.title')}</h2>

        <div className="profile-page__security-list">
          <div className="profile-page__security-row">
            <div className="profile-page__security-left">
              <span className="profile-page__security-label">{t('profilePage.security.password')}</span>
              <span className="profile-page__security-desc">
                {t('profilePage.security.managedByClerk', { defaultValue: 'Authentication is managed by Clerk. Use Clerk to change your password or manage security settings.' })}
              </span>
            </div>
          </div>

          {/* Login History */}
          <div className="profile-page__security-row">
            <div className="profile-page__security-left">
              <span className="profile-page__security-label">{t('profilePage.security.loginHistory')}</span>
              <span className="profile-page__security-desc">{t('profilePage.security.loginHistoryDesc')}</span>
            </div>
            <div className="profile-page__security-right">
              <button
                className="profile-page__btn profile-page__btn--secondary profile-page__btn--sm"
                type="button"
                onClick={() => setHistoryOpen(!historyOpen)}
              >
                {historyOpen ? t('profilePage.security.hideHistory') : t('profilePage.security.viewHistory')}
              </button>
            </div>
          </div>

          {/* Login History Table */}
          {historyOpen && (
            <div className="profile-page__login-history">
              {historyLoading && (
                <div className="profile-page__login-history-loading">{t('common.loading')}</div>
              )}
              {historyError && (
                <div className="profile-page__message profile-page__message--error">{historyError}</div>
              )}
              {!historyLoading && !historyError && loginHistory.length === 0 && (
                <div className="profile-page__login-history-empty">{t('profilePage.security.noHistory')}</div>
              )}
              {!historyLoading && loginHistory.length > 0 && (
                <table className="profile-page__history-table">
                  <thead>
                    <tr>
                      <th>{t('profilePage.security.historyTime')}</th>
                      <th>{t('profilePage.security.historyEvent')}</th>
                      <th>{t('profilePage.security.historyIp')}</th>
                      <th>{t('profilePage.security.historyDevice')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loginHistory.map(entry => (
                      <tr key={entry.id} className={entry.failureReason ? 'profile-page__history-row--failed' : ''}>
                        <td>{formatDateTime(entry.createdAt)}</td>
                        <td>
                          <span className={`profile-page__history-event profile-page__history-event--${entry.failureReason ? 'failed' : 'success'}`}>
                            {formatEventType(entry.eventType)}
                          </span>
                          {entry.failureReason && (
                            <span className="profile-page__history-reason">{entry.failureReason}</span>
                          )}
                        </td>
                        <td className="profile-page__history-mono">{entry.ipAddress ?? '—'}</td>
                        <td className="profile-page__history-device">{parseUserAgent(entry.userAgent)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Danger Zone */}
      <section className="profile-page__section profile-page__section--danger">
        <h2 className="profile-page__section-title">{t('profilePage.dangerZone.title')}</h2>
        <div className="profile-page__danger-content">
          <p className="profile-page__danger-text">{t('profilePage.dangerZone.deleteAccountDesc')}</p>
          {!deleteConfirmOpen ? (
            <button
              className="profile-page__btn profile-page__btn--danger"
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              {t('profilePage.dangerZone.deleteButton')}
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--spacing-sm)', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-danger)', fontWeight: 500 }}>
                {t('profilePage.dangerZone.deleteConfirm')}
              </span>
              <button
                className="profile-page__btn profile-page__btn--danger profile-page__btn--sm"
                type="button"
                onClick={handleDeleteAccount}
              >
                {t('profilePage.dangerZone.deleteButton')}
              </button>
              <button
                className="profile-page__btn profile-page__btn--secondary profile-page__btn--sm"
                type="button"
                onClick={() => setDeleteConfirmOpen(false)}
              >
                {t('common.buttons.cancel')}
              </button>
            </div>
          )}
        </div>
      </section>

    </main>
  );
}
