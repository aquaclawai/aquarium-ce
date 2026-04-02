import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api';

export function GoogleOAuthCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(true);

  useEffect(() => {
    (async () => {
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const pendingRaw = sessionStorage.getItem('google_oauth_pending');

      if (!code || !state || !pendingRaw) {
        setError('Missing OAuth parameters. Please try again from the instance page.');
        setProcessing(false);
        return;
      }

      let pending: { state: string; instanceId: string };
      try {
        pending = JSON.parse(pendingRaw) as { state: string; instanceId: string };
      } catch {
        setError('Invalid session data. Please try again from the instance page.');
        setProcessing(false);
        return;
      }

      if (pending.state !== state) {
        setError('OAuth state mismatch — possible CSRF. Please try again.');
        setProcessing(false);
        return;
      }

      sessionStorage.removeItem('google_oauth_pending');
      const { instanceId } = pending;

      try {
        const tokenData = await api.post<{ accessToken: string; refreshToken?: string; expiresIn?: number }>(
          '/oauth/google/token',
          { code, state },
        );

        await api.post(`/instances/${instanceId}/credentials`, {
          provider: 'google',
          credentialType: 'oauth_token',
          value: tokenData.accessToken,
          metadata: { refreshToken: tokenData.refreshToken, expiresIn: tokenData.expiresIn },
        });

        sessionStorage.setItem('google_oauth_success', JSON.stringify({ instanceId }));
        navigate(`/instances/${instanceId}`, { replace: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to complete Google authentication');
        setProcessing(false);
      }
    })();
  }, [searchParams, navigate]);

  if (error) {
    return (
      <div className="page-container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <h2>Authentication Failed</h2>
        <p style={{ color: '#e74c3c', marginTop: '1rem' }}>{error}</p>
        <button style={{ marginTop: '1.5rem' }} onClick={() => navigate('/', { replace: true })}>
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (processing) {
    return (
      <div className="page-container" style={{ textAlign: 'center', paddingTop: '4rem' }}>
        <h2>Completing Google Authentication...</h2>
        <p style={{ marginTop: '1rem' }}><span className="spinner" /> Please wait while we finalize your connection.</p>
      </div>
    );
  }

  return null;
}
