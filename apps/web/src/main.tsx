import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import './i18n'
import App from './App.tsx'
import { WebSocketProvider } from './context/WebSocketContext'

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string
const isCE = import.meta.env.VITE_EDITION === 'ce';

async function renderApp() {
  let tree: React.ReactNode;

  if (isCE) {
    // Community Edition: no auth — single admin user always authenticated
    const { CeAuthProvider } = await import('./context/CeAuthProvider');
    tree = (
      <CeAuthProvider>
        <WebSocketProvider>
          <App />
        </WebSocketProvider>
      </CeAuthProvider>
    );
  } else if (PUBLISHABLE_KEY) {
    // Production: use Clerk
    const { ClerkProvider } = await import('@clerk/clerk-react');
    const { AuthProvider } = await import('./context/AuthContext');
    tree = (
      <ClerkProvider publishableKey={PUBLISHABLE_KEY} signInUrl="/login" afterSignOutUrl="/login">
        <AuthProvider>
          <WebSocketProvider>
            <App />
          </WebSocketProvider>
        </AuthProvider>
      </ClerkProvider>
    );
  } else {
    // Test mode: no Clerk — use cookie-based test auth
    const { TestAuthProvider } = await import('./context/TestAuthProvider');
    tree = (
      <TestAuthProvider>
        <WebSocketProvider>
          <App />
        </WebSocketProvider>
      </TestAuthProvider>
    );
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        {tree}
      </BrowserRouter>
    </StrictMode>,
  );
}

renderApp();
