import { useTranslation } from 'react-i18next';

const LITELLM_UI_URL = 'https://litellm-ui.aquaclaw.ai';

export function LitellmUiTab() {
  const { t } = useTranslation();

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <h3>{t('admin.litellm.title', 'LiteLLM Dashboard')}</h3>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: '1.5rem' }}>
        {t('admin.litellm.description', 'Manage LLM models, API keys, and usage tracking in the LiteLLM admin dashboard.')}
      </p>
      <a
        href={LITELLM_UI_URL}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'inline-block',
          padding: '0.75rem 2rem',
          backgroundColor: 'var(--color-primary)',
          color: '#fff',
          borderRadius: '8px',
          textDecoration: 'none',
          fontWeight: 500,
        }}
      >
        {t('admin.litellm.openDashboard', 'Open LiteLLM Dashboard')} ↗
      </a>
    </div>
  );
}
