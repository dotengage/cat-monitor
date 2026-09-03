import { useState } from 'react';
import { formatDate, formatHours } from '../domain/date';
import type { Goal, GoalPriority } from '../domain/types';
import { useStore } from '../state/store';
import { useEngine } from '../state/useEngine';
import { Callout, Card, Empty, Field, Modal, StatusPill, Tag } from '../ui/components';

const PRIORITY_HELP: Record<GoalPriority, string> = {
  P1: 'Critical - directly determines whether the main goal succeeds.',
  P2: 'Important - matters, but can be compressed.',
  P3: 'Flexible - reduced or postponed when capacity is short.',
};

export function Goals() {
  const { state, dispatch } = useStore();
  const { goals, monthly } = useEngine();
  const [editing, setEditing] = useState<Goal | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Goals</h1>
          <div className="sub">P1 work is protected first. P2 and P3 give way when capacity is short.</div>
        </div>
        <button type="button" className="btn small" onClick={() => setCreating(true)}>
          + Add goal
        </button>
      </div>

      <Card title={`${monthly.label} strategy`} subtitle={`${monthly.phase.toLowerCase()} phase · ${monthly.daysInMonthRemaining} days left in this period`}>
        <p className="small">
          <strong>Main objective.</strong> {monthly.objective}
        </p>
        <div className="section-label">Key outcomes</div>
        <ul className="bullets small">
          {monthly.keyOutcomes.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
        <div className="section-label">Projects</div>
        <ul className="bullets small">
          {monthly.projects.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="section-label">Target metrics</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Metric</th>
                <th className="num">Target</th>
                <th className="num">Actual</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {monthly.metrics.map((m) => (
                <tr key={m.label}>
                  <td>{m.label}</td>
                  <td className="num mono">{m.target}</td>
                  <td className="num mono">{m.actual}</td>
                  <td>{m.met ? <Tag tone="ok">Met</Tag> : <Tag tone="neutral">Open</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="section-label">Deadlines</div>
        <ul className="bullets small">
          {monthly.deadlines.map((d) => (
            <li key={d.label}>
              {d.label} — {formatDate(d.date, { withYear: true })}
            </li>
          ))}
        </ul>
        <div className="section-label">Before the next period</div>
        <ul className="bullets small">
          {monthly.completionRequirements.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Card>

      {goals.length === 0 ? (
        <Empty>No goals yet.</Empty>
      ) : (
        goals.map((g) => {
          const goal = state.goals.find((x) => x.id === g.goalId);
          if (!goal) return null;
          return (
            <Card
              key={g.goalId}
              title={
                <div className="card-title-row">
                  <h2>{g.title}</h2>
                  <Tag tone={g.priority === 'P1' ? 'accent' : 'neutral'}>{g.priority}</Tag>
                </div>
              }
              action={<StatusPill status={g.status} />}
            >
              {goal.description && <p className="small muted">{goal.description}</p>}
              <div className="table-wrap">
                <table>
                  <tbody>
                    <tr>
                      <td className="muted">Target</td>
                      <td className="num mono">
                        {goal.targetValue ?? '—'} {goal.metric}
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">Current position</td>
                      <td className="num mono">
                        {goal.currentValue ?? '—'} {goal.metric}
                      </td>
                    </tr>
                    <tr>
                      <td className="muted">Deadline</td>
                      <td className="num mono">{goal.deadline ? formatDate(goal.deadline, { withYear: true }) : '—'}</td>
                    </tr>
                    <tr>
                      <td className="muted">Required pace</td>
                      <td className="num mono">{g.requiredPace ?? '—'}</td>
                    </tr>
                    <tr>
                      <td className="muted">Actual pace</td>
                      <td className="num mono">{g.actualPace ?? '—'}</td>
                    </tr>
                    <tr>
                      <td className="muted">Remaining workload</td>
                      <td className="num mono">{formatHours(g.remainingWorkloadMin, 1)}</td>
                    </tr>
                    <tr>
                      <td className="muted">Open tasks</td>
                      <td className="num mono">{g.openTasks}</td>
                    </tr>
                    <tr>
                      <td className="muted">Dependencies</td>
                      <td className="num mono">{goal.dependsOn.length}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <Callout tone={g.status === 'BEHIND' ? 'risk' : g.status === 'AT_RISK' ? 'warn' : 'neutral'}>
                <div className="small">{g.reason}</div>
                <div className="small" style={{ marginTop: 6 }}>
                  <strong>Next action:</strong> {g.nextAction}
                </div>
              </Callout>
              <div className="btn-group" style={{ marginTop: 10 }}>
                <button type="button" className="btn small" onClick={() => setEditing(goal)}>
                  Edit
                </button>
                {!goal.isPrimary && (
                  <button
                    type="button"
                    className="btn small danger"
                    onClick={() => dispatch({ type: 'goal/delete', id: goal.id })}
                  >
                    Delete
                  </button>
                )}
              </div>
            </Card>
          );
        })
      )}

      {(editing || creating) && (
        <GoalModal
          goal={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

function GoalModal({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [title, setTitle] = useState(goal?.title ?? '');
  const [priority, setPriority] = useState<GoalPriority>(goal?.priority ?? 'P2');
  const [metric, setMetric] = useState(goal?.metric ?? '');
  const [targetValue, setTargetValue] = useState(String(goal?.targetValue ?? ''));
  const [currentValue, setCurrentValue] = useState(String(goal?.currentValue ?? ''));
  const [deadline, setDeadline] = useState(goal?.deadline ?? state.profile.examDate);
  const [description, setDescription] = useState(goal?.description ?? '');

  const save = () => {
    const patch = {
      title: title.trim(),
      priority,
      metric,
      targetValue: targetValue === '' ? undefined : Number(targetValue),
      currentValue: currentValue === '' ? undefined : Number(currentValue),
      deadline: deadline || undefined,
      description,
    };
    if (goal) dispatch({ type: 'goal/update', id: goal.id, patch });
    else
      dispatch({
        type: 'goal/add',
        goal: { ...patch, isPrimary: false, archived: false, dependsOn: [] },
      });
    onClose();
  };

  return (
    <Modal
      title={goal ? 'Edit goal' : 'Add goal'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn primary" disabled={!title.trim()} onClick={save}>
            Save
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <Field label="Goal" htmlFor="gtitle">
        <input id="gtitle" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Priority" htmlFor="gpri" hint={PRIORITY_HELP[priority]}>
        <select id="gpri" value={priority} onChange={(e) => setPriority(e.target.value as GoalPriority)} disabled={goal?.isPrimary}>
          <option value="P1">P1 — Critical</option>
          <option value="P2">P2 — Important</option>
          <option value="P3">P3 — Flexible</option>
        </select>
      </Field>
      <Field label="Metric" htmlFor="gmetric" hint="e.g. percentile, mocks analysed, chapters">
        <input id="gmetric" type="text" value={metric} onChange={(e) => setMetric(e.target.value)} />
      </Field>
      <div className="inline-fields-2">
        <Field label="Target value" htmlFor="gtarget">
          <input id="gtarget" type="number" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} />
        </Field>
        <Field label="Current value" htmlFor="gcurrent">
          <input id="gcurrent" type="number" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} />
        </Field>
      </div>
      <Field label="Deadline" htmlFor="gdeadline">
        <input id="gdeadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="gdesc">
        <textarea id="gdesc" value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
    </Modal>
  );
}
