import { useTranslation } from 'react-i18next';
import { supportedLanguages, type SupportedLanguage } from '../i18n';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui';

export function LanguageSelector() {
  const { i18n } = useTranslation();
  const currentLang = (i18n.language?.substring(0, 2) || 'en') as SupportedLanguage;

  return (
    <Select value={currentLang} onValueChange={(val) => i18n.changeLanguage(val)}>
      <SelectTrigger aria-label="Language" style={{ width: 'auto', minWidth: '80px' }}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Object.entries(supportedLanguages).map(([code, { label, flag }]) => (
          <SelectItem key={code} value={code}>
            {flag} {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
