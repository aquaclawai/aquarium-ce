import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import type { TemplateManifest, TemplateCategory, PaginatedResponse, TemplateContent } from '@aquarium/shared';
import './TemplatesPage.css';
import { PageHeader } from '../components/PageHeader';
import { TemplateCard } from '../components/templates/TemplateCard';
import { TemplateFilters } from '../components/templates/TemplateFilters';
import { InstantiateDialog } from '../components/templates/InstantiateDialog';
import { PageHeaderSkeleton, CardSkeleton } from '@/components/skeletons';
import { Skeleton } from '@/components/ui/skeleton';

export function TemplatesPage() {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<TemplateManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<TemplateCategory | ''>('');

  const [selectedTemplate, setSelectedTemplate] = useState<TemplateManifest | null>(null);
  const [templateContent, setTemplateContent] = useState<TemplateContent | null>(null);
  const [platformCredentials, setPlatformCredentials] = useState<Array<{ provider: string; credentialType: string }>>([]);

  useEffect(() => {
    api.get<Array<{ provider: string; credentialType: string }>>('/credentials/platform')
      .then(setPlatformCredentials)
      .catch(() => { /* ignore — table may not exist yet */ });
  }, []);

  const fetchTemplates = async (searchQuery?: string, categoryFilter?: TemplateCategory | '') => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (categoryFilter) params.set('category', categoryFilter);
      params.set('limit', '50');
      const qs = params.toString();
      const data = await api.get<PaginatedResponse<TemplateManifest>>(`/templates${qs ? `?${qs}` : ''}`);
      setTemplates(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('templates.instantiate.failedToLoad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates(search, category);
  }, [category]);

  const handleSearch = () => fetchTemplates(search, category);

  const openInstantiateModal = async (template: TemplateManifest) => {
    setSelectedTemplate(template);
    setTemplateContent(null);
    try {
      const content = await api.get<TemplateContent>(`/templates/${template.id}/content`);
      setTemplateContent(content);
    } catch { /* security info optional */ }
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (!open) { setSelectedTemplate(null); setTemplateContent(null); }
  };

  const featuredTemplates = templates.filter(tmpl => tmpl.featured);

  if (loading && templates.length === 0) {
    return (
      <main className="agent-market">
        <PageHeaderSkeleton />
        <Skeleton className="h-10 w-full rounded-md mb-4" />
        <div className="agent-market__grid">
          {Array.from({ length: 8 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className="agent-market">
      <PageHeader
        title={t('templates.title')}
        subtitle={t('skillMarket.subtitle')}
      />

      {error && <div className="error-message" role="alert">{error}</div>}

      <TemplateFilters
        search={search}
        onSearchChange={setSearch}
        onSearch={handleSearch}
        category={category}
        onCategoryChange={setCategory}
      />

      {featuredTemplates.length > 0 && (
        <section className="agent-market__section">
          <h2 className="agent-market__section-title">{t('skillMarket.featured')}</h2>
          <div className="agent-market__featured-grid">
            {featuredTemplates.map(template => (
              <TemplateCard key={template.id} template={template} onInstantiate={openInstantiateModal} />
            ))}
          </div>
        </section>
      )}

      <section className="agent-market__section">
        <h2 className="agent-market__section-title">{t('skillMarket.allAssistants')}</h2>
        {templates.length === 0 && !loading && (
          <div className="info-message">{t('templates.noTemplates')}</div>
        )}
        <div className="agent-market__grid">
          {templates.map(template => (
            <TemplateCard key={template.id} template={template} onInstantiate={openInstantiateModal} />
          ))}
        </div>
      </section>

      <InstantiateDialog
        template={selectedTemplate}
        templateContent={templateContent}
        open={!!selectedTemplate}
        onOpenChange={handleDialogOpenChange}
        onCreated={() => { setSelectedTemplate(null); setTemplateContent(null); }}
        platformCredentials={platformCredentials}
      />
    </main>
  );
}
