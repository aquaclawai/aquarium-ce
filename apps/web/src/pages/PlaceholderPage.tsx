import { useTranslation } from 'react-i18next';

interface PlaceholderPageProps {
  titleKey: string;
}

export function PlaceholderPage({ titleKey }: PlaceholderPageProps) {
  const { t } = useTranslation();

  return (
    <main className="dashboard-page">
      <h1>{t(titleKey)}</h1>
      <div className="info-message">{t('common.comingSoon')}</div>
    </main>
  );
}
