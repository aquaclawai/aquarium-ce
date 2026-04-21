import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle2,
  Clock,
  Globe,
  Monitor,
  Server,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { Runtime, RuntimeKind, RuntimeStatus } from '@aquarium/shared';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EmptyState } from './EmptyState';
import { formatAbsoluteTime, formatRelativeTime } from './time';
import type { KindFilterValue } from './KindFilterChips';

/**
 * Phase 25 Plan 25-02 — Runtimes table.
 *
 * shadcn Table rendering the unified runtimes list (MGMT-02 HARD invariant:
 * ONE table, chip-filtered; no per-kind route split). Columns:
 * Name / Kind / Provider / Status / Device / Heartbeat / Actions (sr-only).
 *
 * The Device column hovers reveal the full deviceInfo JSON as a Tooltip
 * with a <pre> child — React auto-escapes the JSON, no innerHTML.
 * Heartbeat cells carry an absolute-time tooltip for precision.
 *
 * Row click opens the RuntimeDetailSheet (wired by Task 2 via onRowClick).
 */

interface RuntimeListProps {
  runtimes: Runtime[];
  isLoading: boolean;
  activeKindFilter: KindFilterValue;
  searchQuery: string;
  onRowClick: (r: Runtime) => void;
  onClearFilter?: () => void;
}

/** lucide icon per runtime kind — mirrors UI-SPEC §Color. */
const kindIcon: Record<RuntimeKind, LucideIcon> = {
  hosted_instance: Server,
  local_daemon: Monitor,
  external_cloud_daemon: Globe,
};

/** i18n label key per kind. */
const kindI18nKey: Record<RuntimeKind, string> = {
  hosted_instance: 'management.runtimes.kind.hostedInstance',
  local_daemon: 'management.runtimes.kind.localDaemon',
  external_cloud_daemon: 'management.runtimes.kind.externalCloudDaemon',
};

/** Tailwind classes for each kind badge — taken verbatim from UI-SPEC. */
const kindBadgeClass: Record<RuntimeKind, string> = {
  hosted_instance: 'bg-[var(--color-info-subtle-bg)] text-[var(--color-info-subtle-text)]',
  local_daemon: 'bg-secondary text-secondary-foreground',
  external_cloud_daemon: 'bg-muted text-muted-foreground',
};

/** Status → shadcn Badge variant + icon + extra classes. */
const statusIcon: Record<RuntimeStatus, LucideIcon> = {
  online: CheckCircle2,
  offline: Clock,
  error: XCircle,
};

const statusVariant: Record<RuntimeStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  online: 'outline',
  offline: 'outline',
  error: 'destructive',
};

const statusExtraClass: Record<RuntimeStatus, string> = {
  online: 'bg-[var(--color-success-subtle-bg)] text-[var(--color-success-subtle-text)] border-transparent',
  offline: 'bg-[var(--color-warning-subtle-bg)] text-[var(--color-warning-subtle-text)] border-transparent',
  error: '',
};

