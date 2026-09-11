import { SECTION_LABELS } from '../config/catConfig';
import { daysBetween, formatHours, formatLongDate } from '../domain/date';
import { weaknessIsMeaningful } from '../engine/derive';
import { calculateHabitStats } from '../engine/habits';
import { useStore } from '../state/store';
import { useEngine } from '../state/useEngine';
import {
  Callout,
  CapacityMeter,
  Card,
  Collapse,
  Empty,
  Progress,
  Stat,
  StatGrid,
  StatusPill,
} from '../ui/components';
import { TaskCard } from '../ui/components/TaskCard';
import { Icon } from '../ui/layout/icons';
import type { RouteKey } from '../ui/layout/Shell';

/**
 * The dashboard.
 *
 * Laid out by importance rather than by chronology: the two questions that
 * decide everything else - am I on track, and what do I do now - take the
 * widest boxes at the top, the inputs that feed them sit beside and below,
 * and each box is a shortcut into the page that owns that subject.
 */
export function Home({ navigate }: { navigate: (r: RouteKey) => void }) {
  const { state, today, weekStart } = useStore();
  const engine = useEngine();
  const { feasibility, workload, todayPlan, capacityWeek, insights, conflicts, monthly, readiness } = engine;

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

  const trajectory = readiness.trajectory;
  const weekDone = weekTasks.filter((t) => t.status === 'done').length;
  const weekPlanned = weekTasks.filter((t) => t.status !== 'missed').length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>CAT 2026</h1>
          <div className="sub">
            {state.profile.targetPercentile}+ percentile target · {formatLongDate(state.profile.examDate)}
          </div>
        </div>
        <div className="header-actions">
          <div className="countdown">
            <div className="mono num">{daysRemaining}</div>
            <div className="tiny muted">days left</div>
          </div>
          <button type="button" className="btn small" onClick={() => navigate('today')}>
            <Icon name="today" size={15} /> Today
          </button>
          <button type="button" className="btn small" onClick={() => navigate('mocks')}>
            <Icon name="mocks" size={15} /> Mocks
          </button>
          <button type="button" className="btn small" onClick={() => navigate('log')}>
            <Icon name="log" size={15} /> Log
          </button>
        </div>
      </div>

      {needsDecision.length > 0 && (
        <button type="button" className="alert-banner" onClick={() => navigate('today')}>
          <span className="alert-icon" aria-hidden="true">
            <Icon name="errors" size={17} />
          </span>
          <span className="alert-body">
            <strong>
              {needsDecision.length} missed task{needsDecision.length === 1 ? '' : 's'} need a decision
            </strong>
            <span className="tiny muted">Nothing was carried forward automatically — decide each one.</span>
          </span>
          <span className="alert-chevron" aria-hidden="true">
            ›
          </span>
        </button>
      )}

      <div className="dash-grid">
        {/* 1. Am I on track, and what do I do about it? */}
        <Card span={2} title="Current status" action={<StatusPill status={feasibility.status} />}>
          <p className="lead">{feasibility.headline}</p>
          <p className="small muted">{feasibility.reason}</p>

          <div className="next-action">
            <div className="section-label">Next action</div>
            <p>{feasibility.nextAction}</p>
            {focus[0] && (
              <p className="small muted">
                Today, that means: <strong>{focus[0].title}</strong>
              </p>
            )}
          </div>

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

        {/* Where the measured evidence currently puts the target. */}
        <Card title="Target percentile" onOpen={() => navigate('cat')} openLabel="Readiness">
          {trajectory.current === undefined ? (
            <Empty>
              No mock scored yet, so there is nothing to plot against {state.profile.targetPercentile}. A baseline mock
              is the fastest way to make this page mean something.
            </Empty>
          ) : (
            <>
              <div className="goal-line">
                <div className="goal-value mono">{Math.round(trajectory.current)}</div>
                <StatusPill status={trajectory.status} />
              </div>
              <Progress
                value={trajectory.current}
                max={trajectory.target}
                tone={trajectory.status === 'BEHIND' ? 'risk' : trajectory.status === 'AT_RISK' ? 'warn' : 'ok'}
              />
              <div className="goal-foot tiny muted">
                <span>
                  {Math.round(trajectory.current)} / {trajectory.target} percentile
                </span>
                <span>{daysRemaining}d left</span>
              </div>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                {trajectory.projected !== undefined
                  ? `At the current rate this lands near ${Math.round(trajectory.projected)} on exam day.`
                  : trajectory.reason}
              </p>
            </>
          )}
          <div className="mini-stats">
            <div>
              <span className="mono">{readiness.mocksCompleted}</span> mocks
            </div>
            <div>
              <span className="mono">{readiness.mocksAnalysed}</span> analysed
            </div>
          </div>
        </Card>

        {/* 2. What matters most today? */}
        <Card span={2} title="Today's focus" onOpen={() => navigate('today')}>
          {focus.length === 0 ? (
            <Empty>
              Nothing scheduled for today. Open Today to add your own task, or let the planner generate a week.
            </Empty>
          ) : (
            focus.map((task) => <TaskCard key={task.id} task={task} compact />)
          )}
        </Card>

        {/* 3. How much can I realistically do? */}
        <Card title="Capacity" subtitle={`Week of ${weekStart}`} onOpen={() => navigate('week')} openLabel="Week">
          <StatGrid>
            <Stat label="Planned" value={formatHours(weekAllocated, 1)} sub="still committed" />
            <Stat label="Available" value={formatHours(capacityWeek.remainingPlannedMin, 1)} sub="capacity left" />
          </StatGrid>
          <div style={{ marginTop: 12 }}>
            <CapacityMeter
              allocatedMin={weekAllocated}
              plannedMin={capacityWeek.remainingPlannedMin}
              bufferMin={capacityWeek.remainingBufferMin}
            />
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            {formatHours(capacityWeek.remainingBufferMin, 1)} held back as buffer. Required pace{' '}
            {formatHours(workload.requiredPerWeekMin, 1)}/week against {formatHours(workload.realisticPerWeekMin, 1)}
            /week realistic.
          </p>
        </Card>

        {/* 4. This week's outcomes */}
        <Card
          title="This week's outcomes"
          subtitle={week?.focusNote}
          onOpen={() => navigate('week')}
        >
          {!week || week.outcomes.length === 0 ? (
            <Empty>No week generated yet.</Empty>
          ) : (
            <>
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
              <div className="mini-stats">
                <div>
                  <span className="mono">
                    {weekDone}/{weekPlanned}
                  </span>{' '}
                  tasks complete
                </div>
              </div>
            </>
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

        {/* 6. Is the input steady? */}
        <Card title="Consistency" onOpen={() => navigate('log')} openLabel="Log">
          <StatGrid>
            <Stat
              label="Current streak"
              value={habits.currentStreak}
              sub={habits.currentStreak === 1 ? 'day' : 'days'}
            />
            <Stat label="Best streak" value={habits.bestStreak} sub="days" />
          </StatGrid>
          <div className="mini-stats">
            <div>
              Today <span className="mono">{habits.today.done}</span> of{' '}
              <span className="mono">{habits.today.total}</span> habits
            </div>
          </div>
        </Card>

        {insights.length > 0 && (
          <Card span={3} title="What the system has noticed">
            <ul className="insight-list">
              {insights.slice(0, 4).map((i) => (
                <li key={i.id} className="small">
                  <span className="muted">{i.source}:</span> {i.text}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

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
