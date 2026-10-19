import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthProvider, useAuth } from './auth/AuthContext';
import Login from './components/Login';
import { LegendStrip, Shell, type ConsoleView } from './console/Shell';
import OverviewView from './console/OverviewView';
import ApiKeysView from './console/ApiKeysView';
import { WebhooksView } from './console/WebhooksView';
import ProfileView from './console/ProfileView';
import UsageView from './console/UsageView';
import BillingView from './console/BillingView';
import AccessView from './console/AccessView';
import ReconView from './console/ReconView';
import ResilienceView from './console/ResilienceView';
import ReportingView from './console/ReportingView';
import { AuditView } from './console/AuditView';
import ClusterView from './console/ClusterView';
import CustomersView from './console/CustomersView';
import { ErrorBoundary } from './components/ErrorBoundary';

function ConsoleBody(): React.ReactElement {
  const { user, booted } = useAuth();
  const [view, setView] = React.useState<ConsoleView>('overview');

  if (!booted) {
    return (
      <div className="flex min-h-screen items-center justify-center font-mono text-xs text-slate-400">
        Restoring session…
      </div>
    );
  }

  if (!user) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="login"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 0.97 }}
          transition={{ duration: 0.25 }}
        >
          <Login />
        </motion.div>
      </AnimatePresence>
    );
  }

  return (
    <Shell view={view} onNavigate={setView}>
      <LegendStrip />
      <ErrorBoundary>
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}
          >
            {view === 'overview' && (
              <OverviewView
                onNavigate={(next) => setView(next)}
              />
            )}
            {view === 'api-keys' && <ApiKeysView />}
            {view === 'webhooks' && <WebhooksView />}
            {view === 'profile' && <ProfileView />}
            {view === 'usage' && <UsageView />}
            {view === 'billing' && <BillingView />}
            {view === 'access' && <AccessView />}
            {view === 'recon' && <ReconView />}
            {view === 'resilience' && <ResilienceView />}
            {view === 'reporting' && <ReportingView />}
            {view === 'audit' && <AuditView />}
            {view === 'cluster' && <ClusterView />}
            {view === 'customers' && <CustomersView />}
          </motion.div>
        </AnimatePresence>
      </ErrorBoundary>
    </Shell>
  );
}

export default function App(): React.ReactElement {
  return (
    <AuthProvider>
      <ConsoleBody />
    </AuthProvider>
  );
}
