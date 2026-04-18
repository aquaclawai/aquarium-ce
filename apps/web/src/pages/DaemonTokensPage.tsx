import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DaemonToken } from '@aquarium/shared';
import { Button } from '@/components/ui/button';
import { DaemonTokenList } from '@/components/management/DaemonTokenList';
import { DaemonTokenCreateModal } from '@/components/management/DaemonTokenCreateModal';
import { RevokeConfirmDialog } from '@/components/management/RevokeConfirmDialog';
import { useDaemonTokens } from '@/components/management/useDaemonTokens';

/**
 * DaemonTokensPage — Phase 25 Wave 3 / plan 25-03.
 *
 * Orchestrates the /daemon-tokens surface:
 *   - list (DaemonTokenList) with derived status + Revoke action
 *   - create (DaemonTokenCreateModal — two-step form + copy-once view;
 *     sensitive adt_* string lives ONLY in local useState inside the modal)
 *   - revoke (RevokeConfirmDialog — wired in Task 3)
 *
 * MGMT-03 HARD invariant: the sensitive string never reaches this page
 * component. The modal's `onCreated` callback receives only the hashed
 * `DaemonToken` projection (no plaintext field — type-enforced). The
 * sr-only announcer interpolates `{{name}}` only, never the sensitive
 * string.
 */
export function DaemonTokensPage() {
  const { t } = useTranslation();
  const { tokens, isLoading, error, refetch, revoke } = useDaemonTokens();
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<DaemonToken | null>(null);
  const [announcement, setAnnouncement] = useState('');


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
        onRevoke={(tok) => setRevokeTarget(tok)}
        onOpenCreate={() => setCreateOpen(true)}
      />

      <DaemonTokenCreateModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(token) => {
          // Refetch so the new hashed row appears; announce via i18n key
          // that interpolates only the friendly name (never the sensitive
          // string — see MGMT-03 HARD invariant).
          void refetch();
          setAnnouncement(
            t('management.daemonTokens.a11y.created', { name: token.name }),
          );
        }}
      />

      <RevokeConfirmDialog
        token={revokeTarget}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        onConfirm={async () => {
          if (!revokeTarget) return;
          await revoke(revokeTarget.id);
          // a11y announce — interpolates only the friendly name, never the
          // sensitive adt_* string (type-enforced: the list hook never
          // holds plaintext in the first place).
          setAnnouncement(
            t('management.daemonTokens.a11y.revoked', {
              name: revokeTarget.name,
            }),
          );
        }}
      />

      {/*
        sr-only a11y announcer. NEVER interpolates the sensitive adt_*
        string — only `{{name}}` via the `management.daemonTokens.a11y.*`
        keys.
      */}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </main>
  );
}
