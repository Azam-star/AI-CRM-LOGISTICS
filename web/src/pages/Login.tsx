import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, useAuth } from '../auth';
import { Logo } from '../components/ui';

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('admin@freightdesk.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/app';

  if (!loading && user) return <Navigate to="/app" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const signedIn = await signIn(email, password);
      void signedIn;
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="landing-wrap">
      <div className="landing-top">
        <div className="inner">
          <Link to="/" className="brand">
            <Logo />
            FreightDesk
          </Link>
          <nav className="landing-nav">
            <Link to="/">Product overview</Link>
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
          </nav>
        </div>
      </div>

      <div className="auth-card">
        <h1>Sign in</h1>
        <p className="muted">Operations console for requirements, outreach, trips and payments.</p>

        <form onSubmit={submit} className="auth-form">
          {error ? <div className="error-banner">{error}</div> : null}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Signing in' : 'Sign in'}
          </button>
        </form>

        <div className="auth-hint">
          <div className="label">Demo accounts</div>
          <table>
            <tbody>
              <tr>
                <td>admin@freightdesk.local</td>
                <td>admin123</td>
                <td>{ROLE_LABEL.admin}</td>
              </tr>
              <tr>
                <td>sales@freightdesk.local</td>
                <td>sales123</td>
                <td>{ROLE_LABEL.sales}</td>
              </tr>
              <tr>
                <td>ops@freightdesk.local</td>
                <td>ops123</td>
                <td>{ROLE_LABEL.ops}</td>
              </tr>
              <tr>
                <td>finance@freightdesk.local</td>
                <td>finance123</td>
                <td>{ROLE_LABEL.finance}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
