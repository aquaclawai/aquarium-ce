import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { InstancePublic } from '@aquarium/shared';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';
import '../../pages/AssistantChatPage.css';

export interface ChatTopbarProps {
  instance: InstancePublic | null;
  showSettings: boolean;
  onToggleSettings: () => void;
  sessionModel: string;
  onSessionModelChange: (v: string) => void;
  sessionThinking: string;
  onSessionThinkingChange: (v: string) => void;
  savingSettings: boolean;
  onSaveSettings: () => void;
  modelSuggestions: string[];
  onNewChat: () => string;
  onOpenDrawer: () => void;
  drawerOpen: boolean;
}

export function ChatTopbar({
  instance,
  showSettings,
  onToggleSettings,
  sessionModel,
  onSessionModelChange,
  sessionThinking,
  onSessionThinkingChange,
  savingSettings,
  onSaveSettings,
  modelSuggestions,
  onOpenDrawer,
  drawerOpen,
}: ChatTopbarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isRunning = instance?.status === 'running';

  return (
    <>
      <header className="achat-topbar">
        <Button variant="ghost" className="achat-topbar__back" onClick={() => navigate('/assistants')}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M13 4L7 10L13 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
        <div className="achat-topbar__avatar">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <rect x="3" y="7" width="14" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 7V5.5A1.5 1.5 0 0 1 8.5 4h3A1.5 1.5 0 0 1 13 5.5V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div className="achat-topbar__info">
          <span className="achat-topbar__name">{instance?.name ?? ''}</span>
          <span className="achat-topbar__status">
            {isRunning && <span className="achat-topbar__dot" />}
            {isRunning
              ? `${t('assistantChat.online')} · ${t('assistantChat.alwaysReady')}`
              : t(`common.status.${instance?.status ?? 'stopped'}`)}
          </span>
        </div>
        <Button variant="ghost" className="achat-settings-btn" onClick={onToggleSettings}>
          {t('chat.settings')}
        </Button>
        <Button
          variant="ghost"
          className={`achat-drawer-toggle${drawerOpen ? ' achat-drawer-toggle--shifted' : ''}`}
          onClick={onOpenDrawer}
          title={t('chat.sessionDrawer.toggleSessions')}
          aria-label={t('chat.sessionDrawer.toggleSessions')}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
            <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </Button>
      </header>

      {showSettings && (
        <div className="achat-settings-panel">
          <div className="achat-settings-field">
            <label>{t('chat.sessionSettings.modelLabel')}</label>
            <Input
              type="text"
              value={sessionModel}
              onChange={e => onSessionModelChange(e.target.value)}
              placeholder={t('chat.sessionSettings.modelPlaceholder')}
              list="achat-model-suggestions"
            />
            <datalist id="achat-model-suggestions">
              {modelSuggestions.map(m => <option key={m} value={m} />)}
            </datalist>
          </div>
          <div className="achat-settings-field">
            <label>{t('chat.sessionSettings.thinkingLevelLabel')}</label>
            <Select value={sessionThinking || 'default'} onValueChange={v => onSessionThinkingChange(v === 'default' ? '' : v)}>
              <SelectTrigger>
                <SelectValue placeholder={t('chat.sessionSettings.thinkingLevels.default')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">{t('chat.sessionSettings.thinkingLevels.default')}</SelectItem>
                <SelectItem value="off">{t('chat.sessionSettings.thinkingLevels.off')}</SelectItem>
                <SelectItem value="low">{t('chat.sessionSettings.thinkingLevels.low')}</SelectItem>
                <SelectItem value="medium">{t('chat.sessionSettings.thinkingLevels.medium')}</SelectItem>
                <SelectItem value="high">{t('chat.sessionSettings.thinkingLevels.high')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="achat-settings-actions">
            <Button className="achat-settings-save-btn" onClick={onSaveSettings} disabled={savingSettings}>
              {savingSettings ? t('chat.sessionSettings.saving') : t('chat.sessionSettings.save')}
            </Button>
            <Button variant="ghost" onClick={onToggleSettings}>{t('common.buttons.cancel')}</Button>
          </div>
        </div>
      )}
    </>
  );
}
