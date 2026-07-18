import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { Agent, Runtime } from '@aquarium/shared';
import { api, ApiError } from '../../api';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { CustomEnvEditor } from './CustomEnvEditor';
import { CustomArgsEditor } from './CustomArgsEditor';

/**
 * Phase 25 Plan 25-01 — Agent create/edit form dialog.
 *
 * Handles both create and edit modes in a single shadcn Dialog. All fields
 * from UI-SPEC §Agent form are present: name, instructions (plain Textarea),
 * runtime (Select), customEnv (key-value editor), customArgs (tag input),
 * maxConcurrentTasks (number input 1..16).
 *
 * Submit surface:
 * - Local validation: empty name + out-of-range maxConcurrent
 * - Server errors: UNIQUE-constraint collision → localized nameCollision copy
 * - Other ApiError → toast.error with saveFailed; dialog stays open
 *
 * Radix Select disallows empty-string values, so we use a `__none__` sentinel
 * for the "No runtime" option and translate both directions at the boundary.
 */

const NO_RUNTIME_SENTINEL = '__none__';

interface AgentFormValue {
  name: string;
  instructions: string;
  runtimeId: string | null;
  customEnv: Record<string, string>;
  customArgs: string[];
  maxConcurrentTasks: number;
}

interface AgentFormErrors {
  name?: string;
  maxConcurrent?: string;
  submit?: string;
}

