import { useTranslation } from 'react-i18next';

/**
 * RuntimesPage — Phase 25 Wave 0 scaffold.
 *
 * Thin route stub reserved for Wave 2 / plan 25-02 to replace with the
 * unified runtimes list (hosted instances + local daemons + cloud
 * daemons) with kind filter + status badge + device info detail drawer.
 */
export function RuntimesPage() {
  const { t } = useTranslation();
  return (
    <main data-page="runtimes" className="mx-auto max-w-[1200px] p-6 pb-8">
      <h1 className="text-2xl font-medium mb-4">{t('management.runtimes.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('management.runtimes.description')}</p>
    </main>
  );
}
