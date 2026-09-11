import { useMemo, useState } from 'react';
import { SECTIONS, SECTION_LABELS } from '../config/catConfig';
import { addDays, formatDate, formatHours, shortDayName } from '../domain/date';
import type { ISODate, SectionKey } from '../domain/types';
import { calculateHabitStats, studyLogRows, studyTotals } from '../engine/habits';
import { useStore } from '../state/store';
import { HBarList } from '../ui/charts';
import { Callout, Card, Collapse, Empty, Field, Modal, Stat, StatGrid } from '../ui/components';

const RANGES = [
  { days: 14, label: '14 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

export function Log() {
  const { state, dispatch, today } = useStore();
  const [range, setRange] = useState(14);
  const [editing, setEditing] = useState<ISODate | null>(null);
  const [managingHabits, setManagingHabits] = useState(false);

  const stats = useMemo(() => calculateHabitStats(state, today), [state, today]);
  const rows = useMemo(() => studyLogRows(state, addDays(today, -(range - 1)), today), [state, today, range]);
  const totals = useMemo(() => studyTotals(rows), [rows]);

  const visibleDays = stats.days.slice(0, range);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Daily log</h1>
          <div className="sub">What you actually did each day — habits, hours and topics covered.</div>
        </div>
        <div className="choice-row">
          {RANGES.map((r) => (
            <button key={r.days} type="button" className="choice" aria-pressed={range === r.days} onClick={() => setRange(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* ---------------- Streaks ---------------- */}
      <Card
        title="Streaks"
        subtitle={`A day counts once you hit ${Math.round(stats.threshold * 100)}% of your habits.`}
        action={
          <button type="button" className="btn small" onClick={() => setManagingHabits(true)}>
            Edit habits
          </button>
        }
      >
        <StatGrid>
          <Stat
            label="Current streak"
            value={stats.currentStreak}
            sub={stats.currentStreak === 1 ? 'day' : 'days'}
          />
          <Stat label="Best streak" value={stats.bestStreak} sub="days in a row" />
          <Stat
            label="Today"
            value={`${Math.round(stats.today.score * 100)}%`}
            sub={`${stats.today.done} of ${stats.today.total} habits`}
          />
        </StatGrid>
        {stats.currentStreak === 0 && !stats.today.untouched && stats.today.total > 0 && (
          <Callout tone="warn">
            The streak reset. That is information, not a verdict — the counter exists to show consistency, which is the
            input the target depends on most.
          </Callout>
        )}
      </Card>

      {/* ---------------- Habit grid ---------------- */}
      <Card title="Habit tracker" subtitle="Tap a cell to mark it. Today's row is at the top.">
        {stats.activeHabits.length === 0 ? (
          <Empty>
            No habits yet. Add a few small daily inputs — they are what the streak measures.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="habit-table">
              <thead>
                <tr>
                  <th>Day</th>
                  {stats.activeHabits.map((h) => (
                    <th key={h.id} className="num">
                      {h.name}
                    </th>
                  ))}
                  <th className="num">Score</th>
                </tr>
              </thead>
              <tbody>
                {visibleDays.map((day) => (
                  <tr key={day.date} className={day.date === today ? 'is-today' : undefined}>
                    <td className="nowrap">
                      {shortDayName(day.date)} {formatDate(day.date)}
                    </td>
                    {stats.activeHabits.map((h) => {
                      const done = day.marks[h.id] === true;
                      return (
                        <td key={h.id} className="num">
                          <button
                            type="button"
                            className={`habit-cell${done ? ' done' : ''}`}
                            aria-pressed={done}
                            aria-label={`${h.name} on ${day.date}: ${done ? 'done' : 'not done'}`}
                            onClick={() =>
                              dispatch({ type: 'habit/toggle', date: day.date, habitId: h.id, done: !done })
                            }
                          >
                            {done ? '✓' : '·'}
                          </button>
                        </td>
                      );
                    })}
                    <td className={`num mono${day.hit ? ' hit' : ''}`}>
                      {day.untouched ? '—' : `${Math.round(day.score * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------------- Study log ---------------- */}
      <Card title="Study log" subtitle={`Topics covered and hours spent. Last ${range} days.`}>
        <StatGrid>
          <Stat label="Total logged" value={formatHours(totals.totalMin, 1)} sub={`over ${totals.daysLogged} days`} />
          <Stat label="Average per active day" value={formatHours(totals.averageMinPerLoggedDay, 1)} />
          {SECTIONS.map((s) => (
            <Stat key={s} label={SECTION_LABELS[s]} value={formatHours(totals.bySection[s], 1)} />
          ))}
        </StatGrid>

        {totals.totalMin > 0 && (
          <div style={{ marginTop: 12 }}>
            <HBarList
              items={SECTIONS.map((s) => ({
                label: SECTION_LABELS[s],
                value: Math.round(totals.bySection[s] / 6) / 10,
                caption: `${Math.round((totals.bySection[s] / Math.max(1, totals.totalMin)) * 100)}%`,
                tone: 'accent' as const,
              }))}
              suffix="h"
            />
          </div>
        )}

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                {SECTIONS.map((s) => (
                  <th key={s}>{SECTION_LABELS[s]}</th>
                ))}
                <th className="num">Total</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.date} className={row.date === today ? 'is-today' : undefined}>
                  <td className="nowrap">
                    {shortDayName(row.date)} {formatDate(row.date)}
                  </td>
                  {SECTIONS.map((s) => (
                    <td key={s} style={{ whiteSpace: 'normal', minWidth: 150 }}>
                      {row.sections[s].minutes > 0 || row.sections[s].topics ? (
                        <>
                          <span className="mono tiny">{formatHours(row.sections[s].minutes, 1)}</span>
                          {row.sections[s].topics && <div className="tiny muted">{row.sections[s].topics}</div>}
                        </>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                  ))}
                  <td className="num mono">{row.totalMin > 0 ? formatHours(row.totalMin, 1) : '—'}</td>
                  <td style={{ whiteSpace: 'normal', minWidth: 140 }} className="tiny muted">
                    {row.note}
                  </td>
                  <td>
                    <button type="button" className="btn small subtle" onClick={() => setEditing(row.date)}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny faint" style={{ marginTop: 8 }}>
          Hours logged here feed the planner's realism factor — the more honestly you log, the closer next week's plan
          gets to what you can actually do.
        </p>
      </Card>

      <Collapse title="Why habits and tasks are separate">
        <p className="small muted">
          Tasks are specific and change every week ("solve 12 ratio questions"). Habits are the same few things every
          day, and what they measure is consistency. Mixing them would let a heavy task day hide a week of skipped
          reading, which is exactly the thing that quietly costs percentile.
        </p>
      </Collapse>

      {editing && <StudyDayModal date={editing} onClose={() => setEditing(null)} />}
      {managingHabits && <HabitsModal onClose={() => setManagingHabits(false)} />}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Editing one day                                                     */
/* ------------------------------------------------------------------ */

export function StudyDayModal({ date, onClose }: { date: ISODate; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const log = state.dayLogs.find((d) => d.date === date);

  const [draft, setDraft] = useState<Record<SectionKey, { hours: string; topics: string }>>(() => {
    const initial = {} as Record<SectionKey, { hours: string; topics: string }>;
    for (const s of SECTIONS) {
      const entry = log?.study?.[s];
      initial[s] = {
        hours: entry?.minutes ? String(Math.round((entry.minutes / 6)) / 10) : '',
        topics: entry?.topics ?? '',
      };
    }
    return initial;
  });
  const [note, setNote] = useState(log?.note ?? '');

  const total = SECTIONS.reduce((acc, s) => acc + (Number(draft[s].hours) || 0), 0);

  const save = () => {
    for (const s of SECTIONS) {
      dispatch({
        type: 'day/study',
        date,
        section: s,
        minutes: Math.round((Number(draft[s].hours) || 0) * 60),
        topics: draft[s].topics.trim(),
      });
    }
    dispatch({ type: 'day/note', date, note: note.trim() });
    onClose();
  };

  return (
    <Modal
      title={`Study log — ${shortDayName(date)} ${formatDate(date, { withYear: true })}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn primary" onClick={save}>
            Save {total > 0 ? `(${total.toFixed(1)}h)` : ''}
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="small muted">Record what you actually covered and how long it took. Blank sections stay empty.</p>
      {SECTIONS.map((s) => (
        <fieldset key={s} className="field">
          <legend>{SECTION_LABELS[s]}</legend>
          <div className="inline-fields-2">
            <label className="tiny muted">
              Hours
              <input
                type="number"
                min={0}
                step={0.25}
                value={draft[s].hours}
                onChange={(e) => setDraft({ ...draft, [s]: { ...draft[s], hours: e.target.value } })}
                placeholder="0"
              />
            </label>
            <label className="tiny muted">
              Topics covered
              <input
                type="text"
                value={draft[s].topics}
                onChange={(e) => setDraft({ ...draft, [s]: { ...draft[s], topics: e.target.value } })}
                placeholder={s === 'QA' ? 'Ratios, averages' : s === 'DILR' ? '2 arrangement sets' : '2 RC passages'}
              />
            </label>
          </div>
        </fieldset>
      ))}
      <Field label="Notes for the day" htmlFor="daynote">
        <textarea id="daynote" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Callout tone={total > 0 ? 'ok' : 'neutral'}>
        Total: <strong>{total.toFixed(1)} hours</strong>. This becomes the day's focused time and feeds capacity
        planning.
      </Callout>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Managing which habits are tracked                                   */
/* ------------------------------------------------------------------ */

function HabitsModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [name, setName] = useState('');
  const threshold = state.settings.planning.habitStreakThreshold ?? 0.6;

  return (
    <Modal title="Habits" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Done</button>}>
      <p className="small muted">
        Keep the list short. Six things you can genuinely do most days beats twelve you cannot.
      </p>
      <ul className="list-reset stack">
        {[...state.habits]
          .sort((a, b) => a.order - b.order)
          .map((h) => (
            <li key={h.id} className="row-between">
              <input
                type="text"
                value={h.name}
                onChange={(e) => dispatch({ type: 'habit/update', id: h.id, patch: { name: e.target.value } })}
                style={{ flex: 1 }}
                aria-label={`Habit name: ${h.name}`}
              />
              <button
                type="button"
                className="btn small"
                onClick={() => dispatch({ type: 'habit/update', id: h.id, patch: { active: !h.active } })}
              >
                {h.active ? 'Pause' : 'Resume'}
              </button>
              <button type="button" className="btn small danger" onClick={() => dispatch({ type: 'habit/delete', id: h.id })}>
                Delete
              </button>
            </li>
          ))}
      </ul>

      <Field label="Add a habit" htmlFor="newhabit">
        <input
          id="newhabit"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. 2 RC passages"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && name.trim()) {
              dispatch({ type: 'habit/add', name: name.trim() });
              setName('');
            }
          }}
        />
      </Field>
      <button
        type="button"
        className="btn"
        disabled={!name.trim()}
        onClick={() => {
          dispatch({ type: 'habit/add', name: name.trim() });
          setName('');
        }}
      >
        Add habit
      </button>

      <Field
        label={`Streak threshold: ${Math.round(threshold * 100)}%`}
        htmlFor="threshold"
        hint="How much of the list must be ticked for the day to count. 100% makes streaks brittle; 60% rewards consistency."
      >
        <input
          id="threshold"
          type="range"
          min={20}
          max={100}
          step={10}
          value={Math.round(threshold * 100)}
          onChange={(e) =>
            dispatch({
              type: 'settings/update',
              patch: {
                planning: { ...state.settings.planning, habitStreakThreshold: Number(e.target.value) / 100 },
              },
            })
          }
        />
      </Field>
    </Modal>
  );
}
