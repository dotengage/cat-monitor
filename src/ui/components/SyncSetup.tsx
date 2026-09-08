import { useState } from 'react';
import type { SpaceSummary } from '../../data/sync/gistClient';
import { formatDate } from '../../domain/date';
import { useStore } from '../../state/store';
import { Callout, Field } from './index';

/**
 * Two-step sync setup.
 *
 * The token proves who the GitHub account is; it does not say which dataset
 * you want. One account can hold several - your own, plus a friend's if you
 * ever shared a token - so the space is always chosen explicitly. Joining the
 * first one found is how two people's data ends up merged.
 */
export function SyncSetup({ onDone }: { onDone?: () => void }) {
  const { sync, discoverSpaces, connectToSpace } = useStore();
  const [token, setToken] = useState('');
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null);
  const [newName, setNewName] = useState('My CAT data');
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      setSpaces(await discoverSpaces(token));
    } catch {
      setSpaces(null);
    } finally {
      setBusy(false);
    }
  };

  const join = async (target: Parameters<typeof connectToSpace>[1]) => {
    setBusy(true);
    try {
      await connectToSpace(token, target);
      onDone?.();
    } catch {
      /* surfaced via sync.error */
    } finally {
      setBusy(false);
    }
  };

  if (spaces === null) {
    return (
      <>
        <Field
          label="GitHub token"
          htmlFor="synctoken"
          hint="Needs only the Gist permission. Stored on this device, never in exports or in the synced file."
        >
          <input
            id="synctoken"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_..."
          />
        </Field>
        {sync.error && <Callout tone="risk">{sync.error}</Callout>}
        <button type="button" className="btn primary" disabled={!token.trim() || busy} onClick={check}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
        <p className="tiny faint" style={{ marginTop: 10 }}>
          Create one at github.com/settings/tokens → Generate new token (classic) → tick <strong>gist</strong> only.
          Never share this token: anyone holding it can read and write every gist in your account.
        </p>
      </>
    );
  }

  return (
    <>
      {spaces.length > 0 ? (
        <>
          <Callout tone="warn">
            This GitHub account already holds {spaces.length === 1 ? 'a CAT Monitor dataset' : `${spaces.length} CAT Monitor datasets`}.
            Join one only if it is <strong>yours</strong> — joining someone else's merges the two sets of data together.
          </Callout>
          <div className="section-label">Existing data in this account</div>
          <div className="stack">
            {spaces.map((s) => (
              <div key={s.gistId} className="task">
                <div className="task-title">{s.spaceName}</div>
                <div className="task-meta">
                  <span className="chip">{s.tasks} tasks</span>
                  <span className="chip">{s.mocks} mocks</span>
                  <span className="chip">{s.errors} errors</span>
                  {s.targetPercentile && <span className="chip">{s.targetPercentile} percentile target</span>}
                  {s.examDate && <span className="chip">exam {formatDate(s.examDate, { withYear: true })}</span>}
                </div>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  {s.deviceNames.length > 0 ? `Devices: ${s.deviceNames.join(', ')}. ` : ''}
                  {s.updatedAt ? `Last updated ${new Date(s.updatedAt).toLocaleString()}.` : 'Never synced.'}
                </div>
                <div className="task-actions">
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={busy || s.unreadable}
                    onClick={() => join({ kind: 'join', gistId: s.gistId, spaceName: s.spaceName })}
                  >
                    This is mine — join it
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <Callout tone="ok">No CAT Monitor data found in this account yet. A new, private space will be created.</Callout>
      )}

      <div className="section-label">{spaces.length > 0 ? 'Or start a completely separate space' : 'Name your space'}</div>
      <Field
        label="Space name"
        htmlFor="spacename"
        hint="Only a label, so you can tell datasets apart later. Separate spaces never share data."
      >
        <input id="spacename" type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
      </Field>
      {sync.error && <Callout tone="risk">{sync.error}</Callout>}
      <div className="btn-group">
        <button
          type="button"
          className={`btn ${spaces.length > 0 ? '' : 'primary'}`}
          disabled={!newName.trim() || busy}
          onClick={() => join({ kind: 'create', spaceName: newName.trim() })}
        >
          {busy ? 'Working…' : 'Create a separate space'}
        </button>
        <button type="button" className="btn subtle" onClick={() => setSpaces(null)} disabled={busy}>
          Back
        </button>
      </div>
    </>
  );
}
