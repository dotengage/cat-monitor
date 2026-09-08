import { useState } from 'react';
import { SECTION_LABELS, TASK_TYPE_LABELS } from '../../config/catConfig';
import { formatDate, formatMinutes } from '../../domain/date';
import type { MissedTaskDecision, Task } from '../../domain/types';
import { handleMissedTask } from '../../engine/missedTask';
import { useStore } from '../../state/store';
import { Callout, Modal, Tag } from './index';
import { TaskEditorModal } from './TaskEditor';

const DECISION_LABELS: Record<string, string> = {
  RESCHEDULE: 'Reschedule',
  SHORTEN: 'Shorten',
  COMBINE: 'Combine',
  POSTPONE: 'Postpone to backlog',
  DELEGATE: 'Delegate or drop',
  REPLACE: 'Replace with a smaller task',
  REMOVE: 'Remove',
  KEEP: 'Keep as planned',
};

export function TaskCard({ task, compact = false }: { task: Task; compact?: boolean }) {
  const { dispatch, today, state } = useStore();
  const [logging, setLogging] = useState(false);
  const [actual, setActual] = useState(String(task.estimateMin));
  const [decision, setDecision] = useState<MissedTaskDecision | null>(null);
  const [editing, setEditing] = useState(false);

  const done = task.status === 'done' || task.status === 'partial';
  const missed = task.status === 'missed';

  const complete = () => {
    dispatch({ type: 'task/complete', id: task.id, actualMin: Number(actual) || task.estimateMin });
    setLogging(false);
  };

  const openDecision = () => setDecision(handleMissedTask(task, state, today));

  return (
    <article className={`task${done ? ' done' : ''}${missed ? ' missed' : ''}`}>
      <div className="task-title">{task.title}</div>
      {!compact && task.detail && <div className="task-detail">{task.detail}</div>}

      <div className="task-meta">
        <span className="chip">{formatMinutes(task.actualMin ?? task.estimateMin)}</span>
        <span className="chip">{TASK_TYPE_LABELS[task.type]}</span>
        {task.section && <span className="chip">{SECTION_LABELS[task.section]}</span>}
        <span className="chip">
          {task.importance === 'critical' ? 'Critical' : task.importance === 'important' ? 'Important' : 'Optional'}
        </span>
        <span className="chip">Energy {task.energyRequired}/5</span>
        {task.deadline && <span className="chip">Due {formatDate(task.deadline)}</span>}
        {task.dependsOn.length > 0 && <span className="chip">Depends on {task.dependsOn.length} task(s)</span>}
        {task.postponeCount > 0 && <span className="chip">Postponed {task.postponeCount}x</span>}
        {task.locked && <span className="chip">Protected</span>}
        {task.date === null && <span className="chip">Backlog</span>}
      </div>

      {logging ? (
        <div className="row" style={{ marginTop: 9 }}>
          <label className="tiny muted" htmlFor={`actual-${task.id}`}>
            Actual minutes
          </label>
          <input
            id={`actual-${task.id}`}
            type="number"
            min={0}
            value={actual}
            onChange={(e) => setActual(e.target.value)}
            style={{ width: 92 }}
          />
          <button type="button" className="btn small primary" onClick={complete}>
            Save
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => {
              dispatch({ type: 'task/partial', id: task.id, actualMin: Number(actual) || undefined });
              setLogging(false);
            }}
          >
            Save as partial
          </button>
          <button type="button" className="btn small subtle" onClick={() => setLogging(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="task-actions">
          {!done && (
            <>
              <button type="button" className="btn small primary" onClick={() => setLogging(true)}>
                ✓ Complete
              </button>
              <button type="button" className="btn small" onClick={() => dispatch({ type: 'task/miss', id: task.id })}>
                ✕ Missed
              </button>
              <button type="button" className="btn small" onClick={() => dispatch({ type: 'task/postpone', id: task.id })}>
                ⏸ Postpone
              </button>
            </>
          )}
          {missed && (
            <button type="button" className="btn small primary" onClick={openDecision}>
              Decide what happens
            </button>
          )}
          <button type="button" className="btn small" onClick={() => setEditing(true)}>
            ✎ Edit
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => dispatch({ type: 'task/update', id: task.id, patch: { locked: !task.locked } })}
          >
            {task.locked ? 'Unprotect' : 'Protect'}
          </button>
          <button
            type="button"
            className="btn small danger"
            onClick={() => dispatch({ type: 'task/remove', id: task.id, reason: 'Removed by user.' })}
          >
            🗑 Remove
          </button>
        </div>
      )}

      {editing && <TaskEditorModal task={task} onClose={() => setEditing(false)} />}

      {decision && (
        <Modal title="Missed task decision" onClose={() => setDecision(null)}>
          <p className="small muted">
            Missed: <strong>{task.title}</strong> ({formatMinutes(task.estimateMin)})
          </p>
          <Callout tone={decision.verdict === 'over capacity' ? 'risk' : decision.verdict === 'tight' ? 'warn' : 'ok'}>
            <div>
              <strong>Decision: {DECISION_LABELS[decision.kind] ?? decision.kind}</strong>
            </div>
            <div style={{ marginTop: 6 }}>{decision.reason}</div>
            {decision.replacementTitle && (
              <div style={{ marginTop: 6 }}>
                Replacement: <strong>{decision.replacementTitle}</strong>
                {decision.newEstimateMin ? ` (${formatMinutes(decision.newEstimateMin)})` : ''}
              </div>
            )}
            <div style={{ marginTop: 6 }}>Status: {decision.verdict}</div>
          </Callout>

          <p className="tiny muted" style={{ marginTop: 12 }}>
            You can always override. Nothing is carried forward automatically.
          </p>
          <div className="btn-group">
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                dispatch({ type: 'task/decision', id: task.id, decision, today });
                setDecision(null);
              }}
            >
              Apply this decision
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                dispatch({ type: 'task/update', id: task.id, patch: { status: 'planned', date: today, needsDecision: false } });
                setDecision(null);
              }}
            >
              Keep it, move to today
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                dispatch({ type: 'task/postpone', id: task.id });
                setDecision(null);
              }}
            >
              Send to backlog
            </button>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                dispatch({ type: 'task/remove', id: task.id, reason: 'User removed after a missed session.' });
                setDecision(null);
              }}
            >
              Remove it
            </button>
          </div>
        </Modal>
      )}
    </article>
  );
}

export function TaskStatusTag({ task }: { task: Task }) {
  if (task.status === 'done') return <Tag tone="ok">Done</Tag>;
  if (task.status === 'partial') return <Tag tone="warn">Partial</Tag>;
  if (task.status === 'missed') return <Tag tone="risk">Missed</Tag>;
  if (task.status === 'postponed') return <Tag tone="neutral">Backlog</Tag>;
  return <Tag tone="neutral">Planned</Tag>;
}
