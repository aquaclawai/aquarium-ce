import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Zap, Bot } from 'lucide-react';
import { Button } from '@/components/ui';
import './QuickStartBanner.css';

export function QuickStartBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="quick-start-banner">
      <div className="quick-start-banner__content">
        <div className="quick-start-banner__icon">
          <Zap size={22} />
        </div>
        <div className="quick-start-banner__text">
          <h3 className="quick-start-banner__title">{t('dashboard.quickStart.title')}</h3>
          <p className="quick-start-banner__desc">{t('dashboard.quickStart.description')}</p>
        </div>
      </div>
      <Button
        type="button"
        className="quick-start-banner__btn"
        onClick={() => navigate('/create')}
      >
        <Bot size={18} />
        <span>{t('dashboard.quickStart.button')}</span>
      </Button>
    </div>
  );
}
