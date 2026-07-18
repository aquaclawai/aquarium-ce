import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';

const isEE = import.meta.env.VITE_EDITION !== 'ce';

import {
  LayoutDashboard,
  Store,
  Bot,
  MessageSquare,
  MessagesSquare,
  CreditCard,
  UserCog,
  Settings,
  LogOut,
  ChevronsUpDown,
  KeyRound,
  FileText,
  ShieldCheck,
  Kanban,
  Server,
} from 'lucide-react';
import {
  Sidebar as SidebarRoot,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import './Sidebar.css';

interface NavItemDef {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  /**
   * Optional data-nav attribute value — threaded onto SidebarMenuButton.
   * Used by Playwright specs (e.g. tests/e2e/management-uis.spec.ts) to
   * select nav entries deterministically without relying on text content
   * that varies across 6 locales.
   */
  dataNav?: string;
}

function NavGroup({ label, items }: { label: string; items: NavItemDef[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toggleSidebar, isMobile } = useSidebar();

  const handleClick = (to: string) => {
    navigate(to);
    if (isMobile) toggleSidebar();
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(item => {
            const isActive = item.to === '/'
              ? location.pathname === '/'
              : location.pathname.startsWith(item.to);
            return (
              <SidebarMenuItem key={item.to}>
                <SidebarMenuButton
                  tooltip={item.label}
                  isActive={isActive}
                  onClick={() => handleClick(item.to)}
                  {...(item.dataNav ? { 'data-nav': item.dataNav } : {})}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function NavMain() {
  const { t } = useTranslation();

  const conversationItems: NavItemDef[] = [
    { to: '/', icon: MessageSquare, label: t('sidebar.chat') },
    { to: '/group-chats', icon: MessagesSquare, label: t('sidebar.groupChats') },
  ];

  const workspaceItems: NavItemDef[] = [
    { to: '/dashboard', icon: LayoutDashboard, label: t('sidebar.dashboard') },
    { to: '/issues', icon: Kanban, label: t('sidebar.issues') },
    { to: '/agents', icon: Bot, label: t('sidebar.agents'), dataNav: 'agents' },
    { to: '/runtimes', icon: Server, label: t('sidebar.runtimes'), dataNav: 'runtimes' },
    { to: '/daemon-tokens', icon: KeyRound, label: t('sidebar.daemonTokens'), dataNav: 'daemon-tokens' },
    { to: '/templates', icon: Store, label: t('sidebar.skills') },
    { to: '/assistants', icon: Bot, label: t('sidebar.assistants') },
  ];

  return (
    <>
      <NavGroup label={t('sidebar.chat')} items={conversationItems} />
      <NavGroup label="Workspace" items={workspaceItems} />
    </>
  );
}

function NavSecondary() {
  return (
    <SidebarGroup className="mt-auto">
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Docs"
              onClick={() => window.open('/docs', '_blank')}
            >
              <FileText />
              <span>Docs</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function NavUser() {
  const { t } = useTranslation();
  const { user, isAdmin, logout } = useAuth();
  const navigate = useNavigate();
  const { isMobile } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm">
                {user?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">
                  {user?.displayName ?? 'User'}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {user?.email ?? ''}
                </span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground font-semibold text-sm">
                  {user?.displayName?.charAt(0)?.toUpperCase() ?? '?'}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {user?.displayName ?? 'User'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user?.email ?? ''}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {isEE && (
                <DropdownMenuItem onClick={() => navigate('/profile')}>
                  <UserCog />
                  {t('sidebar.account')}
                </DropdownMenuItem>
              )}
              {isEE && (
                <DropdownMenuItem onClick={() => navigate('/billing')}>
                  <CreditCard />
                  {t('sidebar.billing')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => navigate('/user/credentials')}>
                <KeyRound />
                {t('sidebar.credentials')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {isEE && isAdmin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => navigate('/admin')}>
                    <ShieldCheck />
                    {t('admin.title')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/admin/config')}>
                    <Settings />
                    {t('sidebar.systemConfig')}
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
            {isEE && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => logout()}>
                  <LogOut />
                  {t('common.buttons.logout')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

export function AppSidebar(props: React.ComponentProps<typeof SidebarRoot>) {
  return (
    <SidebarRoot collapsible="icon" {...props}>
      <SidebarHeader>
        <div className="flex items-center px-2 py-1.5">
          <span className="truncate text-lg group-data-[collapsible=icon]:hidden" style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, color: 'var(--color-primary)' }}>Aquarium</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
        <NavSecondary />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
    </SidebarRoot>
  );
}
