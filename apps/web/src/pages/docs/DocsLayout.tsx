import { Link, NavLink, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { ThemeToggle } from '../../components/ThemeToggle.js';

const NAV_ITEMS = [
  { to: '/docs', label: 'Overview', end: true },
  { to: '/docs/getting-started', label: 'Getting Started' },
  { to: '/docs/instances', label: 'Instances' },
  { to: '/docs/providers', label: 'AI Providers' },
  { to: '/docs/workspace', label: 'Workspace Files' },
  { to: '/docs/templates', label: 'Templates' },
  { to: '/docs/skills', label: 'Skills & ClaWHub' },
  { to: '/docs/channels', label: 'Channels' },
  { to: '/docs/group-chats', label: 'Group Chats' },
  { to: '/docs/about', label: 'About' },
];

export function DocsLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className="docs-layout">
      <ThemeToggle />

      <header className="docs-header">
        <div className="docs-header-inner">
          <div className="docs-header-left">
            <button
              className="docs-sidebar-toggle"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Toggle navigation"
            >
              {sidebarOpen ? '\u2715' : '\u2630'}
            </button>
            <Link to="/docs" className="docs-brand">
              Aquarium
            </Link>
            <span className="docs-brand-tag">Docs</span>
          </div>
          <nav className="docs-nav">
            <Link to="/login">Sign In</Link>
            <Link to="/signup" className="docs-nav-cta">
              Get Started
            </Link>
          </nav>
        </div>
      </header>

      <div className="docs-layout-body">
        <aside className={`docs-sidebar ${sidebarOpen ? 'docs-sidebar--open' : ''}`}>
          <nav className="docs-sidebar-nav">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `docs-sidebar-link ${isActive ? 'docs-sidebar-link--active' : ''}`
                }
                onClick={closeSidebar}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        {sidebarOpen && (
          <div className="docs-sidebar-overlay" onClick={closeSidebar} />
        )}

        <main className="docs-main">
          <article className="docs-article">
            <Outlet />
          </article>
        </main>
      </div>

      <footer className="docs-footer">
        <p>
          <Link to="/login">Sign In</Link>
          {' \u00B7 '}
          <Link to="/signup">Create Account</Link>
          {' \u00B7 '}
          <Link to="/docs">Documentation</Link>
        </p>
      </footer>
    </div>
  );
}
