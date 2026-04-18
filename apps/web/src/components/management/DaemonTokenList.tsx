import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  KeyRound,
  MoreHorizontal,
  ShieldOff,
} from 'lucide-react';
import type { DaemonToken } from '@aquarium/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { EmptyState } from './EmptyState';
import { formatAbsoluteTime, formatRelativeTime } from './time';
import { deriveTokenStatus, type DaemonTokenDerivedStatus } from './tokenStatus';

/**
 * Phase 25 Plan 25-03 — Daemon tokens table.
 *
 * Columns: Name / Created / Expires / LastUsed / Status / Actions.
 * Each row carries `data-token-row={id}` + `data-token-status={derived}` so
 * Playwright + the MGMT-03 copy-once scenario can assert status transitions
 * without depending on locale-translated labels.
 *
 * Security note: the plaintext `adt_*` token never reaches this component.
 * The list endpoint's `DaemonToken` projection has no `plaintext` field
 * (type-enforced in packages/shared/src/v14-types.ts).
 */

interface DaemonTokenListProps {
  tokens: DaemonToken[];
  isLoading: boolean;
  onRevoke: (t: DaemonToken) => void;
  onOpenCreate?: () => void;
}

interface StatusPresentation {
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  className: string;
  icon: typeof CheckCircle2;
  labelKey: string;
}

const STATUS_PRESENTATION: Record<DaemonTokenDerivedStatus, StatusPresentation> = {
  active: {
    variant: 'outline',
    className:
      'bg-[var(--color-success-subtle-bg)] text-[var(--color-success-subtle-text)] border-transparent',
    icon: CheckCircle2,
    labelKey: 'management.daemonTokens.status.active',
  },
  expiring_soon: {
    variant: 'outline',
    className:
      'bg-[var(--color-warning-subtle-bg)] text-[var(--color-warning-subtle-text)] border-transparent',
    icon: Clock,
    labelKey: 'management.daemonTokens.status.expiringSoon',
  },
  expired: {
    variant: 'destructive',
    className: '',
    icon: AlertTriangle,
    labelKey: 'management.daemonTokens.status.expired',
  },
  revoked: {
    variant: 'outline',
    className: 'text-muted-foreground opacity-70',
    icon: ShieldOff,
    labelKey: 'management.daemonTokens.status.revoked',
  },
};

export function DaemonTokenList({
  tokens,
  isLoading,
  onRevoke,
  onOpenCreate,
}: DaemonTokenListProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  // Compute "now" once per render so every row uses the same epoch for
  // derive checks. If the list mutates (refetch), a fresh render re-evaluates.
  const now = useMemo(() => new Date(), [tokens]);

  // Loading skeleton — 5 rows.
  if (isLoading) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('management.daemonTokens.columns.name')}</TableHead>
            <TableHead>{t('management.daemonTokens.columns.created')}</TableHead>
            <TableHead>{t('management.daemonTokens.columns.expires')}</TableHead>
            <TableHead>{t('management.daemonTokens.columns.lastUsed')}</TableHead>
            <TableHead data-column="status">
              {t('management.daemonTokens.columns.status')}
            </TableHead>
            <TableHead className="w-[60px]">
              <span className="sr-only">
                {t('management.daemonTokens.columns.actions')}
              </span>
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

  if (tokens.length === 0) {
    return (
      <EmptyState
        icon={KeyRound}
        heading={t('management.daemonTokens.empty.heading')}
        body={t('management.daemonTokens.empty.body')}
        cta={
          onOpenCreate
            ? {
                label: t('management.daemonTokens.empty.cta'),
                onClick: onOpenCreate,
              }
            : undefined
        }
        dataMarker="daemon-tokens"
      />
    );
  }

  return (
    <TooltipProvider delayDuration={250}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('management.daemonTokens.columns.name')}</TableHead>
            <TableHead>{t('management.daemonTokens.columns.created')}</TableHead>
            <TableHead>{t('management.daemonTokens.columns.expires')}</TableHead>
            <TableHead>{t('management.daemonTokens.columns.lastUsed')}</TableHead>
            <TableHead data-column="status">
              {t('management.daemonTokens.columns.status')}
            </TableHead>
            <TableHead className="w-[60px]">
              <span className="sr-only">
                {t('management.daemonTokens.columns.actions')}
              </span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tokens.map((token) => (
            <DaemonTokenRow
              key={token.id}
              token={token}
              locale={locale}
              now={now}
              onRevoke={onRevoke}
            />
          ))}
        </TableBody>
      </Table>
    </TooltipProvider>
  );
}

