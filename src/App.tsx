import { useEffect } from 'react';
import { daysBetween } from './domain/date';
import { Analytics } from './pages/Analytics';
import { CAT } from './pages/CAT';
import { Errors } from './pages/Errors';
import { Goals } from './pages/Goals';
import { Home } from './pages/Home';
import { Mocks } from './pages/Mocks';
import { Onboarding } from './pages/Onboarding';
import { Review } from './pages/Review';
import { Settings } from './pages/Settings';
import { Today } from './pages/Today';
import { Week } from './pages/Week';
import { StoreProvider, useStore } from './state/store';
import { MorePage, Shell, useRoute } from './ui/layout/Shell';

function ThemeSync() {
  const { state } = useStore();
  useEffect(() => {
    const root = document.documentElement;
    if (state.settings.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', state.settings.theme);
  }, [state.settings.theme]);
  return null;
}

function Router() {
  const { state, loading, today } = useStore();
  const [route, navigate] = useRoute();

  if (loading) {
    return (
      <div className="main">
        <div className="empty">Loading your data…</div>
      </div>
    );
  }

  if (!state.profile.onboarded) return <Onboarding />;

  const daysRemaining = Math.max(0, daysBetween(today, state.profile.examDate));

  return (
    <Shell route={route} navigate={navigate} daysRemaining={daysRemaining} target={state.profile.targetPercentile}>
      {route === 'home' && <Home navigate={navigate} />}
      {route === 'today' && <Today navigate={navigate} />}
      {route === 'week' && <Week />}
      {route === 'goals' && <Goals />}
      {route === 'cat' && <CAT />}
      {route === 'mocks' && <Mocks />}
      {route === 'errors' && <Errors />}
      {route === 'review' && <Review />}
      {route === 'analytics' && <Analytics />}
      {route === 'settings' && <Settings />}
      {route === 'more' && <MorePage navigate={navigate} />}
    </Shell>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <ThemeSync />
      <Router />
    </StoreProvider>
  );
}
