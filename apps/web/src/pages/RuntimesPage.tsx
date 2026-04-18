import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import type { Runtime } from '@aquarium/shared';
import { Input } from '@/components/ui/input';
import { RuntimeList } from '@/components/management/RuntimeList';
import {
  KindFilterChips,
  type KindFilterValue,
} from '@/components/management/KindFilterChips';
import { RuntimeDetailSheet } from '@/components/management/RuntimeDetailSheet';
import { useRuntimes } from '@/components/management/useRuntimes';

/**
 * Phase 25 Plan 25-02 — Runtimes page.
 *
 * MGMT-02 surface. Fetches the unified runtime list from `GET /api/runtimes`
 * via `useRuntimes` (one endpoint, all three kinds — HARD invariant) and
 * applies a client-side kind-filter chip group + name search. Deep-link via
 * `?kind=` preserves filter state across reload / share.
 *
 * Task 2 replaces the `_setDetailRuntime` stub with an actual Sheet render.
 */

const VALID_KINDS: readonly KindFilterValue[] = [
  'all',
  'hosted_instance',
  'local_daemon',
  'external_cloud_daemon',
];

function coerceKind(raw: string | null): KindFilterValue {
  if (raw && (VALID_KINDS as readonly string[]).includes(raw)) {
    return raw as KindFilterValue;
  }
  return 'all';
}

export function RuntimesPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { runtimes, isLoading, error } = useRuntimes();

  const [activeFilter, setActiveFilter] = useState<KindFilterValue>(() =>
    coerceKind(searchParams.get('kind')),
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [detailRuntime, setDetailRuntime] = useState<Runtime | null>(null);

  const counts = useMemo<Record<KindFilterValue, number>>(() => {
    const base: Record<KindFilterValue, number> = {
      all: runtimes.length,
      hosted_instance: 0,
      local_daemon: 0,
      external_cloud_daemon: 0,
    };
    for (const r of runtimes) {
      base[r.kind] += 1;
    }
    return base;
  }, [runtimes]);

  const handleFilterChange = (next: KindFilterValue) => {
    setActiveFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === 'all') {
      params.delete('kind');
    } else {
      params.set('kind', next);
    }
    setSearchParams(params, { replace: true });
  };

  const handleRowClick = (runtime: Runtime) => {
    setDetailRuntime(runtime);
  };

  const handleClearFilter = () => {
    handleFilterChange('all');
    setSearchQuery('');
  };

  return (
    <main data-page="runtimes" className="mx-auto max-w-[1200px] p-6 pb-8">
      <header className="mb-4">
        <h1 className="text-2xl font-medium">{t('management.runtimes.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('management.runtimes.description')}
        </p>
      </header>

      <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:gap-4">
        <Input
          type="search"
          placeholder={t('management.runtimes.filter.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-[320px]"
          aria-label={t('management.runtimes.filter.search')}
        />
        <div className="flex-1" />
        <KindFilterChips
          counts={counts}
          value={activeFilter}
          onChange={handleFilterChange}
        />
      </div>

      {error ? (
        <div
          role="alert"
          className="mb-4 rounded border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {t('management.runtimes.loadFailed', { retry: '' })}
        </div>
      ) : null}

      <RuntimeList
        runtimes={runtimes}
        isLoading={isLoading}
        activeKindFilter={activeFilter}
        searchQuery={searchQuery}
        onRowClick={handleRowClick}
        onClearFilter={handleClearFilter}
      />

      <RuntimeDetailSheet
        runtime={detailRuntime}
        open={detailRuntime !== null}
        onOpenChange={(open) => {
          if (!open) setDetailRuntime(null);
        }}
      />
    </main>
  );
}
