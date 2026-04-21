import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { AlertTriangle, X } from 'lucide-react';
import type {
  DaemonToken,
  DaemonTokenCreatedResponse,
} from '@aquarium/shared';
import { api } from '../../api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

/**
 * Phase 25 Plan 25-03 — Daemon token create modal (MGMT-03 HARD).
 *
 * Two-step flow:
 *   Step A (form)       → user fills name (required, ≤100 chars) + optional expiry
 *   Step B (copy-once)  → server returned the adt_* string; shown EXACTLY ONCE
 *
 * STRUCTURAL SECURITY CONTRACT (see plan 25-03 HARD invariants):
 *   1. The adt_* string lives in one place only — the local React state
 *      below. `setPlaintext(null)` on dismiss clears it; the Dialog
 *      portal unmount tears down the associated DOM.
 *   2. The sensitive string is kept out of browser storage (CI grep guard
 *      enforces the wider invariant at the management subtree).
 *   3. The sensitive string does NOT enter URL, history, or the page title.
 *   4. No structured log output in this file — the submit catch block
 *      swallows the thrown error because an ApiError message from the
 *      server could in theory echo payload fields. Toast copy is i18n only.
 *   5. Not interpolated through i18n. `management.daemonTokens.a11y.*`
 *      keys interpolate `{{name}}` only; the locale-files scan is clean.
 *   6. Rendered as a React text child inside <pre> (auto-escaped). The
 *      select-all class enables fallback manual copy.
 *   7. Parent callback `onCreated(token)` receives the hashed-projection
 *      `DaemonToken` shape — type-enforced absence of a sensitive field
 *      prevents accidental leakage through the parent boundary.
 *   8. Escape / click-outside on Step B triggers a nested confirm-close Dialog.
 *      The user must explicitly confirm before the sensitive state clears.
 */

interface DaemonTokenCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (token: DaemonToken) => void;
}

interface FormValue {
  name: string;
  expiresAt: string; // 'YYYY-MM-DD' or '' (empty = never)
}

interface FormErrors {
  name?: string;
  expiresAt?: string;
}

const EMPTY_FORM: FormValue = { name: '', expiresAt: '' };
const MAX_NAME_LENGTH = 100;

