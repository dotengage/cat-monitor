import { useStore } from '../../state/store';

/**
 * Shown on every page while the sample data is loaded, so it is never
 * mistaken for anyone's real preparation, and leaving it is one click.
 */
export function SampleBanner() {
  const { resetData } = useStore();
  return (
    <div className="sample-banner" role="status">
      <span>
        <strong>You are looking at sample data.</strong>{' '}
        <span className="muted">Try anything; it stays on this device and is never synced.</span>
      </span>
      <button
        type="button"
        className="btn small primary"
        onClick={() => {
          if (window.confirm('Clear the sample data and set up your own plan?')) void resetData();
        }}
      >
        Start my own plan
      </button>
    </div>
  );
}
