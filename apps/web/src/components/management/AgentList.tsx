import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Globe, Monitor, MoreHorizontal, Server } from 'lucide-react';
import type { Agent, AgentStatus, Runtime, RuntimeKind } from '@aquarium/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EmptyState } from './EmptyState';
import { formatAbsoluteTime, formatRelativeTime } from './time';

/**
 * Phase 25 Plan 25-01 — Agents table.
 *
 * shadcn Table rendering of agents for Active + Archived tabs. Columns:
 * Name / Runtime / **Status** / MaxConcurrent / Updated / Actions.
 *
 * The Status column (ROADMAP SC-1 — Blocker-3 fix) renders `agent.status` as
 * a shadcn Badge with a fixed variant-per-enum mapping. Every row carries
 * `data-agent-status-badge={status}` so Playwright can assert the live
 * projection without relying on i18n-translated labels.
 */

interface AgentListProps {
  agents: Agent[];
  runtimes: Runtime[];
  isLoading: boolean;
  onEdit: (a: Agent) => void;
  onArchive: (a: Agent) => void;
  onRestore: (a: Agent) => void;
  onClearSearch?: () => void;
  onCreate?: () => void;
  archivedView: boolean;
  searchQuery: string;
}

/** 5-enum variant map — SC-1 source of truth. */
const statusVariant: Record<AgentStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  idle: 'secondary', // neutral grey — no active work
  working: 'default', // brand-primary — active work
  blocked: 'outline', // subtle — needs attention but not destructive
  error: 'destructive', // red — surfaces the problem
  offline: 'outline', // muted — no activity
};

/** Icon per runtime kind — mirrors UI-SPEC Color section. */
const kindIcon: Record<RuntimeKind, typeof Server> = {
  hosted_instance: Server,
  local_daemon: Monitor,
  external_cloud_daemon: Globe,
};

export function AgentList({
  agents,
  runtimes,
  isLoading,
  onEdit,
  onArchive,
  onRestore,
  onClearSearch,
  onCreate,
  archivedView,
  searchQuery,
}: AgentListProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  const runtimeById = useMemo(() => {
    const map = new Map<string, Runtime>();
    for (const r of runtimes) map.set(r.id, r);
    return map;
  }, [runtimes]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => a.name.toLowerCase().includes(q));
  }, [agents, searchQuery]);

  // Loading skeleton — 5 skeleton rows.
  if (isLoading) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('management.agents.columns.name')}</TableHead>
            <TableHead>{t('management.agents.columns.runtime')}</TableHead>
            <TableHead data-column="status">{t('management.agents.columns.status')}</TableHead>
            <TableHead>{t('management.agents.columns.maxConcurrent')}</TableHead>
            <TableHead>{t('management.agents.columns.updated')}</TableHead>
            <TableHead className="sr-only">{t('management.agents.columns.actions')}</TableHead>
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

  // Archived-tab empty (separate from active empty per UI-SPEC).
  if (archivedView && agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        heading={t('management.agents.archivedEmpty')}
        body=""
        dataMarker="agents-archived"
      />
    );
  }

  // Active-tab empty (zero agents at all).
  if (!archivedView && agents.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        heading={t('management.agents.empty.heading')}
        body={t('management.agents.empty.body')}
        cta={onCreate ? { label: t('management.agents.empty.cta'), onClick: onCreate } : undefined}
        dataMarker="agents"
      />
    );
  }

  // Has agents but search filtered them all out.
  if (filtered.length === 0) {
    return (
      <EmptyState
        icon={Bot}
        heading={t('management.agents.noMatches.heading')}
        body={t('management.agents.noMatches.body')}
        cta={onClearSearch ? { label: t('management.agents.noMatches.clear'), onClick: onClearSearch } : undefined}
        dataMarker="agents-no-matches"
      />
    );
  }

  return (
    <TooltipProvider delayDuration={250}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('management.agents.columns.name')}</TableHead>
            <TableHead>{t('management.agents.columns.runtime')}</TableHead>
            <TableHead data-column="status">{t('management.agents.columns.status')}</TableHead>
            <TableHead>{t('management.agents.columns.maxConcurrent')}</TableHead>
            <TableHead>{t('management.agents.columns.updated')}</TableHead>
            <TableHead className="w-[60px]">
              <span className="sr-only">{t('management.agents.columns.actions')}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((agent) => (
            <AgentRow
              key={agent.id}
              agent={agent}
              runtime={agent.runtimeId ? runtimeById.get(agent.runtimeId) ?? null : null}
              archivedView={archivedView}
              locale={locale}
              onEdit={onEdit}
              onArchive={onArchive}
              onRestore={onRestore}
            />
          ))}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}