/** Today in 'YYYY-MM-DD' — used as `min` attribute on the date input. */
function todayIso(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function DaemonTokenCreateModal({
  open,
  onOpenChange,
  onCreated,
}: DaemonTokenCreateModalProps) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'form' | 'copy-once'>('form');
  const [form, setForm] = useState<FormValue>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // THE ONLY place the sensitive adt_* string lives.
  const [plaintext, setPlaintext] = useState<string | null>(null);

  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Reset every time the modal (re)opens so stale state never leaks across
  // invocations. If the user dismisses copy-once properly, state is already
  // null → the reset is cheap and idempotent.
  useEffect(() => {
    if (open) {
      setStep('form');
      setForm(EMPTY_FORM);
      setErrors({});
      setIsSubmitting(false);
      setPlaintext(null);
      setCopyState('idle');
      setConfirmCloseOpen(false);
    }
  }, [open]);

  /**
   * Clears sensitive state then propagates the close to the parent.
   * Called from: "I've saved it" button, confirm-close "Close anyway",
   * and (indirectly) the Dialog controlled-close flow when step === 'form'.
   */
  function dismissCopyOnce(): void {
    setPlaintext(null);
    setStep('form');
    setCopyState('idle');
    setConfirmCloseOpen(false);
    onOpenChange(false);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (isSubmitting) return;

    // Local validation.
    const nextErrors: FormErrors = {};
    const trimmedName = form.name.trim();
    if (trimmedName.length === 0) {
      nextErrors.name = t('management.daemonTokens.createModal.name.required');
    } else if (trimmedName.length > MAX_NAME_LENGTH) {
      nextErrors.name = t('management.daemonTokens.createModal.name.tooLong');
    }
    if (form.expiresAt !== '') {
      // Parse as local-midnight; compare against today.
      const expDate = new Date(`${form.expiresAt}T23:59:59`);
      if (!Number.isFinite(expDate.getTime()) || expDate.getTime() <= Date.now()) {
        nextErrors.expiresAt = t(
          'management.daemonTokens.createModal.expiry.future',
        );
      }
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    setIsSubmitting(true);

    try {
      // Convert 'YYYY-MM-DD' → ISO (end-of-day UTC) or null. Server stores
      // as-is; the client derives status via deriveTokenStatus so an
      // end-of-day timestamp renders correctly on the same-day boundary.
      const expiresAt =
        form.expiresAt === ''
          ? null
          : new Date(`${form.expiresAt}T23:59:59.999Z`).toISOString();

      const resp = await api.post<DaemonTokenCreatedResponse>(
        '/daemon-tokens',
        { name: trimmedName, expiresAt },
      );

      // The single line that touches the sensitive string.
      setPlaintext(resp.plaintext);
      setStep('copy-once');
      // Propagate the hashed-projection to the parent so the list refetches
      // and the sr-only announcer fires (name-only interpolation).
      onCreated(resp.token);
    } catch {
      // IMPORTANT: do NOT log the thrown error — ApiError messages can echo
      // server payload fields. Toast copy is i18n-driven only; the error
      // object is swallowed without any structured output.
      toast.error(t('management.daemonTokens.createModal.createFailed'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCopy(): Promise<void> {
    if (plaintext === null) return;
    try {
      await navigator.clipboard.writeText(plaintext);
      setCopyState('copied');
      // NOTE: a11y announcer lives on the parent page; it uses the
      // `management.daemonTokens.a11y.copied` key which is zero-interpolation.
      // NO structured logging — the sensitive string must not reach any
      // developer-tools output channel.
    } catch {
      // Swallow the error — failure is conveyed via UI state only so the
      // sensitive string never reaches a dev-tools output stream.
      setCopyState('failed');
    }
  }

  /**
   * Intercept the root Dialog's close flow.
   *   - Step A (form): close immediately; nothing sensitive to protect.
   *   - Step B (copy-once) with plaintext still held: block the close and
   *     raise the confirm-close nested dialog instead.
   */
  function handleRootOpenChange(next: boolean): void {
    if (next) {
      onOpenChange(true);
      return;
    }
    if (step === 'copy-once' && plaintext !== null) {
      setConfirmCloseOpen(true);
      return;
    }
    dismissCopyOnce();
  }

  const submitLabel = isSubmitting
    ? t('management.daemonTokens.createModal.actions.creating')
    : t('management.daemonTokens.createModal.actions.create');

  const copyButtonLabel =
    copyState === 'copied'
      ? t('management.daemonTokens.copyOnce.copied')
      : copyState === 'failed'
        ? t('management.daemonTokens.copyOnce.copyFailed')
        : t('management.daemonTokens.copyOnce.copyButton');

  return (
    <>
      <Dialog open={open} onOpenChange={handleRootOpenChange}>
        <DialogContent className="max-w-[520px] p-0">
          {step === 'form' ? (
            <form onSubmit={handleSubmit} className="flex flex-col">
              <DialogHeader className="p-6 pb-4">
                <DialogTitle>
                  {t('management.daemonTokens.createModal.title')}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {t('management.daemonTokens.createModal.title')}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 px-6 pb-4">
                {/* Name */}
                <div className="space-y-2">
                  <label
                    className="text-sm font-semibold"
                    htmlFor="token-form-name"
                  >
                    {t('management.daemonTokens.createModal.name.label')}
                  </label>
                  <Input
                    ref={nameInputRef}
                    id="token-form-name"
                    data-token-form-field="name"
                    autoFocus
                    maxLength={MAX_NAME_LENGTH}
                    placeholder={t(
                      'management.daemonTokens.createModal.name.placeholder',
                    )}
                    value={form.name}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, name: e.target.value }))
                    }
                    aria-invalid={errors.name ? 'true' : 'false'}
                  />
                  {errors.name ? (
                    <p className="text-xs text-destructive" role="alert">
                      {errors.name}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t('management.daemonTokens.createModal.name.hint')}
                    </p>
                  )}
                </div>

                {/* Expiry */}
                <div className="space-y-2">
                  <label
                    className="text-sm font-semibold"
                    htmlFor="token-form-expires-at"
                  >
                    {t('management.daemonTokens.createModal.expiry.label')}
                  </label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="token-form-expires-at"
                      data-token-form-field="expiresAt"
                      type="date"
                      min={todayIso()}
                      value={form.expiresAt}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, expiresAt: e.target.value }))
                      }
                      aria-invalid={errors.expiresAt ? 'true' : 'false'}
                      className="max-w-[200px]"
                    />
                    {form.expiresAt !== '' ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setForm((f) => ({ ...f, expiresAt: '' }))
                        }
                      >
                        {t('management.daemonTokens.createModal.expiry.clear')}
                      </Button>
                    ) : null}
                  </div>
                  {errors.expiresAt ? (
                    <p className="text-xs text-destructive" role="alert">
                      {errors.expiresAt}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t('management.daemonTokens.createModal.expiry.hint')}
                    </p>
                  )}
                </div>
              </div>

              <DialogFooter className="px-6 py-4 border-t border-border gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  disabled={isSubmitting}
                >
                  {t('common.buttons.cancel')}
                </Button>
                <Button
                  type="submit"
                  data-token-form-submit
                  disabled={isSubmitting}
                >
                  {submitLabel}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            // Step B — copy-once view.
            <div className="flex flex-col">
              <DialogHeader className="p-6 pb-4">
                <DialogTitle>
                  {t('management.daemonTokens.copyOnce.title')}
                </DialogTitle>
                <DialogDescription className="sr-only">
                  {t('management.daemonTokens.copyOnce.title')}
                </DialogDescription>
              </DialogHeader>

              <div className="px-6 pb-4 space-y-4">
                {/* Warning callout */}
                <div
                  className="p-3 rounded flex gap-2 items-start bg-[var(--color-warning-subtle-bg)] text-[var(--color-warning-subtle-text)]"
                  role="note"
                >
                  <AlertTriangle
                    className="h-4 w-4 mt-0.5 shrink-0"
                    aria-label={t(
                      'management.daemonTokens.copyOnce.warningIcon',
                    )}
                  />
                  <p className="text-sm">
                    {t('management.daemonTokens.copyOnce.warning')}
                  </p>
                </div>

                {/* Token block — React text child inside <pre>. select-all
                    gives users a fallback when Clipboard API is blocked. */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">
                    {t('management.daemonTokens.copyOnce.tokenLabel')}
                  </label>
                  <pre
                    data-token-plaintext
                    className="p-4 text-xs font-mono bg-muted rounded select-all break-all whitespace-pre-wrap"
                  >
                    {plaintext}
                  </pre>
                </div>
              </div>

              <DialogFooter className="px-6 py-4 border-t border-border gap-3">
                <Button
                  type="button"
                  variant="outline"
                  data-token-dismiss
                  onClick={dismissCopyOnce}
                >
                  {t('management.daemonTokens.copyOnce.dismiss')}
                </Button>
                <Button
                  type="button"
                  data-token-copy-button
                  variant={copyState === 'copied' ? 'secondary' : 'default'}
                  onClick={handleCopy}
                >
                  {copyButtonLabel}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Nested confirm-close Dialog — Escape / click-outside / X on Step B
          routes here. The user must explicitly confirm before the plaintext
          state clears. Destructive variant on the confirm button. */}
      <Dialog
        open={confirmCloseOpen}
        onOpenChange={(next) => {
          if (!next) setConfirmCloseOpen(false);
        }}
      >
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {t('management.daemonTokens.copyOnce.confirmClose.title')}
            </DialogTitle>
            <DialogDescription>
              {t('management.daemonTokens.copyOnce.confirmClose.body')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-3">
            <Button
              type="button"
              variant="default"
              autoFocus
              onClick={() => setConfirmCloseOpen(false)}
            >
              {t('management.daemonTokens.copyOnce.confirmClose.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              data-token-close-confirm-ok
              onClick={dismissCopyOnce}
            >
              {t('management.daemonTokens.copyOnce.confirmClose.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// X is re-exported only to keep an unused-import lint clean if the file
// evolves to render an explicit close icon. Currently the shadcn Dialog
// primitive ships its own close glyph in DialogContent.
void X;
