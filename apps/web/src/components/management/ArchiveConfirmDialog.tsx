import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Agent } from '@aquarium/shared';
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
 * Phase 25 Plan 25-01 — destructive (+ positive) confirmation for archive
 * and restore.
 *
 * Mode `archive` uses `variant="destructive"` on the confirm button per
 * UI-SPEC §Destructive confirmation pattern. Mode `restore` is a positive
 * action → `variant="default"`. Cancel button autoFocuses so Enter does
 * NOT immediately confirm the destructive action.
 *
 * Confirm handler is awaited — while in-flight both buttons disable and
 * the parent mutation (archive/restore) runs through useAgents. On success
 * the parent closes this dialog; on failure we keep it open so the user
 * can retry.
 */

interface ArchiveConfirmDialogProps {
  agent: Agent | null;
  mode: 'archive' | 'restore';
  onConfirm: () => Promise<void>;
  onOpenChange: (open: boolean) => void;
}

export function ArchiveConfirmDialog({
  agent,
  mode,
  onConfirm,
  onOpenChange,
}: ArchiveConfirmDialogProps) {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);

  // Guard — do not render an archive/restore Dialog with no agent context.
  if (!agent) return null;

  const isArchive = mode === 'archive';
  const titleKey = isArchive
    ? 'management.agents.archiveConfirm.title'
    : 'management.agents.restoreConfirm.title';
  const bodyKey = isArchive
    ? 'management.agents.archiveConfirm.body'
    : 'management.agents.restoreConfirm.body';
  const confirmLabelKey = isArchive
    ? 'management.agents.archiveConfirm.confirm'
    : 'management.agents.restoreConfirm.confirm';

  const handleConfirm = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await onConfirm();
      // Parent controls close-on-success; ArchiveConfirmDialog just finishes.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={agent !== null}
      onOpenChange={(open) => {
        if (submitting) return;
        onOpenChange(open);
      }}
    >
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t(titleKey, { name: agent.name })}</DialogTitle>
          <DialogDescription>{t(bodyKey)}</DialogDescription>
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
          {isArchive ? (
            <Button
              type="button"
              variant="destructive"
              data-agent-archive-confirm
              onClick={handleConfirm}
              disabled={submitting}
            >
              {t(confirmLabelKey)}
            </Button>
          ) : (
            <Button
              type="button"
              data-agent-restore-confirm
              onClick={handleConfirm}
              disabled={submitting}
            >
              {t(confirmLabelKey)}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