interface AgentRowProps {
  agent: Agent;
  runtime: Runtime | null;
  archivedView: boolean;
  locale: string;
  onEdit: (a: Agent) => void;
  onArchive: (a: Agent) => void;
  onRestore: (a: Agent) => void;
}

/**
 * Memoized on `(agent.id, agent.updatedAt, agent.status)` — status changes
 * MUST force a re-render so the Status badge stays in sync with the server.
 */
const AgentRow = memo(
  function AgentRow({
    agent,
    runtime,
    archivedView,
    locale,
    onEdit,
    onArchive,
    onRestore,
  }: AgentRowProps) {
    const { t } = useTranslation();
    const RuntimeIcon = runtime ? kindIcon[runtime.kind] : null;

    const neverLabel = t('management.agents.noRuntime'); // not used for time; keeps pattern
    const relative = formatRelativeTime({
      ts: agent.updatedAt,
      locale,
      neverLabel: t('management.runtimes.neverHeartbeat'),
      justNowLabel: t('management.runtimes.heartbeatJustNow'),
    });
    const absolute = formatAbsoluteTime(agent.updatedAt, locale);
    void neverLabel;

    const rowClass = [
      'hover:bg-[var(--color-primary)]/5',
      'even:bg-muted/30',
      'border-b border-border',
      archivedView ? 'opacity-70 text-muted-foreground' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <TableRow data-agent-row={agent.id} className={rowClass}>
        {/* Name + (optional) Archived badge */}
        <TableCell>
          <button
            type="button"
            className="font-medium text-left hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
            onClick={() => onEdit(agent)}
          >
            {agent.name}
          </button>
          {archivedView ? (
            <Badge variant="outline" className="ml-2 text-[10px]">
              {t('management.agents.archived')}
            </Badge>
          ) : null}
        </TableCell>

        {/* Runtime */}
        <TableCell>
          {runtime && RuntimeIcon ? (
            <span className="inline-flex items-center gap-1.5 text-sm">
              <RuntimeIcon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="truncate max-w-[180px]">{runtime.name}</span>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground italic">
              {t('management.agents.noRuntime')}
            </span>
          )}
        </TableCell>

        {/* Status (SC-1 — Blocker-3 fix) */}
        <TableCell>
          <Badge
            variant={statusVariant[agent.status]}
            data-agent-status-badge={agent.status}
          >
            {t(`management.agents.status.${agent.status}`)}
          </Badge>
        </TableCell>

        {/* Max concurrent */}
        <TableCell className="font-mono text-xs tabular-nums">
          {agent.maxConcurrentTasks}
        </TableCell>

        {/* Updated (relative + absolute tooltip) */}
        <TableCell>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground cursor-help">{relative}</span>
            </TooltipTrigger>
            <TooltipContent>{absolute}</TooltipContent>
          </Tooltip>
        </TableCell>

        {/* Row actions */}
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('management.agents.columns.actions')}
                data-agent-actions-trigger={agent.id}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-agent-action="edit"
                onSelect={() => onEdit(agent)}
              >
                {t('management.agents.actions.edit')}
              </DropdownMenuItem>
              {archivedView ? (
                <DropdownMenuItem
                  data-agent-action="restore"
                  onSelect={() => onRestore(agent)}
                >
                  {t('management.agents.actions.restore')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  data-agent-action="archive"
                  className="text-destructive focus:text-destructive"
                  onSelect={() => onArchive(agent)}
                >
                  {t('management.agents.actions.archive')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  },
  (prev, next) =>
    prev.agent.id === next.agent.id &&
    prev.agent.updatedAt === next.agent.updatedAt &&
    prev.agent.status === next.agent.status &&
    prev.archivedView === next.archivedView &&
    prev.runtime?.id === next.runtime?.id &&
    prev.runtime?.name === next.runtime?.name &&
    prev.runtime?.kind === next.runtime?.kind &&
    prev.locale === next.locale,
);
