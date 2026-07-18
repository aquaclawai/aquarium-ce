import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { DaemonToken } from '@aquarium/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Phase 25 Plan 25-03 — destructive confirmation for daemon-token revoke.
 *
 * Mirrors the ArchiveConfirmDialog pattern from Plan 25-01: shadcn Dialog
 * with destructive-variant confirm + autoFocused Cancel button (so Enter
 * does NOT immediately confirm the destructive action per UI-SPEC
 * §Destructive confirmation pattern keyboard contract).
 *
 * The parent controls open state via `token !== null`; calling
 * `onOpenChange(false)` resets the target to null. The confirm handler
 * is awaited — while in-flight both buttons disable and the parent
 * mutation runs through `useDaemonTokens.revoke`. Dialog stays open on
 * error so the user can retry.
 */

interface RevokeConfirmDialogProps {
  token: DaemonToken | null;
  onConfirm: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

export function RevokeConfirmDialog({
  token,
  onConfirm,
  onOpenChange,
}: RevokeConfirmDialogProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);

  // Guard — no Dialog without a target.
  if (!token) return null;

  const handleConfirm = async (): Promise<void> => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
      toast.success(t('management.daemonTokens.revoke.success'));
      onOpenChange(false);
    } catch {
      toast.error(t('management.daemonTokens.revoke.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={token !== null}
      onOpenChange={(open) => {
        if (submitting) return;
        onOpenChange(open);
      }}
    >
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {t('management.daemonTokens.revokeConfirm.title', {
              name: token.name,
            })}
          </DialogTitle>
          <DialogDescription>
            {t('management.daemonTokens.revokeConfirm.body')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-3">
          <Button
            type="button"
            variant="outline"
            autoFocus
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            {t('common.buttons.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            data-token-revoke-confirm
            onClick={handleConfirm}
            disabled={submitting}
          >
            {t('management.daemonTokens.revokeConfirm.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
