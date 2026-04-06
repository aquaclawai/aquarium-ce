import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { api } from '../../api';
import { Button, Input } from '@/components/ui';
import type { ChannelRegistryItem } from '@aquarium/shared';
import { ChannelIcon } from './ChannelIcon';
import { ChannelStatusBadge } from './ChannelStatusBadge';
import { QrSetupFlow } from './QrSetupFlow';

interface ChannelConfigDrawerProps {
  channel: ChannelRegistryItem;
  instanceId: string;
  onClose: () => void;
  onUpdate: (channelId: string) => void;
}

export function ChannelConfigDrawer({ channel, instanceId, onClose, onUpdate }: ChannelConfigDrawerProps) {
  const { t } = useTranslation();
  const [saving, setSaving] = useState(false);
  const [installingPlugin, setInstallingPlugin] = useState(false);
  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const field of channel.fields) {
      init[field.key] = '';
    }
    return init;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const needsPlugin = channel.pluginRequired && !channel.pluginInstalled;

  const validateField = (key: string, value: string): string | null => {
    const field = channel.fields.find(f => f.key === key);
    if (!field) return null;
    if (field.required && !value.trim()) return 'Required';
    if (field.pattern && value.trim() && !new RegExp(field.pattern).test(value.trim())) {
      return field.patternError ?? 'Invalid format';
    }
    return null;
  };

  const handleFieldChange = (key: string, value: string) => {
    setFormValues(prev => ({ ...prev, [key]: value }));
    // Clear error on edit
    if (errors[key]) setErrors(prev => { const n = { ...prev }; delete n[key]; return n; });
  };

  const handleSave = async () => {
    // Validate all fields
    const newErrors: Record<string, string> = {};
    for (const field of channel.fields) {
      const err = validateField(field.key, formValues[field.key] ?? '');
      if (err) newErrors[field.key] = err;
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    try {
      await api.post(`/instances/${instanceId}/channels/${channel.id}/configure`, formValues);
      toast.success(`${channel.label} ${t('channels.drawer.configured')}`);
      onUpdate(channel.id);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Configuration failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm(t('channels.drawer.disconnectConfirm', { channel: channel.label }))) return;
    setSaving(true);
    try {
      await api.post(`/instances/${instanceId}/channels/${channel.id}/disconnect`, {});
      toast.success(`${channel.label} disconnected`);
      onUpdate(channel.id);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="channel-drawer-backdrop" onClick={onClose} />
      <div className="channel-drawer" role="dialog" aria-label={channel.label}>
        <div className="channel-drawer__header">
          <ChannelIcon icon={channel.icon} size="lg" />
          <div>
            <h3>{t(channel.labelKey, channel.label)}</h3>
            <p className="channel-drawer__desc">{t(channel.descriptionKey, channel.description)}</p>
          </div>
          <button className="channel-drawer__close" onClick={onClose} aria-label="Close">&times;</button>
        </div>

        <div className="channel-drawer__body">
          {/* Status */}
          <section className="channel-drawer__section">
            <h4>{t('channels.drawer.status')}</h4>
            <ChannelStatusBadge status={channel.status} hasCredentials={channel.hasCredentials} />
          </section>

          {/* Plugin gate */}
          {needsPlugin && (
            <section className="channel-drawer__section channel-drawer__plugin-gate">
              <h4>{t('channels.drawer.pluginRequired')}</h4>
              <p>{t('channels.drawer.pluginRequiredDesc', { channel: channel.label, pluginId: channel.pluginInstall?.pluginId ?? '' })}</p>
              <Button
                disabled={installingPlugin || !channel.pluginInstall}
                onClick={async () => {
                  if (!channel.pluginInstall) return;
                  setInstallingPlugin(true);
                  try {
                    await api.post(`/instances/${instanceId}/plugins/install`, {
                      pluginId: channel.pluginInstall.pluginId,
                      source: channel.pluginInstall.source,
                    });
                    toast.success(`${channel.pluginInstall.pluginId} plugin installed`);
                    onUpdate(channel.id);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Plugin install failed';
                    if (msg.includes('unknown method')) {
                      toast.error(`This gateway version does not support remote plugin install. Install manually via: openclaw plugins install ${channel.pluginInstall!.source && 'spec' in channel.pluginInstall!.source ? (channel.pluginInstall!.source as { spec: string }).spec : channel.pluginInstall!.pluginId}`);
                    } else {
                      toast.error(msg);
                    }
                  } finally {
                    setInstallingPlugin(false);
                  }
                }}
              >
                {installingPlugin ? t('channels.actions.installing') : t('channels.actions.installPlugin')}
              </Button>
              {channel.helpUrl && (
                <a href={channel.helpUrl} target="_blank" rel="noopener noreferrer" className="channel-drawer__help-link">
                  {t('channels.drawer.learnMore', 'Learn more')} &rarr;
                </a>
              )}
            </section>
          )}

          {/* Token setup form */}
          {!needsPlugin && channel.setupType === 'token' && channel.fields.length > 0 && (
            <section className="channel-drawer__section">
              <h4>{t('channels.drawer.configuration')}</h4>
              {channel.fields.map(field => (
                <div key={field.key} className="channel-drawer__field">
                  <label className="channel-drawer__label">
                    {t(field.labelKey, field.label)}
                    {field.required && <span className="channel-drawer__required">*</span>}
                  </label>
                  {field.type === 'textarea' ? (
                    <textarea
                      className="channel-drawer__textarea"
                      value={formValues[field.key] ?? ''}
                      onChange={e => handleFieldChange(field.key, e.target.value)}
                      placeholder={channel.hasCredentials ? '••••••••' : (field.placeholder ?? '')}
                      rows={4}
                    />
                  ) : (
                    <Input
                      type={field.type === 'password' ? 'password' : 'text'}
                      value={formValues[field.key] ?? ''}
                      onChange={e => handleFieldChange(field.key, e.target.value)}
                      placeholder={channel.hasCredentials ? '••••••••' : (field.placeholder ?? '')}
                    />
                  )}
                  {field.helpText && (
                    <p className="channel-drawer__help">
                      {t(field.helpTextKey ?? '', field.helpText)}
                      {field.helpUrl && (
                        <>
                          {' '}
                          <a href={field.helpUrl} target="_blank" rel="noopener noreferrer">{t('channels.drawer.learnMore', 'Learn more')}</a>
                        </>
                      )}
                    </p>
                  )}
                  {errors[field.key] && <p className="channel-drawer__error">{errors[field.key]}</p>}
                </div>
              ))}

              <div className="channel-drawer__actions">
                <Button onClick={handleSave} disabled={saving}>
                  {saving ? t('channels.actions.saving') : t('channels.actions.save')}
                </Button>
                {channel.hasCredentials && (
                  <Button variant="ghost" onClick={handleDisconnect} disabled={saving}>
                    {t('channels.actions.disconnect')}
                  </Button>
                )}
              </div>
            </section>
          )}

          {/* QR setup flow (WhatsApp, WeChat) */}
          {!needsPlugin && channel.setupType === 'qr' && (
            <QrSetupFlow
              channel={channel}
              instanceId={instanceId}
              onConnected={() => onUpdate(channel.id)}
              onDisconnect={() => { onUpdate(channel.id); onClose(); }}
            />
          )}
        </div>
      </div>
    </>
  );
}
