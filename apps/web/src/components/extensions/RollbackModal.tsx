import { useTranslation } from 'react-i18next';

interface RollbackModalProps {
  pluginName: string;
  errorMessage: string;
  technicalDetails?: string;
  onClose: () => void;
  onRetry: () => void;
}

export function RollbackModal({ pluginName, errorMessage, technicalDetails, onClose, onRetry }: RollbackModalProps) {
  const { t } = useTranslation();

  return (
    <div className="rollback-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="rollback-modal-title">
      <div className="rollback-modal">
        <h2 id="rollback-modal-title" className="rollback-modal__title">
          {t('extensions.rollback.title')}
        </h2>

        <p className="rollback-modal__message">
          {t('extensions.rollback.message', { name: pluginName })}
        </p>

        <p className="rollback-modal__error">{errorMessage}</p>

        {technicalDetails && (
          <details className="rollback-modal__details">
            <summary className="rollback-modal__details-summary">
              {t('extensions.rollback.showDetails')}
            </summary>
            <pre className="rollback-modal__details-content">{technicalDetails}</pre>
          </details>
        )}

        <div className="rollback-modal__actions">
          <button
            className="btn btn--sm"
            onClick={onClose}
          >
            {t('extensions.rollback.close')}
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={onRetry}
          >
            {t('extensions.rollback.retry')}
          </button>
        </div>
      </div>
    </div>
  );
}
