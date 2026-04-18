import { useTranslation } from 'react-i18next';

/**
 * AgentsPage — Phase 25 Wave 0 scaffold.
 *
 * Thin route stub reserved for Wave 1 / plan 25-01 to replace with the
 * full Agents management UI (list + form + archive flow). The scaffold
 * exists so Wave 0 can register the `/agents` route + sidebar nav entry
 * and land the i18n namespace in all 6 locales before the feature wave.
 */
export function AgentsPage() {
  const { t } = useTranslation();
  return (
    <main data-page="agents" className="mx-auto max-w-[1200px] p-6 pb-8">
      <h1 className="text-2xl font-medium mb-4">{t('management.agents.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('management.agents.description')}</p>
    </main>
  );
}
