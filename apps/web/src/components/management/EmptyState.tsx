import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/**
 * Phase 25 management UI — shared card-styled empty state.
 *
 * Used across the three management pages for both "no items yet" and "no
 * search matches" scenarios. Consumers forward a `dataMarker` string so
 * Playwright can target the empty state without relying on visible text
 * (labels change across 6 locales).
 */

interface EmptyStateCta {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  icon: LucideIcon;
  heading: string;
  body: string;
  cta?: EmptyStateCta;
  /** Applied as `data-empty-${dataMarker}` on the outer Card for Playwright. */
  dataMarker?: string;
}

export function EmptyState({ icon: Icon, heading, body, cta, dataMarker }: EmptyStateProps) {
  const markerProps = dataMarker ? { [`data-empty-${dataMarker}`]: '' } : {};
  return (
    <Card
      className="flex flex-col items-center justify-center p-8 text-center"
      {...markerProps}
    >
      <Icon className="h-12 w-12 text-muted-foreground mb-4" aria-hidden="true" />
      <h2 className="text-xl font-semibold mb-2">{heading}</h2>
      <p className="text-sm text-muted-foreground mb-4 max-w-[480px]">{body}</p>
      {cta ? (
        <Button onClick={cta.onClick}>
          {cta.label}
        </Button>
      ) : null}
    </Card>
  );
}
