import { useState, useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Globe, Sun, Moon } from 'lucide-react';
import { AppSidebar } from './Sidebar';
import { NotificationBell } from '../NotificationBell';
import { supportedLanguages, type SupportedLanguage } from '../../i18n';
import { useTheme } from '../../context/ThemeContext';
import { Button } from '@/components/ui';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import './AppLayout.css';

export function AppLayout() {
  const { i18n } = useTranslation();
  const { theme, toggleTheme } = useTheme();

  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

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

  const handleSelectLang = (code: string) => {
    i18n.changeLanguage(code);
    setLangOpen(false);
  };

  const currentLang = (i18n.language?.substring(0, 2) || 'en') as SupportedLanguage;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="app-layout__header">
          <SidebarTrigger className="-ml-1" />
          <div className="app-layout__separator" />
          <div className="app-layout__header-actions">
            <NotificationBell />
            <Button
              variant="ghost"
              size="icon"
              className="app-layout__fab-btn"
              onClick={toggleTheme}
              aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </Button>
            <div className="app-layout__lang-wrap" ref={langRef}>
              {langOpen && (
                <div className="app-layout__lang-menu" role="menu" aria-label="Language selection">
                  {Object.entries(supportedLanguages).map(([code, { flag, label }]) => (
                    <Button
                      key={code}
                      variant="ghost"
                      role="menuitem"
                      className={`app-layout__lang-item${code === currentLang ? ' app-layout__lang-item--active' : ''}`}
                      onClick={() => handleSelectLang(code)}
                    >
                      <span>{flag}</span>
                      <span>{label}</span>
                    </Button>
                  ))}
                </div>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="app-layout__fab-btn"
                onClick={() => setLangOpen(prev => !prev)}
                aria-label="Change language"
                aria-expanded={langOpen}
              >
                <Globe size={18} />
              </Button>
            </div>
          </div>
        </header>
        <div className="app-layout__content">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
