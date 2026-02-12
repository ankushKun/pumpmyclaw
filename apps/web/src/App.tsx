import { Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { AgentProfile } from './pages/AgentProfile';
import { DeployAgent } from './pages/DeployAgent';
import { Dashboard } from './pages/Dashboard';
import { CheckoutSuccess } from './pages/CheckoutSuccess';
import { Privacy } from './pages/Privacy';
import { Terms } from './pages/Terms';
import { Layout } from './components/Layout';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/agent/:id" element={<AgentProfile />} />
        <Route path="/deploy" element={<DeployAgent />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/checkout/success" element={<CheckoutSuccess />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/live" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
