import { SECTION_LABELS } from '../config/catConfig';
import { daysBetween, formatHours, formatLongDate } from '../domain/date';
import { weaknessIsMeaningful } from '../engine/derive';
import { calculateHabitStats } from '../engine/habits';
import { useStore } from '../state/store';
import { useEngine } from '../state/useEngine';
import { Callout, CapacityMeter, Card, Collapse, Empty, Stat, StatGrid, StatusPill } from '../ui/components';
import { TaskCard } from '../ui/components/TaskCard';
import type { RouteKey } from '../ui/layout/Shell';

export function Home({ navigate }: { navigate: (r: RouteKey) => void }) {
  const { state, today, weekStart } = useStore();
  const engine = useEngine();
  const { feasibility, workload, todayPlan, capacityWeek, insights, conflicts, monthly } = engine;

  const daysRemaining = Math.max(0, daysBetween(today, state.profile.examDate));
  const week = state.weeks.find((w) => w.startDate === weekStart);
  const weekTasks = state.tasks.filter((t) => t.weekStart === weekStart && t.status !== 'removed');
  // Only work still ahead of us, against capacity still ahead of us.
  const weekAllocated = weekTasks
    .filter((t) => t.status === 'planned' && (t.date ?? '') >= today)
    .reduce((a, t) => a + t.estimateMin, 0);
  const needsDecision = state.tasks.filter((t) => t.needsDecision && t.status === 'missed');

  const habits = calculateHabitStats(state, today);
  const focus = [...todayPlan.mustDo, ...todayPlan.shouldDo].slice(0, 3);
  const biggestRisk =
    conflicts.find((c) => c.severity === 'critical') ??
    conflicts.find((c) => c.severity === 'warn') ??
    null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>CAT 2026</h1>
          <div className="sub">
            {state.profile.targetPercentile}+ percentile target · {formatLongDate(state.profile.examDate)}
          </div>
        </div>
        <div className="right">
          <div className="mono" style={{ fontSize: '1.6rem', fontWeight: 650, lineHeight: 1 }}>
            {daysRemaining}
          </div>
          <div className="tiny muted">days remaining</div>
        </div>
      </div>

      {/* 1. Am I on track? */}
      <Card
        title="Current status"
        action={<StatusPill status={feasibility.status} />}
      >
        <p>
          <strong>{feasibility.headline}</strong>
        </p>
        <p className="small muted">{feasibility.reason}</p>
        <Collapse title="What this is based on">
          <div className="table-wrap">
            <table>
              <tbody>
                {feasibility.inputs.map((input) => (
                  <tr key={input.label}>
                    <td className="muted">{input.label}</td>
                    <td className="num mono">{input.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tiny faint" style={{ marginTop: 8 }}>
            No probability is shown here on purpose. There is no honest way to turn this evidence into a percentage.
          </p>
        </Collapse>
      </Card>

      {/* 2. What matters most today? */}
      <Card
        title="Today's focus"
        action={
          <button type="button" className="btn small" onClick={() => navigate('today')}>
            Open Today
          </button>
        }
      >
        {needsDecision.length > 0 && (
          <Callout tone="warn">
            {needsDecision.length} missed task{needsDecision.length === 1 ? '' : 's'} need a decision. Nothing has been
            carried forward automatically.{' '}
            <button type="button" className="btn small" onClick={() => navigate('today')}>
              Decide now
            </button>
          </Callout>
        )}
        {focus.length === 0 ? (
          <Empty>
            Nothing scheduled for today. Open Today to add your own task, or let the planner generate a week.
          </Empty>
        ) : (
          <div style={{ marginTop: needsDecision.length ? 10 : 0 }}>
            {focus.map((task) => (
              <TaskCard key={task.id} task={task} compact />
            ))}
          </div>
        )}
      </Card>

      {/* 3. How much can I realistically do? */}
      <Card title="Capacity" subtitle={`Week of ${weekStart}`}>
        <StatGrid>
          <Stat label="Planned" value={formatHours(weekAllocated, 1)} sub="still committed this week" />
          <Stat label="Available" value={formatHours(capacityWeek.remainingPlannedMin, 1)} sub="realistic capacity left" />
          <Stat label="Buffer" value={formatHours(capacityWeek.remainingBufferMin, 1)} sub="protected for real life" />
        </StatGrid>
        <div style={{ marginTop: 10 }}>
          <CapacityMeter
            allocatedMin={weekAllocated}
            plannedMin={capacityWeek.remainingPlannedMin}
            bufferMin={capacityWeek.remainingBufferMin}
          />
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>
          Required pace {formatHours(workload.requiredPerWeekMin, 1)}/week against{' '}
          {formatHours(workload.realisticPerWeekMin, 1)}/week of realistic capacity.
        </p>
      </Card>

      <Card
        title="Consistency"
        action={
          <button type="button" className="btn small" onClick={() => navigate('log')}>
            Open Log
          </button>
        }
      >
        <StatGrid>
          <Stat label="Current streak" value={habits.currentStreak} sub={habits.currentStreak === 1 ? 'day' : 'days'} />
          <Stat label="Best streak" value={habits.bestStreak} sub="days" />
          <Stat
            label="Today's habits"
            value={`${habits.today.done}/${habits.today.total}`}
            sub={`${Math.round(habits.today.score * 100)}%`}
          />
        </StatGrid>
      </Card>

      {/* 4. This week's outcomes */}
      <Card
        title="This week's outcomes"
        subtitle={week?.focusNote}
        action={
          <button type="button" className="btn small" onClick={() => navigate('week')}>
            Open Week
          </button>
        }
      >
        {!week || week.outcomes.length === 0 ? (
          <Empty>No week generated yet.</Empty>
        ) : (
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
        )}
      </Card>

      {/* 5. What is putting the target at risk? */}
      <Card title="Biggest risk">
        {feasibility.safety.breached ? (
          <Callout tone={feasibility.safety.severity === 'critical' ? 'risk' : 'warn'}>
            <div>{feasibility.safety.message}</div>
            <ul className="bullets tiny" style={{ marginTop: 8 }}>
              {feasibility.safety.suggestions.slice(0, 3).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </Callout>
        ) : biggestRisk ? (
          <Callout tone={biggestRisk.severity === 'critical' ? 'risk' : 'warn'}>
            <strong>{biggestRisk.title}</strong>
            <div className="small" style={{ marginTop: 4 }}>
              {biggestRisk.detail}
            </div>
            <div className="small" style={{ marginTop: 4 }}>
              {biggestRisk.suggestion}
            </div>
          </Callout>
        ) : engine.readiness.constraint && weaknessIsMeaningful(state, today) ? (
          <Callout>
            {SECTION_LABELS[engine.readiness.constraint]} is currently the weakest section and the most likely
            constraint on {state.profile.targetPercentile} percentile.
          </Callout>
        ) : state.mocks.length === 0 ? (
          <Callout tone="warn">
            The biggest risk right now is that nothing is measured. Until a baseline mock exists, every section looks
            identical to the system and no constraint can honestly be named.
          </Callout>
        ) : (
          <Callout tone="ok">No capacity or feasibility breach detected right now.</Callout>
        )}
      </Card>

      {/* 6. Next action */}
      <Card title="Next action">
        <p>{feasibility.nextAction}</p>
        {focus[0] && (
          <p className="small muted">
            Today, that means: <strong>{focus[0].title}</strong>
          </p>
        )}
      </Card>

      {insights.length > 0 && (
        <Card title="What the system has noticed">
          <ul className="list-reset stack">
            {insights.slice(0, 4).map((i) => (
              <li key={i.id} className="small">
                <span className="muted">{i.source}:</span> {i.text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Collapse title={`${monthly.label} strategy · ${monthly.phase.toLowerCase()} phase`}>
        <p className="small">{monthly.objective}</p>
        <div className="section-label">Key outcomes</div>
        <ul className="bullets small">
          {monthly.keyOutcomes.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
        <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={() => navigate('goals')}>
          Full monthly strategy
        </button>
      </Collapse>
    </>
  );
}
