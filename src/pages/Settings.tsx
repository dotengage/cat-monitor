import { useEffect, useRef, useState } from 'react';
import { COMMITMENT_TYPE_LABELS, DAY_LABELS, ENERGY_LABELS, TIME_WINDOWS } from '../config/catConfig';
import { formatDate } from '../domain/date';
import type { EnergyLevel, TimeWindow } from '../domain/types';
import { getStorageStatus, type StorageStatus } from '../data/db';
import { repository, type BackupMeta } from '../data/repository';
import { useStore } from '../state/store';
import { Callout, Card, ChoiceGroup, Collapse, Empty, Field, Modal } from '../ui/components';
import { SyncSetup } from '../ui/components/SyncSetup';

export function Settings() {
  const { state, dispatch, exportData, importData, resetData, sync, disconnect, syncNow } = useStore();
  const { profile, settings } = state;
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [backups, setBackups] = useState<BackupMeta[]>([]);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    repository.listBackups().then(setBackups).catch(() => setBackups([]));
    getStorageStatus().then(setStorage).catch(() => setStorage(null));
  }, []);

  const download = async () => {
    const json = await exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cat-monitor-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('Backup downloaded.');
  };

  const upload = async (file: File) => {
    try {
      await importData(await file.text());
      setMessage('Data imported. A snapshot of your previous data was saved first.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Import failed.');
    }
  };

  return (
    <>
      <div className="page-header">
        <h1>Settings</h1>
      </div>

      {message && <Callout tone="ok">{message}</Callout>}

      <Card title="Target and exam">
        <div className="inline-fields-2">
          <Field label="Target percentile" htmlFor="starget">
            <input
              id="starget"
              type="number"
              min={50}
              max={100}
              value={profile.targetPercentile}
              onChange={(e) => dispatch({ type: 'profile/update', patch: { targetPercentile: Number(e.target.value) } })}
            />
          </Field>
          <Field label="Exam date" htmlFor="sexam">
            <input
              id="sexam"
              type="date"
              value={profile.examDate}
              onChange={(e) => dispatch({ type: 'profile/update', patch: { examDate: e.target.value } })}
            />
          </Field>
        </div>
        <Field label="Preparation mode" htmlFor="smode">
          <input
            id="smode"
            type="text"
            value={profile.prepMode}
            onChange={(e) => dispatch({ type: 'profile/update', patch: { prepMode: e.target.value } })}
          />
        </Field>
      </Card>

      <Card title="Weekly availability">
        {(['weekdayHours', 'weekendHours'] as const).map((key) => (
          <fieldset key={key} className="field">
            <legend>{key === 'weekdayHours' ? 'Weekdays (hours per day)' : 'Weekends (hours per day)'}</legend>
            <div className="inline-fields">
              {(['min', 'normal', 'max'] as const).map((band) => (
                <label key={band} className="tiny muted">
                  {band}
                  <input
                    type="number"
                    min={0}
                    max={18}
                    step={0.5}
                    value={profile[key][band]}
                    onChange={(e) =>
                      dispatch({
                        type: 'profile/update',
                        patch: { [key]: { ...profile[key], [band]: Number(e.target.value) } },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <ChoiceGroup
          legend="Buffer percentage"
          value={String(Math.round(settings.planning.bufferPct * 100))}
          options={[
            { value: '20', label: '20%' },
            { value: '25', label: '25%' },
            { value: '30', label: '30%' },
          ]}
          onChange={(v) =>
            dispatch({
              type: 'settings/update',
              patch: { planning: { ...settings.planning, bufferPct: Number(v) / 100 } },
            })
          }
        />
        <p className="tiny faint">
          Buffer is never allocated to tasks. It absorbs travel, low-energy days, overruns and the things you cannot
          predict.
        </p>
      </Card>

      <Card title="Energy profile">
        <div className="stack">
          {DAY_LABELS.map((label, day) => (
            <div key={day} className="row-between">
              <span className="small" style={{ minWidth: 92 }}>
                {label}
              </span>
              <div className="choice-row">
                {([1, 2, 3, 4, 5] as EnergyLevel[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className="choice"
                    aria-pressed={profile.energyByDay[day] === level}
                    aria-label={`${label}: ${ENERGY_LABELS[level]}`}
                    onClick={() =>
                      dispatch({ type: 'profile/update', patch: { energyByDay: { ...profile.energyByDay, [day]: level } } })
                    }
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <ChoiceGroup
          legend="Best study window"
          value={profile.bestWindow}
          options={TIME_WINDOWS.map((w) => ({ value: w.key as TimeWindow, label: w.label }))}
          onChange={(bestWindow) => dispatch({ type: 'profile/update', patch: { bestWindow } })}
        />
      </Card>

      <Card title="Planning parameters">
        <div className="inline-fields-2">
          <Field label="Max tasks per day" htmlFor="pmax">
            <input
              id="pmax"
              type="number"
              min={1}
              max={8}
              value={settings.planning.maxTasksPerDay}
              onChange={(e) =>
                dispatch({
                  type: 'settings/update',
                  patch: { planning: { ...settings.planning, maxTasksPerDay: Number(e.target.value) } },
                })
              }
            />
          </Field>
          <Field label="Full mock duration (min)" htmlFor="pmock">
            <input
              id="pmock"
              type="number"
              min={60}
              step={5}
              value={settings.planning.fullMockMin}
              onChange={(e) =>
                dispatch({
                  type: 'settings/update',
                  patch: { planning: { ...settings.planning, fullMockMin: Number(e.target.value) } },
                })
              }
            />
          </Field>
        </div>
        <div className="inline-fields-2">
          <Field label="Mock analysis budget (min)" htmlFor="panalysis">
            <input
              id="panalysis"
              type="number"
              min={20}
              step={5}
              value={settings.planning.mockAnalysisMin}
              onChange={(e) =>
                dispatch({
                  type: 'settings/update',
                  patch: { planning: { ...settings.planning, mockAnalysisMin: Number(e.target.value) } },
                })
              }
            />
          </Field>
          <Field label="Estimate learning rate" htmlFor="palpha" hint="Higher reacts faster; lower is more stable.">
            <input
              id="palpha"
              type="number"
              min={0.05}
              max={0.6}
              step={0.05}
              value={settings.planning.estimationAlpha}
              onChange={(e) =>
                dispatch({
                  type: 'settings/update',
                  patch: { planning: { ...settings.planning, estimationAlpha: Number(e.target.value) } },
                })
              }
            />
          </Field>
        </div>
        <ChoiceGroup
          legend="Week starts on"
          value={String(settings.weekStartsOn)}
          options={[
            { value: '1', label: 'Monday' },
            { value: '0', label: 'Sunday' },
          ]}
          onChange={(v) => dispatch({ type: 'settings/update', patch: { weekStartsOn: Number(v) as 0 | 1 } })}
        />
      </Card>

      <Card title="Appearance and reminders">
        <ChoiceGroup
          legend="Theme"
          value={settings.theme}
          options={[
            { value: 'system' as const, label: 'System' },
            { value: 'light' as const, label: 'Light' },
            { value: 'dark' as const, label: 'Dark' },
          ]}
          onChange={(theme) => dispatch({ type: 'settings/update', patch: { theme } })}
        />
        <label className="row small" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={settings.notifications.weeklyReviewReminder}
            onChange={(e) =>
              dispatch({
                type: 'settings/update',
                patch: { notifications: { ...settings.notifications, weeklyReviewReminder: e.target.checked } },
              })
            }
          />
          Show the weekly review prompt at the end of the week
        </label>
        <label className="row small">
          <input
            type="checkbox"
            checked={settings.notifications.dailyCheckIn}
            onChange={(e) =>
              dispatch({
                type: 'settings/update',
                patch: { notifications: { ...settings.notifications, dailyCheckIn: e.target.checked } },
              })
            }
          />
          Show the end-of-day check-in prompt
        </label>
      </Card>

      <Card title="Commitments">
        {state.commitments.length === 0 ? (
          <Empty>No commitments recorded.</Empty>
        ) : (
          <ul className="list-reset stack">
            {state.commitments.map((c) => (
              <li key={c.id} className="row-between small">
                <span>
                  <strong>{c.title}</strong> · {COMMITMENT_TYPE_LABELS[c.type]} ·{' '}
                  {c.recurrence === 'weekly'
                    ? `weekly on ${c.daysOfWeek.map((d) => DAY_LABELS[d].slice(0, 3)).join(', ')}`
                    : `${formatDate(c.startDate)} – ${formatDate(c.endDate)}`}{' '}
                  · {c.hoursPerDay}h/day
                  {c.reducesCapacity ? '' : ' · already counted in study hours'}
                </span>
                <button type="button" className="btn small danger" onClick={() => dispatch({ type: 'commitment/delete', id: c.id })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <SyncCard sync={sync} disconnect={disconnect} syncNow={syncNow} />

      <Card title="Data">
        <p className="small muted">
          Everything is stored locally on this device (IndexedDB, mirrored to local storage). No account, no server.
          Data does not sync between devices - use export/import to move it. Clearing browser data deletes it.
        </p>
        {storage && (
          <Callout tone={storage.persistent ? 'ok' : 'warn'}>
            <div className="small">
              <strong>
                {storage.persistent
                  ? 'Storage is durable on this device.'
                  : 'Storage is best-effort on this device.'}
              </strong>{' '}
              {storage.persistent
                ? 'The browser has agreed not to evict this data automatically.'
                : 'The browser may evict this data under disk pressure. Installing the app to your home screen usually upgrades it to durable.'}
            </div>
            {storage.usageBytes > 0 && (
              <div className="tiny muted" style={{ marginTop: 4 }}>
                Using {(storage.usageBytes / 1024).toFixed(0)} KB
                {storage.quotaBytes > 0 ? ` of roughly ${(storage.quotaBytes / 1024 / 1024).toFixed(0)} MB available` : ''}.
              </div>
            )}
          </Callout>
        )}
        <div className="btn-group">
          <button type="button" className="btn" onClick={download}>
            Export data (JSON)
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Import backup
          </button>
          <button type="button" className="btn danger" onClick={() => setConfirmReset(true)}>
            Reset everything
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
        <label className="row small" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={settings.autoBackup}
            onChange={(e) => dispatch({ type: 'settings/update', patch: { autoBackup: e.target.checked } })}
          />
          Keep automatic daily snapshots on this device
        </label>

        <Collapse title={`Local snapshots (${backups.length})`}>
          {backups.length === 0 ? (
            <Empty>No snapshots yet.</Empty>
          ) : (
            <ul className="list-reset stack">
              {backups.map((b) => (
                <li key={b.id} className="row-between small">
                  <span>
                    {b.label} · {new Date(b.createdAt).toLocaleString()} · {(b.sizeBytes / 1024).toFixed(0)} KB
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    onClick={async () => {
                      const restored = await repository.restoreBackup(b.id);
                      if (restored) window.location.reload();
                    }}
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Collapse>
      </Card>

      <Card title="Re-run onboarding">
        <p className="small muted">
          Reopens the setup flow. Your data is kept; only the profile answers are collected again.
        </p>
        <button type="button" className="btn" onClick={() => dispatch({ type: 'profile/update', patch: { onboarded: false } })}>
          Re-run onboarding
        </button>
      </Card>

      {confirmReset && (
        <Modal
          title="Reset all data?"
          onClose={() => setConfirmReset(false)}
          footer={
            <>
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  await resetData();
                  setConfirmReset(false);
                  setMessage('All data reset. A snapshot was saved first and can be restored from Local snapshots.');
                }}
              >
                Yes, reset everything
              </button>
              <button type="button" className="btn subtle" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
            </>
          }
        >
          <Callout tone="risk">
            This deletes every mock, error, task, review and log on this device. A snapshot is saved first so it can be
            restored, but exporting a JSON backup is safer.
          </Callout>
        </Modal>
      )}
    </>
  );
}

function SyncCard({
  sync,
  disconnect,
  syncNow,
}: Pick<ReturnType<typeof useStore>, 'sync' | 'disconnect' | 'syncNow'>) {
  const connected = sync.connected;

  return (
    <Card
      title="Sync across devices"
      action={
        connected ? (
          <span className={`status-pill ${sync.phase === 'error' ? 'status-risk' : 'status-ok'}`}>
            <span className="dot" aria-hidden="true" />
            {sync.phase === 'syncing' ? 'Syncing' : sync.phase === 'error' ? 'Problem' : 'Connected'}
          </span>
        ) : (
          <span className="status-pill status-neutral">
            <span className="dot" aria-hidden="true" />
            Off
          </span>
        )
      }
    >
      {!connected ? (
        <>
          <p className="small muted">
            Keeps your own devices in step using one secret file in your own GitHub account. No new account, no server.
          </p>
          <SyncSetup />
        </>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <td className="muted">Status</td>
                  <td>
                    {sync.phase === 'syncing'
                      ? 'Syncing now…'
                      : sync.phase === 'error'
                        ? 'Last attempt failed'
                        : sync.lastSyncedAt
                          ? `Synced ${new Date(sync.lastSyncedAt).toLocaleString()}`
                          : 'Waiting for first sync'}
                  </td>
                </tr>
                <tr>
                  <td className="muted">Space</td>
                  <td>{sync.spaceName ?? 'Unnamed space'}</td>
                </tr>
                <tr>
                  <td className="muted">Devices</td>
                  <td>{sync.devices.length > 0 ? `${sync.devices.length} connected` : 'This device'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {sync.devices.length > 0 && (
            <ul className="list-reset stack" style={{ marginTop: 10 }}>
              {sync.devices.map((d) => (
                <li key={d.id} className="row-between small">
                  <span>
                    {d.name}
                    {d.isThisDevice ? ' — this device' : ''}
                  </span>
                  <span className="tiny muted">last seen {new Date(d.lastSeen).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}

          {sync.message && sync.phase !== 'error' && <Callout tone="ok">{sync.message}</Callout>}
          {sync.error && <Callout tone="risk">{sync.error}</Callout>}

          <div className="btn-group" style={{ marginTop: 10 }}>
            <button type="button" className="btn" disabled={sync.phase === 'syncing'} onClick={() => void syncNow()}>
              {sync.phase === 'syncing' ? 'Syncing…' : 'Sync now'}
            </button>
            <button type="button" className="btn danger" onClick={disconnect}>
              Disconnect this device
            </button>
          </div>
          <p className="tiny faint" style={{ marginTop: 8 }}>
            Syncs automatically a few seconds after a change, when you reopen the app, and every five minutes. Records
            edited on two devices resolve to the newer edit. Sharing the app with someone else? They need their own
            GitHub account — never your token. Disconnecting removes the token from this device only.
          </p>
        </>
      )}
    </Card>
  );
}
