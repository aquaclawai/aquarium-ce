import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { RuntimeKind } from '@aquarium/shared';
import { Button } from '@/components/ui/button';

/**
 * Phase 25 Plan 25-02 — kind-filter chip group.
 *
 * MGMT-02 unified list filter: 4 chips (All / Hosted / Local daemon / Cloud
 * daemon) rendered as shadcn Buttons with `role="radiogroup"` semantics so
 * exactly one is active at a time. Each chip carries a live count and a
 * `data-kind-filter` data attribute so Playwright can click without
 * depending on translated text.
 *
 * Keyboard: ArrowLeft / ArrowRight cycle through chips. Tab steps into the
 * group and lands on the active chip; Tab out exits the group.
 */

export type KindFilterValue = RuntimeKind | 'all';

interface KindFilterChipsProps {
  counts: Record<KindFilterValue, number>;
  value: KindFilterValue;
  onChange: (next: KindFilterValue) => void;
}

interface ChipDef {
  value: KindFilterValue;
  i18nKey: string;
}

const CHIPS: ChipDef[] = [
  { value: 'all', i18nKey: 'management.runtimes.filter.all' },
  { value: 'hosted_instance', i18nKey: 'management.runtimes.filter.hostedInstance' },
  { value: 'local_daemon', i18nKey: 'management.runtimes.filter.localDaemon' },
  { value: 'external_cloud_daemon', i18nKey: 'management.runtimes.filter.externalCloudDaemon' },
];

export function KindFilterChips({ counts, value, onChange }: KindFilterChipsProps) {
  const { t } = useTranslation();
  const groupRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const idx = CHIPS.findIndex((c) => c.value === value);
    if (idx === -1) return;
    const delta = event.key === 'ArrowRight' ? 1 : -1;
    const nextIdx = (idx + delta + CHIPS.length) % CHIPS.length;
    const nextValue = CHIPS[nextIdx].value;
    onChange(nextValue);
    // Move focus to the new active chip on the next frame so the Radix/
    // shadcn Button re-renders before we query it.
    requestAnimationFrame(() => {
      const node = groupRef.current?.querySelector<HTMLButtonElement>(
        `[data-kind-filter="${nextValue}"]`,
      );
      node?.focus();
    });
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={t('management.runtimes.filter.all')}
      className="flex flex-wrap gap-2"
      onKeyDown={handleKeyDown}
    >
      {CHIPS.map((chip) => {
        const active = chip.value === value;
        return (
          <Button
            key={chip.value}
            type="button"
            variant={active ? 'default' : 'outline'}
            size="sm"
            role="radio"
            aria-checked={active}
            data-kind-filter={chip.value}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(chip.value)}
          >
            <span>{t(chip.i18nKey)}</span>
            <span className="ml-2 text-xs text-muted-foreground tabular-nums">
              {counts[chip.value] ?? 0}
            </span>
          </Button>
        );
      })}
    </div>
  );
}
