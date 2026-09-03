import { useEffect, useState, type ReactNode } from 'react';

export const ROUTES = [
  { key: 'home', label: 'Home', glyph: '◈', primary: true },
  { key: 'today', label: 'Today', glyph: '◉', primary: true },
  { key: 'week', label: 'Week', glyph: '▤', primary: true },
  { key: 'cat', label: 'CAT', glyph: '◎', primary: true },
  { key: 'goals', label: 'Goals', glyph: '⌖', primary: false },
  { key: 'mocks', label: 'Mocks', glyph: '▦', primary: false },
  { key: 'errors', label: 'Errors', glyph: '⚑', primary: false },
  { key: 'review', label: 'Review', glyph: '⟳', primary: false },
  { key: 'analytics', label: 'Analytics', glyph: '▚', primary: false },
  { key: 'settings', label: 'Settings', glyph: '⚙', primary: false },
] as const;

export type RouteKey = (typeof ROUTES)[number]['key'] | 'more';

function parseHash(): RouteKey {
  const raw = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  const match = ROUTES.find((r) => r.key === raw);
  if (match) return match.key;
  return raw === 'more' ? 'more' : 'home';
}

export function useRoute(): [RouteKey, (key: RouteKey) => void] {
  const [route, setRoute] = useState<RouteKey>(() => parseHash());

  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = (key: RouteKey) => {
    window.location.hash = `/${key}`;
  };

  return [route, navigate];
}

export function Shell({
  route,
  navigate,
  daysRemaining,
  target,
  children,
}: {
  route: RouteKey;
  navigate: (key: RouteKey) => void;
  daysRemaining: number;
  target: number;
  children: ReactNode;
}) {
  const primary = ROUTES.filter((r) => r.primary);

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Main navigation">
        <div className="sidebar-brand">
          <strong>CAT Monitor</strong>
          <span>
            {target}+ percentile · {daysRemaining} days left
          </span>
        </div>
        {ROUTES.map((r) => (
          <button
            key={r.key}
            type="button"
            className="nav-link"
            aria-current={route === r.key ? 'page' : undefined}
            onClick={() => navigate(r.key)}
          >
            <span className="glyph" aria-hidden="true">
              {r.glyph}
            </span>
            {r.label}
          </button>
        ))}
      </nav>

      <main className="main" id="main">
        {children}
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {primary.map((r) => (
          <button
            key={r.key}
            type="button"
            aria-current={route === r.key ? 'page' : undefined}
            onClick={() => navigate(r.key)}
          >
            <span className="glyph" aria-hidden="true">
              {r.glyph}
            </span>
            {r.label}
          </button>
        ))}
        <button type="button" aria-current={route === 'more' ? 'page' : undefined} onClick={() => navigate('more')}>
          <span className="glyph" aria-hidden="true">
            ☰
          </span>
          More
        </button>
      </nav>
    </div>
  );
}

export function MorePage({ navigate }: { navigate: (key: RouteKey) => void }) {
  return (
    <>
      <div className="page-header">
        <h1>More</h1>
      </div>
      <div className="card">
        {ROUTES.filter((r) => !r.primary).map((r) => (
          <button key={r.key} type="button" className="nav-link" onClick={() => navigate(r.key)}>
            <span className="glyph" aria-hidden="true">
              {r.glyph}
            </span>
            {r.label}
          </button>
        ))}
      </div>
    </>
  );
}
