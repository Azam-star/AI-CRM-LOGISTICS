import { NavLink, Outlet, Link } from 'react-router-dom';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Icon, Logo, type IconName } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operations',
    items: [
      { to: '/app', label: 'Dashboard', icon: 'grid', end: true },
      { to: '/app/requirements', label: 'Requirements', icon: 'clipboard' },
      { to: '/app/trips', label: 'Trip board', icon: 'truck' },
      { to: '/app/payments', label: 'Payments', icon: 'rupee' },
    ],
  },
  {
    title: 'Master data',
    items: [
      { to: '/app/vendors', label: 'Vendors', icon: 'users' },
      { to: '/app/ratecard', label: 'Rate card', icon: 'table' },
    ],
  },
];

export default function AppShell() {
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState('');

  async function logout() {
    setLogoutError('');
    try {
      await api.post('/api/auth/logout');
      navigate('/login', { replace: true });
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Could not sign out');
    }
  }

  return (
    <>
      <header className="topbar">
        <Link to="/" className="brand">
          <Logo />
          FreightDesk
          <small>CRM and logistics automation, POC build</small>
        </Link>
        <div className="topbar-right">
          <span>Sample data, refreshed on restart</span>
          <Link to="/">Product overview</Link>
          <button className="btn btn-sm" onClick={() => void logout()}>
            Sign out
          </button>
          <Link to="/app/requirements/new" className="btn btn-primary btn-sm">
            <Icon name="plus" size={14} />
            New requirement
          </Link>
        </div>
      </header>

      <div className="shell">
        <nav className="sidebar">
          {GROUPS.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-group-title">{group.title}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
                >
                  <Icon name={item.icon} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <main className="main">
          <div className="content-width">
            {logoutError && <div className="error-banner">{logoutError}</div>}
            <Outlet />
          </div>
        </main>
      </div>
    </>
  );
}
