import { useState } from 'react';
import { SECTION_LABELS, TASK_TYPE_LABELS } from '../config/catConfig';
import { addDays, formatDate, formatHours, formatMinutes, shortDayName, weekDates } from '../domain/date';
import type { ISODate } from '../domain/types';
import { calculateWeekCapacity } from '../engine/capacity';
import { detectConflicts } from '../engine/conflicts';
import { useStore } from '../state/store';
import { useEngine } from '../state/useEngine';
import { Callout, CapacityMeter, Card, Collapse, Empty, SectionLabel, Stat, StatGrid } from '../ui/components';
import { AddTaskModal } from '../ui/components/AddTaskModal';
import { TaskCard } from '../ui/components/TaskCard';

export function Week() {
  const { state, dispatch, today, weekStart: currentWeekStart } = useStore();
  const engine = useEngine();
  const [offset, setOffset] = useState(0);
  const [addingFor, setAddingFor] = useState<ISODate | null | undefined>(undefined);

  const weekStart = addDays(currentWeekStart, offset * 7);
  const isCurrent = offset === 0;
  const capacity = isCurrent ? engine.capacityWeek : calculateWeekCapacity(state, weekStart, today);
  const conflicts = isCurrent ? engine.conflicts : detectConflicts(state, weekStart, today);
  const week = state.weeks.find((w) => w.startDate === weekStart);
  const days = weekDates(weekStart);

  const weekTasks = state.tasks.filter(
    (t) => t.date !== null && t.date >= weekStart && t.date <= addDays(weekStart, 6) && t.status !== 'removed',
  );
  // For the current week, compare against the capacity that is still
  // reachable: days that have already passed cannot absorb anything.
  const usableCapacityMin = offset < 0 ? capacity.plannedMin : capacity.remainingPlannedMin;
  const usableBufferMin = offset < 0 ? capacity.bufferMin : capacity.remainingBufferMin;
  const allocated = weekTasks
    .filter((t) => t.status !== 'done' && (offset < 0 || (t.date as string) >= today))
    .reduce((a, t) => a + t.estimateMin, 0);
  const backlog = state.tasks.filter((t) => t.date === null && (t.status === 'postponed' || t.status === 'planned'));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Week</h1>
          <div className="sub">
            {formatDate(weekStart, { withYear: true })} – {formatDate(addDays(weekStart, 6), { withYear: true })}
          </div>
        </div>
        <div className="btn-group">
          <button type="button" className="btn small" onClick={() => setOffset(offset - 1)}>
            ← Previous
          </button>
          <button type="button" className="btn small" onClick={() => setOffset(0)} disabled={offset === 0}>
            This week
          </button>
          <button type="button" className="btn small" onClick={() => setOffset(offset + 1)}>
            Next →
          </button>
        </div>
      </div>

      <Card
        title="Capacity"
        subtitle={week?.focusNote}
        action={
          <div className="btn-group">
            <button type="button" className="btn small" onClick={() => dispatch({ type: 'week/rebalance', weekStart, today })}>
              Rebalance
            </button>
            <button
              type="button"
              className="btn small primary"
              onClick={() => dispatch({ type: 'week/generate', weekStart, today })}
            >
              {week ? 'Regenerate' : 'Generate week'}
            </button>
          </div>
        }
      >
        <StatGrid>
          <Stat label="Planned" value={formatHours(allocated, 1)} sub={`${weekTasks.length} tasks this week`} />
          <Stat label="Capacity" value={formatHours(usableCapacityMin, 1)} sub={offset === 0 ? 'remaining this week' : 'after buffer'} />
          <Stat label="Buffer" value={formatHours(usableBufferMin, 1)} sub="protected" />
          <Stat
            label="Load"
            value={`${usableCapacityMin > 0 ? Math.round((allocated / usableCapacityMin) * 100) : 0}%`}
            sub={allocated > usableCapacityMin ? 'over capacity' : 'within capacity'}
          />
        </StatGrid>
        <div style={{ marginTop: 10 }}>
          <CapacityMeter allocatedMin={allocated} plannedMin={usableCapacityMin} bufferMin={usableBufferMin} />
        </div>
      </Card>

      {conflicts.length > 0 && (
        <Card title={`Conflicts (${conflicts.length})`}>
          <div className="stack">
            {conflicts.map((c) => (
              <Callout key={c.id} tone={c.severity === 'critical' ? 'risk' : c.severity === 'warn' ? 'warn' : 'neutral'}>
                <strong>{c.title}</strong>
                <div className="small" style={{ marginTop: 4 }}>
                  {c.detail}
                </div>
                <div className="small" style={{ marginTop: 4 }}>
                  Suggested decision: {c.suggestion}
                </div>
                {c.action?.kind === 'rebalance' && (
                  <button
                    type="button"
                    className="btn small"
                    style={{ marginTop: 8 }}
                    onClick={() => dispatch({ type: 'week/rebalance', weekStart, today })}
                  >
                    {c.action.label}
                  </button>
                )}
              </Callout>
            ))}
          </div>
        </Card>
      )}

      {week && week.outcomes.length > 0 && (
        <Card title="Weekly outcomes" subtitle="3-5 outcomes, not 25 goals">
          <ol className="bullets">
            {week.outcomes.map((o) => {
              const linked = weekTasks.filter((t) => t.outcomeId === o.id);
              const done = linked.filter((t) => t.status === 'done').length;
              return (
                <li key={o.id}>
                  <strong>{o.title}</strong>
                  <div className="tiny muted">
                    {o.metric}
                    {linked.length > 0 ? ` · ${done}/${linked.length} tasks complete` : ''}
                  </div>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <div className="week-grid" style={{ marginBottom: 12 }}>
        {days.map((date) => {
          const cap = capacity.days.find((d) => d.date === date);
          const dayTasks = weekTasks.filter((t) => t.date === date);
          const load = dayTasks.filter((t) => t.status !== 'done').reduce((a, t) => a + t.estimateMin, 0);
          const over = cap ? load > cap.plannedMin : false;
          return (
            <div key={date} className={`week-day${date === today ? ' today' : ''}${over ? ' over' : ''}`}>
              <header>
                <span className="dayname">
                  {shortDayName(date)} {formatDate(date)}
                </span>
                <span className="daycap">
                  {formatMinutes(load)}/{formatMinutes(cap?.plannedMin ?? 0)}
                </span>
              </header>
              <div className="tiny muted" style={{ marginBottom: 5 }}>
                Energy {cap?.energy ?? 3}/5
                {cap && cap.commitments.length > 0 ? ` · ${cap.commitments.map((c) => c.title).join(', ')}` : ''}
              </div>
              {dayTasks.length === 0 ? (
                <div className="tiny faint">No tasks</div>
              ) : (
                dayTasks.map((t) => (
                  <div
                    key={t.id}
                    className={`week-task${t.importance === 'critical' ? ' critical' : ''}${
                      t.status === 'done' ? ' done' : ''
                    }${t.status === 'missed' ? ' missed' : ''}`}
                    title={t.detail}
                  >
                    {t.title}
                    <div className="faint" style={{ fontSize: '0.68rem' }}>
                      {formatMinutes(t.estimateMin)} · {TASK_TYPE_LABELS[t.type]}
                      {t.section ? ` · ${SECTION_LABELS[t.section]}` : ''}
                    </div>
                  </div>
                ))
              )}
              <button
                type="button"
                className="day-add"
                onClick={() => setAddingFor(date)}
                aria-label={`Add a task on ${date}`}
              >
                + Add
              </button>
            </div>
          );
        })}
      </div>

      <Card
        title="All tasks this week"
        action={
          <button type="button" className="btn small primary" onClick={() => setAddingFor(today >= weekStart && today <= addDays(weekStart, 6) ? today : weekStart)}>
            + Add task
          </button>
        }
      >
        {weekTasks.length === 0 ? (
          <Empty>No tasks in this week yet.</Empty>
        ) : (
          days.map((date) => {
            const dayTasks = weekTasks.filter((t) => t.date === date);
            if (dayTasks.length === 0) return null;
            return (
              <div key={date}>
                <SectionLabel>
                  {shortDayName(date)} {formatDate(date)}
                </SectionLabel>
                {dayTasks.map((t) => (
                  <TaskCard key={t.id} task={t} />
                ))}
              </div>
            );
          })
        )}
      </Card>

      <Collapse title={`Backlog (${backlog.length})`}>
        <p className="small muted">
          Work that was identified but not committed to a day. Nothing here is carried forward automatically - it is
          promoted only when capacity genuinely exists.
        </p>
        {backlog.length === 0 ? <Empty>Backlog is empty.</Empty> : backlog.map((t) => <TaskCard key={t.id} task={t} />)}
      </Collapse>

      {addingFor !== undefined && (
        <AddTaskModal defaultDate={addingFor} onClose={() => setAddingFor(undefined)} />
      )}
    </>
  );
}
