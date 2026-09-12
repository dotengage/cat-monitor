import { useEffect, useState, type ReactNode } from 'react';
import type { Brand } from '../../domain/types';
import { Icon, type IconName } from './icons';

export const ROUTES = [
  { key: 'home', label: 'Home', icon: 'home', primary: true, group: 'Plan' },
  { key: 'today', label: 'Today', icon: 'today', primary: true, group: 'Plan' },
  { key: 'week', label: 'Week', icon: 'week', primary: true, group: 'Plan' },
  { key: 'log', label: 'Log', icon: 'log', primary: true, group: 'Plan' },
  { key: 'cat', label: 'CAT readiness', icon: 'cat', primary: false, group: 'Performance' },
  { key: 'mocks', label: 'Mocks', icon: 'mocks', primary: false, group: 'Performance' },
  { key: 'errors', label: 'Errors', icon: 'errors', primary: false, group: 'Performance' },
  { key: 'analytics', label: 'Analytics', icon: 'analytics', primary: false, group: 'Performance' },
  { key: 'goals', label: 'Goals', icon: 'goals', primary: false, group: 'System' },
  { key: 'review', label: 'Weekly review', icon: 'review', primary: false, group: 'System' },
  { key: 'settings', label: 'Settings', icon: 'settings', primary: false, group: 'System' },
] as const;

const GROUPS = ['Plan', 'Performance', 'System'] as const;

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

/** The square mark: an uploaded image if there is one, otherwise the glyph. */
export function BrandMark({ brand, size }: { brand: Brand; size?: number }) {
  const style = size ? { width: size, height: size, fontSize: size * 0.46 } : undefined;
  return (
    <span className="brand-mark" aria-hidden="true" style={style}>
      {brand.image ? <img src={brand.image} alt="" /> : (brand.glyph || 'C')}
    </span>
  );
}

export function Shell({
  route,
  navigate,
  daysRemaining,
  target,
  brand,
  children,
}: {
  route: RouteKey;
  navigate: (key: RouteKey) => void;
  daysRemaining: number;
  target: number;
  brand: Brand;
  children: ReactNode;
}) {
  const primary = ROUTES.filter((r) => r.primary);

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Main navigation">
        {/* The mark and name are editable, so the header doubles as the way in. */}
        <button
          type="button"
          className="sidebar-brand"
          onClick={() => navigate('settings')}
          title="Change the name, icon and theme"
        >
          <BrandMark brand={brand} />
          <span>
            <strong>{brand.name}</strong>
            <span>
              {target}+ target · {daysRemaining} days left
            </span>
          </span>
        </button>

        {GROUPS.map((group) => (
          <div key={group}>
            <div className="nav-group">{group}</div>
            {ROUTES.filter((r) => r.group === group).map((r) => (
              <button
                key={r.key}
                type="button"
                className="nav-link"
                aria-current={route === r.key ? 'page' : undefined}
                onClick={() => navigate(r.key)}
              >
                <span className="glyph">
                  <Icon name={r.icon as IconName} />
                </span>
                {r.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* Keyed by route so each page animates in rather than snapping. */}
      <main className="main page-enter" id="main" key={route}>
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
            <span className="glyph">
              <Icon name={r.icon as IconName} size={19} />
            </span>
            {r.label}
          </button>
        ))}
        <button type="button" aria-current={route === 'more' ? 'page' : undefined} onClick={() => navigate('more')}>
          <span className="glyph">
            <Icon name="more" size={19} />
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
      {GROUPS.filter((g) => ROUTES.some((r) => r.group === g && !r.primary)).map((group) => (
        <div className="card" key={group}>
          <div className="section-label">{group}</div>
          {ROUTES.filter((r) => r.group === group && !r.primary).map((r) => (
            <button key={r.key} type="button" className="nav-link" onClick={() => navigate(r.key)}>
              <span className="glyph">
                <Icon name={r.icon as IconName} />
              </span>
              {r.label}
            </button>
          ))}
        </div>
      ))}
    </>
  );
}
