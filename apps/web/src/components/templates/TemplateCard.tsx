import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import type { TemplateManifest, TemplateSecurityConfig } from '@aquarium/shared';
import '../../pages/TemplatesPage.css';

export interface TemplateCardProps {
  template: TemplateManifest;
  onInstantiate: (template: TemplateManifest) => void;
  securityConfig?: TemplateSecurityConfig;
}

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  'customer-service': 'templates.categories.customerService',
  'sales': 'templates.categories.sales',
  'marketing': 'templates.categories.marketing',
  'devops': 'templates.categories.devops',
  'education': 'templates.categories.education',
  'personal': 'templates.categories.personal',
  'custom': 'templates.categories.custom',
  'general': 'templates.categories.general',
  'coding': 'templates.categories.coding',
  'data-analysis': 'templates.categories.dataAnalysis',
  'content-creation': 'templates.categories.contentCreation',
};

const TEMPLATE_EMOJIS: Record<string, string> = {
  'customer-service': '💬',
  'sales': '📈',
  'marketing': '📣',
  'devops': '⚙️',
  'education': '📚',
  'personal': '👤',
  'general': '🤖',
  'coding': '💻',
  'data-analysis': '📊',
  'content-creation': '✍️',
  'custom': '🔧',
  'travel': '✈️',
};

function getTemplateEmoji(template: TemplateManifest): string {
  return TEMPLATE_EMOJIS[template.category] ?? '🤖';
}

function formatUsageCount(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function getSecurityScoreColor(score: number): string {
  if (score === 0) return 'var(--color-text-secondary)';
  if (score >= 70) return 'var(--color-success)';
  if (score >= 40) return 'var(--color-warning)';
  return 'var(--color-error)';
}

function formatSecurityScore(score: number): string {
  return score === 0 ? '—' : String(score);
}

export function TemplateCard({ template, onInstantiate }: TemplateCardProps) {
  const { t } = useTranslation();

  if (template.featured) {
    return (
      <div className="featured-card">
        <div className="featured-card__emoji">{getTemplateEmoji(template)}</div>
        <span className="featured-card__badge">{t('skillMarket.featuredBadge')}</span>
        <h3 className="featured-card__name">{template.name}</h3>
        <p className="featured-card__desc">{template.description}</p>
        <div className="featured-card__meta">
          <span className="featured-card__rating">★ {template.rating.toFixed(1)}</span>
          <span className="featured-card__usage">{formatUsageCount(template.usageCount)} {t('skillMarket.usageCount', { count: template.usageCount })}</span>
          <span className="security-score-badge" style={{ color: getSecurityScoreColor(template.securityScore) }}>
            🛡 {formatSecurityScore(template.securityScore)}
          </span>
        </div>
        <Button className="featured-card__cta" onClick={() => onInstantiate(template)}>
          {t('templates.useTemplate')}
        </Button>
      </div>
    );
  }

  return (
    <div className="assistant-card">
      <div className="assistant-card__header">
        <span className="assistant-card__emoji">{getTemplateEmoji(template)}</span>
        <div className="assistant-card__title-row">
          <h3 className="assistant-card__name">{template.name}</h3>
          <span className="assistant-card__category-badge">
            {t(CATEGORY_LABEL_KEYS[template.category] ?? 'templates.categories.custom')}
          </span>
        </div>
        <span className="security-score-badge" style={{ color: getSecurityScoreColor(template.securityScore) }}>
          🛡 {formatSecurityScore(template.securityScore)}
        </span>
        <span className="assistant-card__rating">★ {template.rating.toFixed(1)}</span>
      </div>
      <p className="assistant-card__desc">{template.description}</p>
      {template.tags.length > 0 && (
        <div className="assistant-card__tags">
          {template.tags.slice(0, 3).map(tag => (
            <span key={tag} className="assistant-card__tag">{tag}</span>
          ))}
        </div>
      )}
      <Button className="assistant-card__cta" onClick={() => onInstantiate(template)}>
        {t('templates.useTemplate')}
      </Button>
    </div>
  );
}