const statusI18nKey: Record<RuntimeStatus, string> = {
  online: 'management.runtimes.status.online',
  offline: 'management.runtimes.status.offline',
  error: 'management.runtimes.status.error',
};

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}…`;
}

function deviceSummary(runtime: Runtime): string | null {
  const info = runtime.deviceInfo;
  if (!info) return null;
  const parts: string[] = [];
  if (info.os) parts.push(info.os);
  if (info.arch) parts.push(info.arch);
  if (parts.length === 0 && info.hostname) parts.push(info.hostname);
  if (parts.length === 0 && info.version) parts.push(info.version);
  return parts.length > 0 ? truncate(parts.join('/'), 28) : null;
}

export function RuntimeList({
  runtimes,
  isLoading,
  activeKindFilter,
  searchQuery,
  onRowClick,
  onClearFilter,
}: RuntimeListProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return runtimes.filter((r) => {
      if (activeKindFilter !== 'all' && r.kind !== activeKindFilter) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [runtimes, activeKindFilter, searchQuery]);

  // Loading — 5 skeleton rows.
  if (isLoading) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('management.runtimes.columns.name')}</TableHead>
            <TableHead>{t('management.runtimes.columns.kind')}</TableHead>
            <TableHead>{t('management.runtimes.columns.provider')}</TableHead>
            <TableHead>{t('management.runtimes.columns.status')}</TableHead>
            <TableHead>{t('management.runtimes.columns.device')}</TableHead>
            <TableHead>{t('management.runtimes.columns.lastHeartbeat')}</TableHead>
            <TableHead className="sr-only">
              {t('management.runtimes.columns.actions')}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, i) => (
            <TableRow key={`skeleton-${i}`}>
              {Array.from({ length: 6 }).map((__, j) => (
                <TableCell key={`skeleton-cell-${j}`}>
                  <Skeleton className="h-4 w-full max-w-[120px]" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  // Empty — no runtimes at all.
  if (runtimes.length === 0) {
    return (
      <EmptyState
        icon={Server}
        heading={t('management.runtimes.empty.heading')}
        body={t('management.runtimes.empty.body')}
        dataMarker="runtimes"
      />
    );
  }

  // Filtered out — chip or search hid everything.
  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={Server}
        heading={t('management.runtimes.noMatches.heading')}
        body=""
        cta={
          onClearFilter
            ? { label: t('management.runtimes.noMatches.clear'), onClick: onClearFilter }
            : undefined
        }
        dataMarker="runtimes-no-matches"
      />
    );
  }

  return (
    <TooltipProvider delayDuration={250}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('management.runtimes.columns.name')}</TableHead>
            <TableHead>{t('management.runtimes.columns.kind')}</TableHead>
            <TableHead>{t('management.runtimes.columns.provider')}</TableHead>
            <TableHead data-column="status">
              {t('management.runtimes.columns.status')}
            </TableHead>
            <TableHead>{t('management.runtimes.columns.device')}</TableHead>
            <TableHead>{t('management.runtimes.columns.lastHeartbeat')}</TableHead>
            <TableHead className="w-[60px]">
              <span className="sr-only">
                {t('management.runtimes.columns.actions')}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((runtime) => (
            <RuntimeRow
              key={runtime.id}
              runtime={runtime}
              locale={locale}
              onClick={() => onRowClick(runtime)}
            />
          ))}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}

interface RuntimeRowProps {
  runtime: Runtime;
  locale: string;
  onClick: () => void;
}

/**
 * Memoized on (id, status, lastHeartbeatAt, updatedAt, name) — these are
 * the fields that actually change during 30s polling.
 */
const RuntimeRow = memo(
  function RuntimeRow({ runtime, locale, onClick }: RuntimeRowProps) {
    const { t } = useTranslation();
    const KindIcon = kindIcon[runtime.kind];
    const StatusIcon = statusIcon[runtime.status];
    const summary = deviceSummary(runtime);

    const relativeHeartbeat = formatRelativeTime({
      ts: runtime.lastHeartbeatAt,
      locale,
      neverLabel: t('management.runtimes.neverHeartbeat'),
      justNowLabel: t('management.runtimes.heartbeatJustNow'),
    });
    const absoluteHeartbeat = formatAbsoluteTime(runtime.lastHeartbeatAt, locale);

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onClick();
      }
    };

    return (
      <TableRow
        data-runtime-row={runtime.id}
        data-runtime-kind={runtime.kind}
        tabIndex={0}
        role="button"
        aria-label={runtime.name}
        className="cursor-pointer hover:bg-[var(--color-primary)]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onClick}
        onKeyDown={handleKeyDown}
      >
        {/* Name */}
        <TableCell className="font-medium">{runtime.name}</TableCell>

        {/* Kind */}
        <TableCell>
          <Badge variant="outline" className={`${kindBadgeClass[runtime.kind]} border-transparent`}>
            <KindIcon className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
            <span>{t(kindI18nKey[runtime.kind])}</span>
          </Badge>
        </TableCell>

        {/* Provider */}
        <TableCell className="text-sm">{runtime.provider}</TableCell>

        {/* Status */}
        <TableCell>
          <Badge
            variant={statusVariant[runtime.status]}
            className={statusExtraClass[runtime.status]}
            data-runtime-status-badge={runtime.status}
          >
            <StatusIcon className="h-3 w-3 mr-1" aria-hidden="true" />
            <span>{t(statusI18nKey[runtime.status])}</span>
          </Badge>
        </TableCell>

        {/* Device (deviceInfo tooltip) */}
        <TableCell className="text-sm">
          {runtime.deviceInfo ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  data-runtime-device-tooltip
                  className="text-xs font-mono text-muted-foreground cursor-help"
                >
                  {summary ?? t('management.runtimes.noDeviceInfo')}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[420px]">
                <pre className="text-xs font-mono whitespace-pre-wrap">
                  {JSON.stringify(runtime.deviceInfo, null, 2)}
                </pre>
              </TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t('management.runtimes.noDeviceInfo')}
            </span>
          )}
        </TableCell>

        {/* Last heartbeat (tooltip with absolute time) */}
        <TableCell>
          {runtime.lastHeartbeatAt ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground cursor-help">
                  {relativeHeartbeat}
                </span>
              </TooltipTrigger>
              <TooltipContent>{absoluteHeartbeat}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-xs text-muted-foreground italic">
              {t('management.runtimes.neverHeartbeat')}
            </span>
          )}
        </TableCell>

        {/* Actions (sr-only column — empty for MGMT-02 read-only page) */}
        <TableCell className="text-right">
          <span className="sr-only">
            {t('management.runtimes.columns.actions')}
          </span>
        </TableCell>
      </TableRow>
    );
  },
  (prev, next) =>
    prev.runtime.id === next.runtime.id &&
    prev.runtime.status === next.runtime.status &&
    prev.runtime.lastHeartbeatAt === next.runtime.lastHeartbeatAt &&
    prev.runtime.updatedAt === next.runtime.updatedAt &&
    prev.runtime.name === next.runtime.name &&
    prev.runtime.provider === next.runtime.provider &&
    prev.runtime.kind === next.runtime.kind &&
    prev.locale === next.locale,
);
