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
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { formatAbsoluteTime } from './time';

/**
 * Phase 25 Plan 25-02 Task 2 — Runtime detail drawer.
 *
 * MGMT-02 detail surface. shadcn Sheet (right-side drawer) showing the full
 * Runtime shape read-only — runtimes are server-managed (daemon registration
 * or InstanceManager), never created / edited from this page.
 *
 * deviceInfo + metadata rendered via `{JSON.stringify(obj, null, 2)}` inside
 * <pre> — React auto-escapes everything, no innerHTML (T-25-02-01 mitigation).
 */

interface RuntimeDetailSheetProps {
  runtime: Runtime | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const kindIcon: Record<RuntimeKind, LucideIcon> = {
  hosted_instance: Server,
  local_daemon: Monitor,
  external_cloud_daemon: Globe,
};

const kindI18nKey: Record<RuntimeKind, string> = {
  hosted_instance: 'management.runtimes.kind.hostedInstance',
  local_daemon: 'management.runtimes.kind.localDaemon',
  external_cloud_daemon: 'management.runtimes.kind.externalCloudDaemon',
};

const kindBadgeClass: Record<RuntimeKind, string> = {
  hosted_instance: 'bg-[var(--color-info-subtle-bg)] text-[var(--color-info-subtle-text)]',
  local_daemon: 'bg-secondary text-secondary-foreground',
  external_cloud_daemon: 'bg-muted text-muted-foreground',
};

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
  online:
    'bg-[var(--color-success-subtle-bg)] text-[var(--color-success-subtle-text)] border-transparent',
  offline:
    'bg-[var(--color-warning-subtle-bg)] text-[var(--color-warning-subtle-text)] border-transparent',
  error: '',
};

const statusI18nKey: Record<RuntimeStatus, string> = {
  online: 'management.runtimes.status.online',
  offline: 'management.runtimes.status.offline',
  error: 'management.runtimes.status.error',
};

export function RuntimeDetailSheet({
  runtime,
  open,
  onOpenChange,
}: RuntimeDetailSheetProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en';

  // Sheet primitive handles portal + focus trap + Escape close; we still need
  // to return early when there is no runtime so our formatters have data.
  const KindIcon = runtime ? kindIcon[runtime.kind] : null;
  const StatusIcon = runtime ? statusIcon[runtime.status] : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[560px] overflow-y-auto"
        data-runtime-detail-sheet
      >
        <SheetHeader>
          <SheetTitle>{runtime?.name ?? ''}</SheetTitle>
          <SheetDescription className="sr-only">
            {runtime
              ? t('management.runtimes.detail.title', { name: runtime.name })
              : ''}
          </SheetDescription>
        </SheetHeader>

        {runtime ? (
          <div className="mt-4 space-y-4">
            {/* Field grid */}
            <dl className="grid grid-cols-[140px_1fr] gap-y-2 gap-x-4 text-sm">
              <dt className="text-muted-foreground font-medium">
                {t('management.runtimes.detail.kind')}
              </dt>
              <dd>
                {KindIcon ? (
                  <Badge
                    variant="outline"
                    className={`${kindBadgeClass[runtime.kind]} border-transparent`}
                  >
                    <KindIcon className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                    <span>{t(kindI18nKey[runtime.kind])}</span>
                  </Badge>
                ) : null}
              </dd>

              <dt className="text-muted-foreground font-medium">
                {t('management.runtimes.detail.provider')}
              </dt>
              <dd>{runtime.provider}</dd>

              <dt className="text-muted-foreground font-medium">
                {t('management.runtimes.detail.status')}
              </dt>
              <dd>
                {StatusIcon ? (
                  <Badge
                    variant={statusVariant[runtime.status]}
                    className={statusExtraClass[runtime.status]}
                  >
                    <StatusIcon className="h-3 w-3 mr-1" aria-hidden="true" />
                    <span>{t(statusI18nKey[runtime.status])}</span>
                  </Badge>
                ) : null}
              </dd>

              <dt className="text-muted-foreground font-medium">
                {t('management.runtimes.detail.id')}
              </dt>
              <dd className="font-mono text-xs break-all">{runtime.id}</dd>

              <dt className="text-muted-foreground font-medium">
                {t('management.runtimes.detail.daemonId')}
              </dt>
              <dd className="font-mono text-xs break-all">
                {runtime.daemonId ?? '—'}
              </dd>

              <dt className="text-muted-foreground font-medium">
                {t('management.runtimes.detail.instanceId')}
              </dt>
              <dd className="font-mono text-xs break-all">
                {runtime.instanceId ?? '—'}
              </dd>

              <dt className="text-muted-foreground font-medium">
                {t('management.runtimes.detail.createdAt')}
              </dt>
              <dd className="text-xs">
                {formatAbsoluteTime(runtime.createdAt, locale)}
              </dd>

              <dt className="text-muted-foreground font-medium">
                {t('management.runtimes.detail.lastHeartbeatAt')}
              </dt>
              <dd className="text-xs">
                {runtime.lastHeartbeatAt
                  ? formatAbsoluteTime(runtime.lastHeartbeatAt, locale)
                  : t('management.runtimes.neverHeartbeat')}
              </dd>
            </dl>

            <Separator className="my-4" />

            <section>
              <h3 className="text-sm font-semibold mb-2">
                {t('management.runtimes.detail.deviceInfoHeader')}
              </h3>
              <pre className="text-xs font-mono bg-muted p-4 rounded whitespace-pre-wrap overflow-x-auto max-h-[240px] overflow-y-auto">
                {JSON.stringify(runtime.deviceInfo ?? {}, null, 2)}
              </pre>
            </section>

            <Separator className="my-4" />

            <section>
              <h3 className="text-sm font-semibold mb-2">
                {t('management.runtimes.detail.metadataHeader')}
              </h3>
              <pre className="text-xs font-mono bg-muted p-4 rounded whitespace-pre-wrap overflow-x-auto max-h-[240px] overflow-y-auto">
                {JSON.stringify(runtime.metadata ?? {}, null, 2)}
              </pre>
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
