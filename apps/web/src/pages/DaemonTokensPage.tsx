import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DaemonToken } from '@aquarium/shared';
import { Button } from '@/components/ui/button';
import { DaemonTokenList } from '@/components/management/DaemonTokenList';
import { useDaemonTokens } from '@/components/management/useDaemonTokens';

/**
 * DaemonTokensPage — Phase 25 Wave 3 / plan 25-03.
 *
 * Orchestrates the /daemon-tokens surface:
 *   - list (DaemonTokenList) with derived status + Revoke action
 *   - create (DaemonTokenCreateModal — wired in Task 2; two-step form +
 *     copy-once plaintext view; plaintext lives ONLY in local useState
 *     inside the modal)
 *   - revoke (RevokeConfirmDialog — wired in Task 3)
 *
 * MGMT-03 HARD invariant: the plaintext `adt_*` token never reaches this
 * page component. The modal's `onCreated` callback receives only the
 * hashed-projection `DaemonToken` shape (no `plaintext` field — type-
 * enforced). The sr-only announcer interpolates `{{name}}` only, never
 * plaintext.
 */
export function DaemonTokensPage() {
  const { t } = useTranslation();
  const { tokens, isLoading, error, refetch, revoke } = useDaemonTokens();
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<DaemonToken | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // Silence unused-variable lint for Task 2/3 wiring — these are activated
  // by subsequent tasks in the same plan. Keeping the state + handler
  // references in Task 1 lets Task 2/3 wire the imports at their boundary.
  void createOpen;
  void setCreateOpen;
  void revokeTarget;
  void setRevokeTarget;
  void revoke;
  void setAnnouncement;
  void refetch;

  return (
    <main
      data-page="daemon-tokens"
      className="mx-auto max-w-[1200px] p-6 pb-8"
    >
      <header className="mb-6">
        <h1 className="text-2xl font-medium mb-2">
          {t('management.daemonTokens.title')}
        </h1>
        <p className="text-sm text-muted-foreground max-w-[720px]">
          {t('management.daemonTokens.description')}
        </p>
      </header>

      <div className="flex items-center justify-end mb-4">
        <Button
          data-token-create-open
          onClick={() => setCreateOpen(true)}
        >
          {t('management.daemonTokens.actions.create')}
        </Button>
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-4 p-3 rounded border border-destructive bg-destructive/10 text-sm text-destructive"
        >
          {t('management.daemonTokens.loadFailed', { retry: '' })}
        </div>
      ) : null}

      <DaemonTokenList
        tokens={tokens}
        isLoading={isLoading}
        onRevoke={(t) => setRevokeTarget(t)}
        onOpenCreate={() => setCreateOpen(true)}
      />

      {/*
        sr-only a11y announcer. NEVER interpolates plaintext — only
        `{{name}}` via the `management.daemonTokens.a11y.*` keys.
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </main>
  );
}
