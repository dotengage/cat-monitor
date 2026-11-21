import { useEffect } from 'react';
import { DEFAULT_BRAND_NAME, themeMeta } from './config/themes';
import { daysBetween } from './domain/date';
import { Analytics } from './pages/Analytics';
import { CAT } from './pages/CAT';
import { Flashcards } from './pages/Flashcards';
import { Goals } from './pages/Goals';
import { Home } from './pages/Home';
import { Log } from './pages/Log';
import { Mocks } from './pages/Mocks';
import { Onboarding } from './pages/Onboarding';
import { SampleBanner } from './ui/components/SampleBanner';
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

const LOCKED_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
const FREE_VIEWPORT = 'width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes, viewport-fit=cover';

/**
 * Zoom is locked on phones, because an app that drifts in and out of zoom
 * while you tap and type stops feeling like an app - except on Flashcards,
 * where pinching in on a small screenshot is often the only way to read it.
 *
 * Android honours the viewport tag. iOS Safari ignores it for pinching, so
 * there the pinch gesture itself is cancelled. Double-tap zoom is off
 * everywhere (in the stylesheet), so quick taps on the study buttons never
 * zoom either.
 */
function ZoomPolicy({ allow }: { allow: boolean }) {
  useEffect(() => {
    document.querySelector('meta[name="viewport"]')?.setAttribute('content', allow ? FREE_VIEWPORT : LOCKED_VIEWPORT);
    if (allow) return;

    const cancel = (e: Event) => e.preventDefault();
    const pinch = (e: TouchEvent) => {
      if (e.touches.length > 1) e.preventDefault();
    };
    const options: AddEventListenerOptions = { passive: false };
    document.addEventListener('gesturestart', cancel, options);
    document.addEventListener('gesturechange', cancel, options);
    document.addEventListener('touchmove', pinch, options);
    return () => {
      document.removeEventListener('gesturestart', cancel, options);
      document.removeEventListener('gesturechange', cancel, options);
      document.removeEventListener('touchmove', pinch, options);
    };
  }, [allow]);
  return null;
}

function Router() {
  const { state, loading, today } = useStore();
  const [route, navigate] = useRoute();
  const zoom = <ZoomPolicy allow={state.profile.onboarded && !loading && route === 'flashcards'} />;

  if (loading) {
    return (
      <div className="main">
        {zoom}
        <div className="empty">Loading your data…</div>
      </div>
    );
  }

  if (!state.profile.onboarded) {
    return (
      <>
        {zoom}
        <Onboarding />
      </>
    );
  }

  const daysRemaining = Math.max(0, daysBetween(today, state.profile.examDate));

  return (
    <Shell
      route={route}
      navigate={navigate}
      daysRemaining={daysRemaining}
      target={state.profile.targetPercentile}
      brand={state.settings.brand}
    >
      {zoom}
      {state.demo && <SampleBanner />}
      {route === 'home' && <Home navigate={navigate} />}
      {route === 'today' && <Today navigate={navigate} />}
      {route === 'week' && <Week />}
      {route === 'log' && <Log />}
      {route === 'flashcards' && <Flashcards />}
      {route === 'goals' && <Goals />}
      {route === 'cat' && <CAT />}
      {route === 'mocks' && <Mocks />}
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
