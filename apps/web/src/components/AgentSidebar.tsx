import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, X } from 'lucide-react';
import { AgentAvatar } from './AgentAvatar';
import type { InstancePublic } from '@aquarium/shared';
import './AgentSidebar.css';

interface AgentSidebarProps {
  instances: InstancePublic[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed?: boolean;
  onToggle?: () => void;
}

const STATUS_ORDER: Record<string, number> = {
  running: 0,
  starting: 1,
  stopping: 2,
  created: 3,
  stopped: 4,
  error: 5,
};

export function AgentSidebar({ instances, selectedId, onSelect, collapsed, onToggle }: AgentSidebarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const sorted = useMemo(() => {
    const filtered = search
      ? instances.filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
      : instances;
    return [...filtered].sort((a, b) => {
      const oa = STATUS_ORDER[a.status] ?? 9;
      const ob = STATUS_ORDER[b.status] ?? 9;
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
  }, [instances, search]);

  if (collapsed) {
    return (
      <aside className="agent-sidebar agent-sidebar--collapsed">
        <button
          className="agent-sidebar__toggle"
          onClick={onToggle}
          title={t('chatHub.showAgents')}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M13 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <div className="agent-sidebar__avatars-only">
          {sorted.slice(0, 10).map(inst => (
            <button
              key={inst.id}
              className={`agent-sidebar__avatar-btn ${selectedId === inst.id ? 'agent-sidebar__avatar-btn--active' : ''}`}
              onClick={() => onSelect(inst.id)}
              title={inst.name}
            >
              <AgentAvatar avatar={inst.avatar} name={inst.name} size="sm" />
              <span className={`agent-sidebar__dot agent-sidebar__dot--${inst.status}`} />
            </button>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="agent-sidebar">
      <div className="agent-sidebar__header">
        <h3 className="agent-sidebar__title">{t('chatHub.agents')}</h3>
        <button
          className="agent-sidebar__toggle"
          onClick={onToggle}
          title={t('chatHub.hideAgents')}
        >
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M7 4l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
      </div>

      <div className="agent-sidebar__search">
        <Search size={14} className="agent-sidebar__search-icon" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('chatHub.searchAgents')}
          className="agent-sidebar__search-input"
        />
        {search && (
          <button className="agent-sidebar__search-clear" onClick={() => setSearch('')}>
            <X size={14} />
          </button>
        )}
      </div>

      <div className="agent-sidebar__list">
        {sorted.length === 0 && search && (
          <div className="agent-sidebar__empty">{t('chatHub.noMatch')}</div>
        )}
        {sorted.map(inst => (
          <button
            key={inst.id}
            className={`agent-sidebar__item ${selectedId === inst.id ? 'agent-sidebar__item--active' : ''} ${inst.status !== 'running' ? 'agent-sidebar__item--offline' : ''}`}
            onClick={() => onSelect(inst.id)}
          >
            <div className="agent-sidebar__item-avatar">
              <AgentAvatar avatar={inst.avatar} name={inst.name} size="sm" />
              <span className={`agent-sidebar__dot agent-sidebar__dot--${inst.status}`} />
            </div>
            <div className="agent-sidebar__item-info">
              <span className="agent-sidebar__item-name">{inst.name}</span>
              <span className="agent-sidebar__item-status">
                {t(`chatHub.status.${inst.status}`, inst.status)}
              </span>
            </div>
          </button>
        ))}
      </div>

      <button className="agent-sidebar__create" onClick={() => navigate('/create')}>
        <Plus size={16} />
        <span>{t('chatHub.createAgent')}</span>
      </button>
    </aside>
  );
}
