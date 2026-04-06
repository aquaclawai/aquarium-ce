import { useTranslation } from 'react-i18next';

interface ConfirmRestartDialogProps {
  pluginName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmRestartDialog({ pluginName, onConfirm, onCancel }: ConfirmRestartDialogProps) {
  const { t } = useTranslation();

  return (
    <div className="confirm-restart-dialog-overlay" role="dialog" aria-modal="true" aria-labelledby="confirm-restart-title">
      <div className="confirm-restart-dialog">
        <h2 id="confirm-restart-title" className="confirm-restart-dialog__title">
          {t('extensions.confirmRestart.title')}
        </h2>
        <p className="confirm-restart-dialog__plugin-name">{pluginName}</p>
        <p className="confirm-restart-dialog__message">
          {t('extensions.confirmRestart.message')}
        </p>
        <div className="confirm-restart-dialog__actions">
          <button
            className="btn btn--sm"
            onClick={onCancel}
          >
            {t('extensions.confirmRestart.cancel')}
          </button>
          <button
            className="btn btn--primary btn--sm"
            onClick={onConfirm}
          >
            {t('extensions.confirmRestart.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
