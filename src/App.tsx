import { useEffect } from 'react';
import { DEFAULT_BRAND_NAME, themeMeta } from './config/themes';
import { daysBetween } from './domain/date';
import { Analytics } from './pages/Analytics';
import { CAT } from './pages/CAT';
import { Errors } from './pages/Errors';
import { Goals } from './pages/Goals';
import { Home } from './pages/Home';
import { Log } from './pages/Log';
import { Mocks } from './pages/Mocks';
import { Onboarding } from './pages/Onboarding';
import { Review } from './pages/Review';
import { Settings } from './pages/Settings';
import { Today } from './pages/Today';
import { Week } from './pages/Week';
import { StoreProvider, useStore } from './state/store';
import { MorePage, Shell, useRoute } from './ui/layout/Shell';

/**
 * Pushes the chosen theme and brand out to the parts of the page React does
 * not own: the root attribute every palette hangs off, the browser-chrome
 * colour, the tab title and the favicon.
 */
function ThemeSync() {
  const { state } = useStore();
  const { theme, brand } = state.settings;

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);

    /*
     * Browsers honour the first `theme-color` whose media query matches, so
     * the two static ones in the document would win over anything appended
     * later. Replace them outright with a single element we control.
     */
    document.querySelectorAll('meta[name="theme-color"]').forEach((el) => el.remove());
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content =
      theme === 'system'
        ? getComputedStyle(root).getPropertyValue('--bg').trim() || themeMeta('light').themeColor
        : themeMeta(theme).themeColor;
    document.head.appendChild(meta);
  }, [theme]);

  useEffect(() => {
    document.title = brand.name.trim() || DEFAULT_BRAND_NAME;
  }, [brand.name]);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) return;
    const original = link.getAttribute('href');
    if (brand.image) {
      link.type = 'image/png';
      link.href = brand.image;
    }
    return () => {
      if (brand.image && original) {
        link.type = 'image/svg+xml';
        link.href = original;
      }
    };
  }, [brand.image]);

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
    <Shell
      route={route}
      navigate={navigate}
      daysRemaining={daysRemaining}
      target={state.profile.targetPercentile}
      brand={state.settings.brand}
    >
      {route === 'home' && <Home navigate={navigate} />}
      {route === 'today' && <Today navigate={navigate} />}
      {route === 'week' && <Week />}
      {route === 'log' && <Log />}
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