interface DaemonTokenRowProps {
  token: DaemonToken;
  locale: string;
  now: Date;
  onRevoke: (t: DaemonToken) => void;
}

const DaemonTokenRow = memo(
  function DaemonTokenRow({ token, locale, now, onRevoke }: DaemonTokenRowProps) {
    const { t } = useTranslation();
    const derived = deriveTokenStatus(token, now);
    const presentation = STATUS_PRESENTATION[derived];
    const StatusIcon = presentation.icon;

    const neverExpires = t('management.daemonTokens.neverExpires');
    const neverUsed = t('management.daemonTokens.neverUsed');
    const justNow = t('management.runtimes.heartbeatJustNow');

    const createdRel = formatRelativeTime({
      ts: token.createdAt,
      locale,
      neverLabel: neverExpires,
      justNowLabel: justNow,
    });
    const createdAbs = formatAbsoluteTime(token.createdAt, locale);

    const expiresAbs = token.expiresAt
      ? formatAbsoluteTime(token.expiresAt, locale)
      : null;

    const lastUsedRel = formatRelativeTime({
      ts: token.lastUsedAt,
      locale,
      neverLabel: neverUsed,
      justNowLabel: justNow,
    });
    const lastUsedAbs = token.lastUsedAt
      ? formatAbsoluteTime(token.lastUsedAt, locale)
      : null;

    const rowClass = derived === 'revoked' ? 'opacity-70 text-muted-foreground' : '';

    return (
      <TableRow
        data-token-row={token.id}
        data-token-status={derived}
        className={rowClass}
      >
        {/* Name */}
        <TableCell>
          <span className="font-medium">{token.name}</span>
        </TableCell>

        {/* Created — relative with absolute tooltip */}
        <TableCell>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-xs text-muted-foreground cursor-help">
                {createdRel}
              </span>
            </TooltipTrigger>
            <TooltipContent>{createdAbs}</TooltipContent>
          </Tooltip>
        </TableCell>

        {/* Expires — absolute date or 'Never' */}
        <TableCell>
          {expiresAbs ? (
            <span className="text-xs">{expiresAbs}</span>
          ) : (
            <span className="text-xs text-muted-foreground italic">
              {neverExpires}
            </span>
          )}
        </TableCell>

        {/* Last used — relative with absolute tooltip, or 'Never' */}
        <TableCell>
          {lastUsedAbs ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-xs text-muted-foreground cursor-help">
                  {lastUsedRel}
                </span>
              </TooltipTrigger>
              <TooltipContent>{lastUsedAbs}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-xs text-muted-foreground italic">
              {neverUsed}
            </span>
          )}
        </TableCell>

        {/* Status (derived) */}
        <TableCell>
          <Badge
            variant={presentation.variant}
            className={presentation.className}
            data-token-status-badge={derived}
          >
            <StatusIcon className="h-3 w-3 mr-1" aria-hidden="true" />
            {t(presentation.labelKey)}
          </Badge>
        </TableCell>

        {/* Actions */}
        <TableCell className="text-right">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('management.daemonTokens.columns.actions')}
                data-token-actions-trigger={token.id}
              >
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-token-revoke-open={token.id}
                disabled={derived === 'revoked'}
                className="text-destructive focus:text-destructive"
                onSelect={() => onRevoke(token)}
              >
                {t('management.daemonTokens.actions.revoke')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  },
  (prev, next) =>
    prev.token.id === next.token.id &&
    prev.token.updatedAt === next.token.updatedAt &&
    prev.token.revokedAt === next.token.revokedAt &&
    prev.token.expiresAt === next.token.expiresAt &&
    prev.token.lastUsedAt === next.token.lastUsedAt &&
    prev.token.name === next.token.name &&
    prev.locale === next.locale &&
    prev.now.getTime() === next.now.getTime(),
);
