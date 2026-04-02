import { useState, useEffect, useCallback, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, FileText, Globe, Sun, Moon, Menu } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { NotificationBell } from '../NotificationBell';
import { supportedLanguages, type SupportedLanguage } from '../../i18n';
import './AppLayout.css';

const THEME_KEY = 'openclaw-theme';

function getInitialTheme(): 'light' | 'dark' {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

export function AppLayout() {
  const { i18n } = useTranslation();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebar-collapsed') === 'true'
  );
  const [theme, setTheme] = useState<'light' | 'dark'>(getInitialTheme);
  const [langOpen, setLangOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  const applyTheme = useCallback((t: 'light' | 'dark') => {
    document.documentElement.classList.toggle('dark', t === 'dark');
    localStorage.setItem(THEME_KEY, t);
  }, []);

  useEffect(() => { applyTheme(theme); }, [theme, applyTheme]);

  useEffect(() => {
    if (!langOpen) return;
    function handleClick(e: MouseEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [langOpen]);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    function handleChange() {
      if (!mql.matches) setMobileOpen(false);
    }
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  const handleToggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar-collapsed', String(next));
      return next;
    });
  };

  const handleSelectLang = (code: string) => {
    i18n.changeLanguage(code);
    setLangOpen(false);
  };

  const currentLang = (i18n.language?.substring(0, 2) || 'en') as SupportedLanguage;

  return (
    <div className={`app-layout${sidebarCollapsed ? ' app-layout--sidebar-collapsed' : ''}`}>
      {mobileOpen && (
        <div className="app-layout__backdrop" onClick={() => setMobileOpen(false)} />
      )}
      <Sidebar collapsed={sidebarCollapsed} mobileOpen={mobileOpen} onNavClick={() => setMobileOpen(false)} />
      <button
        type="button"
        className="app-layout__hamburger"
        onClick={() => setMobileOpen(prev => !prev)}
        aria-label="Toggle menu"
      >
        <Menu size={20} />
      </button>
      <button
        type="button"
        className="app-layout__toggle"
        onClick={handleToggleSidebar}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
      <main className="app-layout__content">
        <Outlet />
      </main>
      <div className="app-layout__fab">
        <NotificationBell />
        <button className="app-layout__fab-btn" onClick={() => window.open('/docs', '_blank')}>
          <FileText size={18} />
        </button>
        <div className="app-layout__lang-wrap" ref={langRef}>
          {langOpen && (
            <div className="app-layout__lang-menu">
              {Object.entries(supportedLanguages).map(([code, { flag, label }]) => (
                <button
                  key={code}
                  className={`app-layout__lang-item${code === currentLang ? ' app-layout__lang-item--active' : ''}`}
                  onClick={() => handleSelectLang(code)}
                >
                  <span>{flag}</span>
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
          <button className="app-layout__fab-btn" onClick={() => setLangOpen(prev => !prev)}>
            <Globe size={18} />
          </button>
        </div>
        <button
          className="app-layout__fab-btn"
          onClick={() => setTheme(prev => prev === 'light' ? 'dark' : 'light')}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>
    </div>
  );
}
