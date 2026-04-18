import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import type { Agent, Runtime } from '@aquarium/shared';
import { api } from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AgentList } from '@/components/management/AgentList';
import { useAgents } from '@/components/management/useAgents';

/**
 * Phase 25 Plan 25-01 — Agents page.
 *
 * Orchestrates the Active/Archived tab UX, search toolbar, "New agent" CTA,
 * and delegates row rendering to <AgentList>. Form dialog + archive
 * confirmation dialogs are wired in Tasks 2 + 3.
 *
 * MGMT-01 surface with ROADMAP SC-1 status column rendered via AgentList.
 */
export function AgentsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { active, archived, isLoading, create, update, archive, restore } = useAgents();
  void create;
  void update;
  void archive;
  void restore;

  const initialTab = searchParams.get('tab') === 'archived' ? 'archived' : 'active';
  const [tab, setTab] = useState<'active' | 'archived'>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [runtimes, setRuntimes] = useState<Runtime[]>([]);
  const [runtimesLoading, setRuntimesLoading] = useState(true);

  // Form + archive dialog state (wired in Tasks 2 + 3)
  const [formState, setFormState] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    agent: Agent | null;
  }>({ open: false, mode: 'create', agent: null });
  void formState;

  const [archiveState, setArchiveState] = useState<{
    open: boolean;
    agent: Agent | null;
    mode: 'archive' | 'restore';
  }>({ open: false, agent: null, mode: 'archive' });
  void archiveState;

  // Fetch runtimes once.
  useEffect(() => {
    let alive = true;
    api
      .get<Runtime[]>('/runtimes')
      .then((list) => {
        if (alive) setRuntimes(list);
      })
      .catch(() => {
        if (alive) toast.error(t('management.runtimes.loadFailed', { retry: '' }));
      })
      .finally(() => {
        if (alive) setRuntimesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [t]);

  const handleTabChange = (value: string) => {
    if (value !== 'active' && value !== 'archived') return;
    setTab(value);
    // Keep URL in sync — `?tab=archived` deep-links to the Archived tab.
    const next = new URLSearchParams(searchParams);
    if (value === 'archived') {
      next.set('tab', 'archived');
    } else {
      next.delete('tab');
    }
    setSearchParams(next, { replace: true });
  };

  const handleOpenCreate = () => {
    setFormState({ open: true, mode: 'create', agent: null });
  };

  const handleEdit = (agent: Agent) => {
    setFormState({ open: true, mode: 'edit', agent });
  };

  const handleArchive = (agent: Agent) => {
    setArchiveState({ open: true, agent, mode: 'archive' });
  };

  const handleRestore = (agent: Agent) => {
    setArchiveState({ open: true, agent, mode: 'restore' });
  };

  const handleClearSearch = () => setSearchQuery('');

  const tableLoading = isLoading || runtimesLoading;

  return (
    <main data-page="agents" className="mx-auto max-w-[1200px] p-6 pb-8">
      <header className="mb-4">
        <h1 className="text-2xl font-medium">{t('management.agents.title')}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t('management.agents.description')}
        </p>
      </header>

      <div className="flex items-center gap-3 mb-6">
        <Input
          type="search"
          placeholder={t('management.agents.filter.search')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="max-w-[320px]"
          aria-label={t('management.agents.filter.search')}
        />
        <div className="flex-1" />
        <Button data-agent-new-open onClick={handleOpenCreate}>
          <Plus className="h-4 w-4" />
          {t('management.agents.actions.create')}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="mb-4">
          <TabsTrigger data-agent-tab="active" value="active">
            {t('management.agents.tabs.active')}
            <span className="ml-1.5 text-xs text-muted-foreground">({active.length})</span>
          </TabsTrigger>
          <TabsTrigger data-agent-tab="archived" value="archived">
            {t('management.agents.tabs.archived')}
            <span className="ml-1.5 text-xs text-muted-foreground">({archived.length})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <AgentList
            agents={active}
            runtimes={runtimes}
            isLoading={tableLoading}
            onEdit={handleEdit}
            onArchive={handleArchive}
            onRestore={handleRestore}
            onClearSearch={handleClearSearch}
            onCreate={handleOpenCreate}
            archivedView={false}
            searchQuery={searchQuery}
          />
        </TabsContent>

        <TabsContent value="archived">
          <AgentList
            agents={archived}
            runtimes={runtimes}
            isLoading={tableLoading}
            onEdit={handleEdit}
            onArchive={handleArchive}
            onRestore={handleRestore}
            onClearSearch={handleClearSearch}
            onCreate={handleOpenCreate}
            archivedView={true}
            searchQuery={searchQuery}
          />
        </TabsContent>
      </Tabs>

      {/* AgentFormDialog mounted in Task 2 */}
      {/* ArchiveConfirmDialog mounted in Task 3 */}
    </main>
  );
}
