import { Link, Route, Routes } from 'react-router-dom';
import AppShell from './components/AppShell';
import Dashboard from './pages/Dashboard';
import Landing from './pages/Landing';
import NewRequirement from './pages/NewRequirement';
import Payments from './pages/Payments';
import Privacy from './pages/Privacy';
import RateCard from './pages/RateCard';
import RequirementDetail from './pages/RequirementDetail';
import Requirements from './pages/Requirements';
import Terms from './pages/Terms';
import Trips from './pages/Trips';
import Vendors from './pages/Vendors';

function NotFound() {
  return (
    <div className="landing-wrap">
      <h1>Page not found</h1>
      <p className="muted">That address does not match anything in this build.</p>
      <p>
        <Link to="/">Back to the product overview</Link>
      </p>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/privacy" element={<Privacy />} />
      <Route path="/terms" element={<Terms />} />
      <Route path="/app" element={<AppShell />}>
        <Route index element={<Dashboard />} />
        <Route path="requirements" element={<Requirements />} />
        <Route path="requirements/new" element={<NewRequirement />} />
        <Route path="requirements/:id" element={<RequirementDetail />} />
        <Route path="trips" element={<Trips />} />
        <Route path="payments" element={<Payments />} />
        <Route path="vendors" element={<Vendors />} />
        <Route path="ratecard" element={<RateCard />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
