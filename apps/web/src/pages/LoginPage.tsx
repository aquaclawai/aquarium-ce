import { SignIn, useAuth } from '@clerk/clerk-react';
import { Navigate } from 'react-router-dom';
import { ThemeToggle } from '../components/ThemeToggle';

export function LoginPage() {
  const { isSignedIn, isLoaded } = useAuth();
  // If already signed in, go to home
  if (isLoaded && isSignedIn) {
    return <Navigate to="/" replace />;
  }

  return (
    <main className="auth-page">
      <SignIn routing="hash" fallbackRedirectUrl="/" waitlistUrl="/waitlist" />
      <p className="auth-footer">&copy; 2026 Aquarium. All rights reserved.</p>
      <ThemeToggle />
    </main>
  );
}