interface AgentFormDialogProps {
  mode: 'create' | 'edit';
  agent?: Agent;
  runtimes: Runtime[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (agent: Agent) => void;
}

const EMPTY_VALUE: AgentFormValue = {
  name: '',
  instructions: '',
  runtimeId: null,
  customEnv: {},
  customArgs: [],
  maxConcurrentTasks: 6, // matches server default in agent-store.ts
};

function agentToFormValue(agent: Agent): AgentFormValue {
  return {
    name: agent.name,
    instructions: agent.instructions,
    runtimeId: agent.runtimeId,
    customEnv: { ...agent.customEnv },
    customArgs: [...agent.customArgs],
    maxConcurrentTasks: agent.maxConcurrentTasks,
  };
}

export function AgentFormDialog({
  mode,
  agent,
  runtimes,
  open,
  onOpenChange,
  onSaved,
}: AgentFormDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState<AgentFormValue>(EMPTY_VALUE);
  const [errors, setErrors] = useState<AgentFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  // Reset on open change OR when the target agent id changes (edit→edit across
  // different agents without closing the dialog).
  useEffect(() => {
    if (open) {
      setValue(mode === 'edit' && agent ? agentToFormValue(agent) : EMPTY_VALUE);
      setErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, agent?.id, mode]);

  const title =
    mode === 'edit'
      ? t('management.agents.form.titleEdit')
      : t('management.agents.form.titleCreate');
  const submitLabel =
    mode === 'edit'
      ? t('management.agents.form.actions.save')
      : t('management.agents.form.actions.create');

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSubmitting) return;

    // Local validation.
    const nextErrors: AgentFormErrors = {};
    if (value.name.trim().length === 0) {
      nextErrors.name = t('management.agents.form.validation.nameRequired');
    }
    if (
      !Number.isInteger(value.maxConcurrentTasks) ||
      value.maxConcurrentTasks < 1 ||
      value.maxConcurrentTasks > 16
    ) {
      nextErrors.maxConcurrent = t('management.agents.form.maxConcurrent.validation');
    }
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);
    try {
      const body = {
        name: value.name.trim(),
        instructions: value.instructions,
        runtimeId: value.runtimeId,
        customEnv: value.customEnv,
        customArgs: value.customArgs,
        maxConcurrentTasks: value.maxConcurrentTasks,
      };
      let saved: Agent;
      if (mode === 'edit' && agent) {
        saved = await api.patch<Agent>(`/agents/${agent.id}`, body);
      } else {
        saved = await api.post<Agent>('/agents', body);
      }
      toast.success(t('management.agents.form.saveSuccess'));
      onSaved(saved);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400 && /UNIQUE/i.test(err.message)) {
        setErrors({ name: t('management.agents.form.nameCollision') });
      } else {
        toast.error(t('management.agents.form.saveFailed'));
        setErrors({
          submit: err instanceof Error ? err.message : t('management.agents.form.saveFailed'),
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const instructionsLen = value.instructions.length;
  const showCounter = instructionsLen > 3500;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[640px] sm:max-w-[640px] p-0">
        <form onSubmit={handleSubmit} className="flex flex-col max-h-[85vh]">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">{title}</DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 px-6">
            <div className="space-y-4 pb-4">
              {/* Name */}
              <div className="space-y-2">
                <label className="text-sm font-semibold" htmlFor="agent-form-name">
                  {t('management.agents.form.name.label')}
                </label>
                <Input
                  ref={nameInputRef}
                  id="agent-form-name"
                  data-agent-form-field="name"
                  autoFocus
                  placeholder={t('management.agents.form.name.placeholder')}
                  value={value.name}
                  onChange={(e) => setValue((v) => ({ ...v, name: e.target.value }))}
                  aria-invalid={errors.name ? 'true' : 'false'}
                />
                {errors.name ? (
                  <p className="text-xs text-destructive" role="alert">
                    {errors.name}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('management.agents.form.name.hint')}
                  </p>
                )}
              </div>

              {/* Instructions */}
              <div className="space-y-2">
                <label className="text-sm font-semibold" htmlFor="agent-form-instructions">
                  {t('management.agents.form.instructions.label')}
                </label>
                <textarea
                  id="agent-form-instructions"
                  data-agent-form-field="instructions"
                  placeholder={t('management.agents.form.instructions.placeholder')}
                  value={value.instructions}
                  onChange={(e) => setValue((v) => ({ ...v, instructions: e.target.value }))}
                  className="min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm leading-relaxed shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                />
                <div className="flex justify-between">
                  <p className="text-xs text-muted-foreground">
                    {t('management.agents.form.instructions.hint')}
                  </p>
                  {showCounter ? (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {t('management.agents.form.instructions.counter', {
                        count: instructionsLen,
                        max: 4096,
                      })}
                    </p>
                  ) : null}
                </div>
              </div>

              {/* Runtime */}
              <div className="space-y-2">
                <label className="text-sm font-semibold" htmlFor="agent-form-runtime">
                  {t('management.agents.form.runtime.label')}
                </label>
                <Select
                  value={value.runtimeId ?? NO_RUNTIME_SENTINEL}
                  onValueChange={(v) =>
                    setValue((prev) => ({
                      ...prev,
                      runtimeId: v === NO_RUNTIME_SENTINEL ? null : v,
                    }))
                  }
                >
                  <SelectTrigger
                    id="agent-form-runtime"
                    data-agent-form-field="runtime"
                  >
                    <SelectValue placeholder={t('management.agents.form.runtime.placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_RUNTIME_SENTINEL}>
                      {t('management.agents.form.runtime.none')}
                    </SelectItem>
                    {runtimes.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} ({t(`management.runtimes.kind.${kindKey(r.kind)}`)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t('management.agents.form.runtime.hint')}
                </p>
              </div>

              <Separator className="my-4" />

              {/* Custom env */}
              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  {t('management.agents.form.customEnv.label')}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t('management.agents.form.customEnv.hint')}
                </p>
                <CustomEnvEditor
                  value={value.customEnv}
                  onChange={(next) => setValue((v) => ({ ...v, customEnv: next }))}
                />
              </div>

              <Separator className="my-4" />

              {/* Custom args */}
              <div className="space-y-2">
                <label className="text-sm font-semibold">
                  {t('management.agents.form.customArgs.label')}
                </label>
                <p className="text-xs text-muted-foreground">
                  {t('management.agents.form.customArgs.hint')}
                </p>
                <CustomArgsEditor
                  value={value.customArgs}
                  onChange={(next) => setValue((v) => ({ ...v, customArgs: next }))}
                />
              </div>

              <Separator className="my-4" />

              {/* Max concurrent */}
              <div className="space-y-2">
                <label className="text-sm font-semibold" htmlFor="agent-form-max-concurrent">
                  {t('management.agents.form.maxConcurrent.label')}
                </label>
                <Input
                  id="agent-form-max-concurrent"
                  data-agent-form-field="maxConcurrent"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={16}
                  step={1}
                  value={value.maxConcurrentTasks}
                  onChange={(e) => {
                    const parsed = Number.parseInt(e.target.value, 10);
                    setValue((v) => ({
                      ...v,
                      maxConcurrentTasks: Number.isFinite(parsed) ? parsed : 1,
                    }));
                  }}
                  className="max-w-[120px]"
                  aria-invalid={errors.maxConcurrent ? 'true' : 'false'}
                />
                {errors.maxConcurrent ? (
                  <p className="text-xs text-destructive" role="alert">
                    {errors.maxConcurrent}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {t('management.agents.form.maxConcurrent.hint')}
                  </p>
                )}
              </div>

              {errors.submit ? (
                <p className="text-xs text-destructive" role="alert">
                  {errors.submit}
                </p>
              ) : null}
            </div>
          </ScrollArea>

          <DialogFooter className="mt-6 pt-4 px-6 pb-6 border-t border-border gap-3">
            <Button
              type="button"
              variant="outline"
              data-agent-form-cancel
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('common.buttons.cancel')}
            </Button>
            <Button
              type="submit"
              data-agent-form-submit
              disabled={isSubmitting}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function kindKey(kind: Runtime['kind']): 'hostedInstance' | 'localDaemon' | 'externalCloudDaemon' {
  switch (kind) {
    case 'hosted_instance':
      return 'hostedInstance';
    case 'local_daemon':
      return 'localDaemon';
    case 'external_cloud_daemon':
      return 'externalCloudDaemon';
  }
}
