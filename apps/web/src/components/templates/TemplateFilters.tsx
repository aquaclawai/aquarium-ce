import { useTranslation } from 'react-i18next';
import { Button, Input } from '@/components/ui';
import type { TemplateCategory } from '@aquarium/shared';
import '../../pages/TemplatesPage.css';

export interface TemplateFiltersProps {
  search: string;
  onSearchChange: (v: string) => void;
  onSearch: () => void;
  category: TemplateCategory | '';
  onCategoryChange: (v: TemplateCategory | '') => void;
}

const CATEGORY_FILTERS: { key: string; value: TemplateCategory | '' }[] = [
  { key: 'templates.categories.all', value: '' },
  { key: 'templates.categories.customerService', value: 'customer-service' },
  { key: 'templates.categories.general', value: 'general' },
  { key: 'templates.categories.coding', value: 'coding' },
  { key: 'templates.categories.dataAnalysis', value: 'data-analysis' },
  { key: 'templates.categories.contentCreation', value: 'content-creation' },
];

export function TemplateFilters({ search, onSearchChange, onSearch, category, onCategoryChange }: TemplateFiltersProps) {
  const { t } = useTranslation();

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') onSearch();
  };

  return (
    <>
      <div className="agent-market__search">
        <Input
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('templates.searchPlaceholder')}
          className="agent-market__search-input"
        />
        <Button className="agent-market__search-btn" onClick={onSearch}>{t('common.buttons.search')}</Button>
      </div>

      <div className="agent-market__categories">
        {CATEGORY_FILTERS.map(({ key, value }) => (
          <Button
            key={value}
            variant="ghost"
            className={`agent-market__category-pill${category === value ? ' agent-market__category-pill--active' : ''}`}
            onClick={() => onCategoryChange(value)}
          >
            {t(key)}
          </Button>
        ))}
      </div>
    </>
  );
}
