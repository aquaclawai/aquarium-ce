import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Zap, Clock, MessageSquare, Eye, Settings, Power } from 'lucide-react';
import type { InstancePublic } from '@aquarium/shared';
import { AgentAvatar } from '../AgentAvatar';
import { formatModelDisplayName } from '../../utils/provider-display';
import '../../pages/MyAssistantsPage.css';

interface AssistantCardProps {
  instance: InstancePublic;
  modelName: string | null;
  onAction: (instanceId: string, action: 'start' | 'stop') => void;
  actionInProgress: string | null;
}

function formatVersion(imageTag: string): string {
  if (imageTag === 'latest') return 'latest';
  return imageTag.startsWith('v') ? imageTag : `v${imageTag}`;
}

export function AssistantCard({ instance, modelName, onAction, actionInProgress }: AssistantCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const isTransitioning = instance.status === 'starting' || instance.status === 'stopping';
  const isBusy = isTransitioning || actionInProgress === instance.id;
  const isRunning = instance.status === 'running';
  const canStart = instance.status === 'stopped' || instance.status === 'created' || instance.status === 'error';

  return (
    <div className="assistant-card">
      <div className="assistant-card__icon">
        <AgentAvatar avatar={instance.avatar} name={instance.name} size="md" />
      </div>

      <div className="assistant-card__info">
        <div className="assistant-card__primary">
          <span className="assistant-card__name">{instance.name}</span>
          <span className={`status-badge status-${instance.status}`}>
            {isTransitioning && <span className="spinner" />}
            {t(`common.status.${instance.status}`)}
          </span>
          <span className="assistant-card__version">{formatVersion(instance.imageTag)}</span>
        </div>
        <div className="assistant-card__meta">
          {modelName && (
            <span className="assistant-card__meta-item">
              <Zap size={14} />
              {formatModelDisplayName(modelName)}
            </span>
          )}
          <span className="assistant-card__meta-item">
            <Clock size={14} />
            {new Date(instance.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </div>

      <div className="assistant-card__actions">
        <button
          className="assistant-card__action assistant-card__action--primary"
          onClick={() => navigate(`/assistants/${instance.id}/chat`)}
          disabled={isBusy}
        >
          <MessageSquare size={14} />
          {t('myAssistants.chat')}
        </button>
        <button
          className="assistant-card__action"
          onClick={() => navigate(`/instances/${instance.id}`)}
          disabled={isBusy}
        >
          <Eye size={14} />
          {t('myAssistants.view')}
        </button>
        <button
          className="assistant-card__action"
          onClick={() => navigate(`/assistants/${instance.id}/edit`)}
          disabled={isBusy}
        >
          <Settings size={14} />
          {t('myAssistants.configure')}
        </button>
        {isRunning && (
          <button
            className="assistant-card__action assistant-card__action--danger"
            onClick={() => onAction(instance.id, 'stop')}
            disabled={isBusy}
          >
            <Power size={14} />
            {t('myAssistants.disable')}
          </button>
        )}
        {canStart && (
          <button
            className="assistant-card__action assistant-card__action--success"
            onClick={() => onAction(instance.id, 'start')}
            disabled={isBusy}
          >
            <Power size={14} />
            {t('myAssistants.enable')}
          </button>
        )}
      </div>
    </div>
  );
}
