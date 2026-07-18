import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Toaster } from './components/ui/sonner';

const hasClerk = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const isEE = import.meta.env.VITE_EDITION !== 'ce';

// Auth pages — lazy-loaded to avoid pulling in @clerk/clerk-react when Clerk is absent
const LoginPage = lazy(() =>
  hasClerk
    ? import('./pages/LoginPage').then(m => ({ default: m.LoginPage }))
    : import('./pages/TestLoginPage').then(m => ({ default: m.TestLoginPage }))
);
const WaitlistPage = lazy(() =>
  hasClerk
    ? import('./pages/WaitlistPage').then(m => ({ default: m.WaitlistPage }))
    : import('./pages/TestLoginPage').then(m => ({ default: m.TestLoginPage }))
);

// Layout
const AppLayout = lazy(() => import('./components/layout/AppLayout').then(m => ({ default: m.AppLayout })));

// Lazy-loaded pages
const WorkbenchPage = lazy(() => import('./pages/WorkbenchPage').then(m => ({ default: m.WorkbenchPage })));
const InstancePage = lazy(() => import('./pages/InstancePage').then(m => ({ default: m.InstancePage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then(m => ({ default: m.AdminPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage').then(m => ({ default: m.ProfilePage })));
const GoogleOAuthCallback = lazy(() => import('./pages/GoogleOAuthCallback').then(m => ({ default: m.GoogleOAuthCallback })));
const ChatHubPage = lazy(() => import('./pages/ChatHubPage').then(m => ({ default: m.ChatHubPage })));
const GroupChatsListPage = lazy(() => import('./pages/GroupChatsListPage').then(m => ({ default: m.GroupChatsListPage })));
const GroupChatPage = lazy(() => import('./pages/GroupChatPage').then(m => ({ default: m.GroupChatPage })));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage').then(m => ({ default: m.TemplatesPage })));
const SystemConfigPage = lazy(() => import('./pages/SystemConfigPage').then(m => ({ default: m.SystemConfigPage })));
const CreateWizardPage = lazy(() => import('./pages/CreateWizardPage').then(m => ({ default: m.CreateWizardPage })));
const CredentialsPage = lazy(() => import('./pages/CredentialsPage').then(m => ({ default: m.CredentialsPage })));
// EE-only pages — tree-shaken from CE build via isEE guard
const EmptyPage = lazy(() => Promise.resolve({ default: () => null }));
const SaleVoiceOAuthCallback = isEE
  ? lazy(() => import('./ee/pages/SaleVoiceOAuthCallback').then(m => ({ default: m.SaleVoiceOAuthCallback })))
  : EmptyPage;
const BillingOverviewPage = isEE
  ? lazy(() => import('./ee/pages/BillingOverviewPage').then(m => ({ default: m.BillingOverviewPage })))
  : EmptyPage;
const BillingOrdersPage = isEE
  ? lazy(() => import('./ee/pages/BillingOrdersPage').then(m => ({ default: m.BillingOrdersPage })))
  : EmptyPage;
const BillingCostsPage = isEE
  ? lazy(() => import('./ee/pages/BillingCostsPage').then(m => ({ default: m.BillingCostsPage })))
  : EmptyPage;
const MyAssistantsPage = lazy(() => import('./pages/MyAssistantsPage').then(m => ({ default: m.MyAssistantsPage })));
const AssistantChatPage = lazy(() => import('./pages/AssistantChatPage').then(m => ({ default: m.AssistantChatPage })));
const AssistantVersionsPage = lazy(() => import('./pages/AssistantVersionsPage').then(m => ({ default: m.AssistantVersionsPage })));
const AssistantEditPage = lazy(() => import('./pages/AssistantEditPage').then(m => ({ default: m.AssistantEditPage })));
const ExportWizardPage = lazy(() => import('./pages/ExportWizardPage').then(m => ({ default: m.ExportWizardPage })));
const IssuesBoardPage = lazy(() => import('./pages/IssuesBoardPage').then(m => ({ default: m.IssuesBoardPage })));
const IssueDetailPage = lazy(() => import('./pages/IssueDetailPage').then(m => ({ default: m.IssueDetailPage })));
const AgentsPage = lazy(() => import('./pages/AgentsPage').then(m => ({ default: m.AgentsPage })));
const RuntimesPage = lazy(() => import('./pages/RuntimesPage').then(m => ({ default: m.RuntimesPage })));
const DaemonTokensPage = lazy(() => import('./pages/DaemonTokensPage').then(m => ({ default: m.DaemonTokensPage })));

// Docs pages (separate chunk)
const DocsLayout = lazy(() => import('./pages/docs/DocsLayout').then(m => ({ default: m.DocsLayout })));
const DocsHomePage = lazy(() => import('./pages/docs/DocsHomePage').then(m => ({ default: m.DocsHomePage })));
const DocsGettingStartedPage = lazy(() => import('./pages/docs/DocsGettingStartedPage').then(m => ({ default: m.DocsGettingStartedPage })));
const DocsInstancesPage = lazy(() => import('./pages/docs/DocsInstancesPage').then(m => ({ default: m.DocsInstancesPage })));
const DocsProvidersPage = lazy(() => import('./pages/docs/DocsProvidersPage').then(m => ({ default: m.DocsProvidersPage })));
const DocsWorkspacePage = lazy(() => import('./pages/docs/DocsWorkspacePage').then(m => ({ default: m.DocsWorkspacePage })));
const DocsTemplatesPage = lazy(() => import('./pages/docs/DocsTemplatesPage').then(m => ({ default: m.DocsTemplatesPage })));
const DocsSkillsPage = lazy(() => import('./pages/docs/DocsSkillsPage').then(m => ({ default: m.DocsSkillsPage })));
const DocsChannelsPage = lazy(() => import('./pages/docs/DocsChannelsPage').then(m => ({ default: m.DocsChannelsPage })));
const DocsGroupChatsPage = lazy(() => import('./pages/docs/DocsGroupChatsPage').then(m => ({ default: m.DocsGroupChatsPage })));
const DocsAboutPage = lazy(() => import('./pages/docs/DocsAboutPage').then(m => ({ default: m.DocsAboutPage })));

function App() {
  return (
    <Suspense fallback={<div className="page-loading" />}>
      <Toaster />
      <Routes>
        {isEE && <Route path="/login" element={<LoginPage />} />}
        {isEE && <Route path="/waitlist" element={<WaitlistPage />} />}
        <Route path="/oauth/salevoice/callback" element={<SaleVoiceOAuthCallback />} />
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<DocsHomePage />} />
          <Route path="getting-started" element={<DocsGettingStartedPage />} />
          <Route path="instances" element={<DocsInstancesPage />} />
          <Route path="providers" element={<DocsProvidersPage />} />
          <Route path="workspace" element={<DocsWorkspacePage />} />
          <Route path="templates" element={<DocsTemplatesPage />} />
          <Route path="skills" element={<DocsSkillsPage />} />
          <Route path="channels" element={<DocsChannelsPage />} />
          <Route path="group-chats" element={<DocsGroupChatsPage />} />
          <Route path="about" element={<DocsAboutPage />} />
        </Route>
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<ChatHubPage />} />
            <Route path="/dashboard" element={<WorkbenchPage />} />
            <Route path="/instances/:id" element={<InstancePage />} />
            <Route path="/assistants" element={<MyAssistantsPage />} />
            <Route path="/assistants/:id/chat" element={<AssistantChatPage />} />
            <Route path="/assistants/:id/versions" element={<AssistantVersionsPage />} />
            <Route path="/assistants/:id/edit" element={<AssistantEditPage />} />
            <Route path="/issues" element={<IssuesBoardPage />} />
            <Route path="/issues/:id" element={<IssueDetailPage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/runtimes" element={<RuntimesPage />} />
            <Route path="/daemon-tokens" element={<DaemonTokensPage />} />
            <Route path="/export/:id" element={<ExportWizardPage />} />
            <Route path="/create" element={<CreateWizardPage />} />
            <Route path="/group-chats" element={<GroupChatsListPage />} />
            <Route path="/group-chats/:id" element={<GroupChatPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
            {isEE && <Route path="/admin" element={<AdminPage />} />}
            {isEE && <Route path="/admin/config" element={<SystemConfigPage />} />}
            {isEE && <Route path="/profile" element={<ProfilePage />} />}
            {isEE && <Route path="/billing" element={<BillingOverviewPage />} />}
            {isEE && <Route path="/billing/orders" element={<BillingOrdersPage />} />}
            {isEE && <Route path="/billing/costs" element={<BillingCostsPage />} />}
            <Route path="/user/credentials" element={<CredentialsPage />} />
            <Route path="/oauth/google/callback" element={<GoogleOAuthCallback />} />
          </Route>
        </Route>
      </Routes>
    </Suspense>
  );
}

export default App;
