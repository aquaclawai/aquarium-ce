import { Waitlist } from '@clerk/clerk-react';
import { ThemeToggle } from '../components/ThemeToggle';

export function WaitlistPage() {
  return (
    <main className="auth-page">
      <Waitlist />
      <p className="auth-footer">&copy; 2026 Aquarium. All rights reserved.</p>
      <ThemeToggle />
    </main>
  );
}
