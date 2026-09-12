import { Component, type ErrorInfo, type ReactNode } from 'react';
import { repository } from '../data/repository';

/**
 * The last line of defence.
 *
 * React unmounts the whole tree when a render throws, which leaves a blank
 * white page - the least useful failure mode there is, because it hides both
 * what went wrong and the fact that the data is still there. This catches the
 * throw, says so plainly, and puts the data within reach before anything else:
 * a crash must never be the reason someone loses a year of preparation.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('CAT Monitor crashed', error, info.componentStack);
  }

  private async download() {
    try {
      const json = await repository.export();
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `cat-monitor-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Could not export data after a crash', err);
    }
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="crash">
        <div className="card">
          <h1>Something broke while drawing this page</h1>
          <p>
            Your data has not been touched — it is still stored on this device. Save a copy first if you want to be
            certain, then reload.
          </p>
          <div className="btn-group">
            <button type="button" className="btn primary" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button type="button" className="btn" onClick={() => void this.download()}>
              Download a copy of my data
            </button>
          </div>
          <details className="collapse" style={{ marginTop: 16 }}>
            <summary>Technical detail</summary>
            <pre className="crash-detail">{error.message}</pre>
          </details>
        </div>
      </div>
    );
  }
}
