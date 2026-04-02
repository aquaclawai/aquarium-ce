import { useTranslation } from 'react-i18next';
import { supportedLanguages, type SupportedLanguage } from '../i18n';

export function LanguageSelector() {
  const { i18n } = useTranslation();
  const currentLang = (i18n.language?.substring(0, 2) || 'en') as SupportedLanguage;

  return (
    <select
      value={currentLang}
      onChange={(e) => i18n.changeLanguage(e.target.value)}
      style={{
        padding: '0.25rem 0.5rem',
        borderRadius: '6px',
        border: '1px solid var(--border)',
        background: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        fontSize: '0.85rem',
        cursor: 'pointer',
      }}
      aria-label="Language"
    >
      {Object.entries(supportedLanguages).map(([code, { label, flag }]) => (
        <option key={code} value={code}>
          {flag} {label}
        </option>
      ))}
    </select>
  );
}
