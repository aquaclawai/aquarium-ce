import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ThemeToggle } from '../components/ThemeToggle';
import { api } from '../api';
import { Button, Input } from '@/components/ui';

export function TestLoginPage() {
  const { user, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isLoading && user) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/auth/test-login', { email, password });
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignup() {
    setError('');
    setSubmitting(true);
    try {
      await api.post('/auth/test-signup', { email, password, displayName: email.split('@')[0] });
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-container">
        <div className="auth-logo">
          <div className="auth-logo__icon">🐙</div>
          <div className="auth-logo__text">
            <span className="auth-logo__name">Aquarium</span>
            <span className="auth-logo__subtitle">Test Mode</span>
          </div>
        </div>
        <h1 className="auth-title">Sign In</h1>
        <p className="auth-subtitle">Enter your credentials to continue</p>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email</label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password</label>
            <div className="auth-password-field">
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
          </div>
          <Button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>
        <div className="auth-switch">
          No account?{' '}
          <a href="#" onClick={e => { e.preventDefault(); handleSignup(); }}>
            Create one with these credentials
          </a>
        </div>
      </div>
      <p className="auth-footer">&copy; 2026 Aquarium. All rights reserved.</p>
      <ThemeToggle />
    </main>
  );
}
