import { useState, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';

const isEE = import.meta.env.VITE_EDITION !== 'ce';
import {
  LayoutDashboard,
  Store,
  Bot,
  ChevronUp,
  ChevronDown,
  MessageSquare,
  MessagesSquare,
  Zap,
} from 'lucide-react';
import { UserMenu } from './UserMenu';
import './Sidebar.css';

interface SidebarProps {
  collapsed: boolean;
  mobileOpen?: boolean;
  onNavClick?: () => void;
}

export function Sidebar({ collapsed, mobileOpen, onNavClick }: SidebarProps) {
  const { t } = useTranslation();
  const { user, isAdmin } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  const navItems = [
    { to: '/', icon: MessageSquare, label: t('sidebar.chat') },
    { to: '/group-chats', icon: MessagesSquare, label: t('sidebar.groupChats') },
    { to: '/dashboard', icon: LayoutDashboard, label: t('sidebar.dashboard') },
    { to: '/templates', icon: Store, label: t('sidebar.skills') },
    { to: '/assistants', icon: Bot, label: t('sidebar.assistants') },
  ];

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [menuOpen]);

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${mobileOpen ? ' sidebar--mobile-open' : ''}`} ref={sidebarRef}>
      <div className="sidebar__logo">
        <div className="sidebar__logo-icon">
          <Zap size={20} />
        </div>
        {!collapsed && (
          <div className="sidebar__logo-text">
            <span className="sidebar__logo-name">OpenClaw</span>
            <span className="sidebar__logo-subtitle">Platform</span>
          </div>
        )}
      </div>

      <nav className="sidebar__nav">
        {navItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `sidebar__nav-item ${isActive ? 'sidebar__nav-item--active' : ''}`
            }
            onClick={() => onNavClick?.()}
          >
            <item.icon size={20} />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar__spacer" />

      {isEE && !collapsed && (
        <div className="sidebar__coming-soon">
          <span>{t('sidebar.proComingSoon')}</span>
        </div>
      )}

      {!isEE && !collapsed && (
        <div className="sidebar__edition-badge">
          <span>{t('sidebar.communityEdition')}</span>
        </div>
      )}

      <button
        type="button"
        className="sidebar__user"
        onClick={() => setMenuOpen(prev => !prev)}
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        <div className="sidebar__user-avatar">
          {user?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
        </div>
        {!collapsed && (
          <div className="sidebar__user-info">
            <span className="sidebar__user-name">
              {user?.displayName ?? 'User'}
            </span>
            <span className="sidebar__user-email">
              {user?.email ?? ''}
            </span>
          </div>
        )}
        {!collapsed && (
          <span className="sidebar__user-chevron">
            {menuOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </span>
        )}
      </button>

      {menuOpen && !collapsed && (
        <UserMenu
          isAdmin={isAdmin}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </aside>
  );
}
