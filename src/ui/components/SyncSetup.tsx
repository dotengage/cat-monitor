import { useState } from 'react';
import type { SpaceSummary } from '../../data/sync/gistClient';
import { formatDate } from '../../domain/date';
import { useStore } from '../../state/store';
import { Callout, Field, Modal } from './index';

/**
 * Two-step sync setup.
 *
 * The token proves who the GitHub account is; it does not say which dataset
 * you want. One account can hold several - your own, plus a friend's if you
 * ever shared a token - so the space is always chosen explicitly. Joining the
 * first one found is how two people's data ends up merged.
 */
export function SyncSetup({ onDone }: { onDone?: () => void }) {
  const { sync, discoverSpaces, connectToSpace, renameSpace, deleteSpace } = useStore();
  const [token, setToken] = useState('');
  const [spaces, setSpaces] = useState<SpaceSummary[] | null>(null);
  const [newName, setNewName] = useState('My CAT data');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<SpaceSummary | null>(null);
  const [deleting, setDeleting] = useState<SpaceSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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

  const refresh = async () => {
    try {
      setSpaces(await discoverSpaces(token));
    } catch {
      /* surfaced via sync.error */
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
                  <button type="button" className="btn small" disabled={busy || s.unreadable} onClick={() => setRenaming(s)}>
                    Rename
                  </button>
                  <button type="button" className="btn small danger" disabled={busy} onClick={() => setDeleting(s)}>
                    Delete
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
      {notice && <Callout tone="ok">{notice}</Callout>}
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

      {renaming && (
        <RenameSpaceModal
          space={renaming}
          onClose={() => setRenaming(null)}
          onRename={async (name) => {
            await renameSpace(renaming.gistId, name, token);
            setNotice(`Renamed to "${name}".`);
            setRenaming(null);
            await refresh();
          }}
        />
      )}

      {deleting && (
        <DeleteSpaceModal
          space={deleting}
          onClose={() => setDeleting(null)}
          onDelete={async () => {
            await deleteSpace(deleting.gistId, token);
            setNotice(`Deleted "${deleting.spaceName}".`);
            setDeleting(null);
            await refresh();
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Rename                                                              */
/* ------------------------------------------------------------------ */

export function RenameSpaceModal({
  space,
  onClose,
  onRename,
}: {
  space: { spaceName: string };
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(space.spaceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await onRename(name.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rename failed.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Rename space"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn primary" disabled={!name.trim() || busy} onClick={save}>
            {busy ? 'Renaming…' : 'Rename'}
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <Field
        label="Space name"
        htmlFor="renamespace"
        hint="Only a label. Renaming changes nothing about the data inside it."
      >
        <input id="renamespace" type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      {error && <Callout tone="risk">{error}</Callout>}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

export function DeleteSpaceModal({
  space,
  onClose,
  onDelete,
}: {
  space: SpaceSummary;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A space holding real work demands a deliberate act; an empty one created
  // by mistake a minute ago should not need ceremony.
  const holdsRealWork = space.mocks > 0 || space.tasks > 5 || space.errors > 0;
  const canDelete = !holdsRealWork || confirmText.trim() === space.spaceName.trim();

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Delete "${space.spaceName}"?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn danger" disabled={!canDelete || busy} onClick={remove}>
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <Callout tone="risk">
        This permanently deletes the shared copy on GitHub — gists have no undo. The data on <strong>this</strong>{' '}
        device is untouched, but any other device syncing to this space loses its link.
      </Callout>
      <div className="table-wrap" style={{ marginTop: 10 }}>
        <table>
          <tbody>
            <tr>
              <td className="muted">Contains</td>
              <td className="num mono">
                {space.tasks} tasks · {space.mocks} mocks · {space.errors} errors
              </td>
            </tr>
            <tr>
              <td className="muted">Devices</td>
              <td>{space.deviceNames.length > 0 ? space.deviceNames.join(', ') : 'none recorded'}</td>
            </tr>
            <tr>
              <td className="muted">Last updated</td>
              <td>{space.updatedAt ? new Date(space.updatedAt).toLocaleString() : 'never'}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {holdsRealWork ? (
        <Field label={`This space holds real work. Type "${space.spaceName}" to confirm.`} htmlFor="confirmdelete">
          <input
            id="confirmdelete"
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoComplete="off"
          />
        </Field>
      ) : (
        <p className="small muted" style={{ marginTop: 10 }}>
          This space is effectively empty, so no confirmation phrase is needed.
        </p>
      )}
      {error && <Callout tone="risk">{error}</Callout>}
      <p className="tiny faint">Export a JSON backup first if you are unsure — Settings → Data → Export.</p>
    </Modal>
  );
}
