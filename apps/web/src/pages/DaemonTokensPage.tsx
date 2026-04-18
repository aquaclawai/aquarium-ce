import { useTranslation } from 'react-i18next';

/**
 * DaemonTokensPage — Phase 25 Wave 0 scaffold.
 *
 * Thin route stub reserved for Wave 3 / plan 25-03 to replace with the
 * daemon-token management UI (list + create-with-copy-once flow +
 * revoke). MGMT-03 HARD invariant: plaintext token never persists past
 * the copy-once modal (enforced by the CI grep guards landing in Task 2).
 */
export function DaemonTokensPage() {
  const { t } = useTranslation();
  return (
    <main data-page="daemon-tokens" className="mx-auto max-w-[1200px] p-6 pb-8">
      <h1 className="text-2xl font-medium mb-4">{t('management.daemonTokens.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('management.daemonTokens.description')}</p>
    </main>
  );
}
