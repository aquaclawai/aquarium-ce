import { useTranslation } from 'react-i18next';
import { SafeMarkdown } from './markdown';

interface IssueDescriptionProps {
  description: string | null;
}

export function IssueDescription({ description }: IssueDescriptionProps) {
  const { t } = useTranslation();
  const trimmed = description?.trim() ?? '';
  if (!trimmed) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="issue-description-empty">
        {t('issues.detail.noDescription')}
      </p>
    );
  }
  return (
    <SafeMarkdown className="prose prose-sm dark:prose-invert max-w-none">
      {trimmed}
    </SafeMarkdown>
  );
}
