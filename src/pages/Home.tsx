import { SECTION_LABELS } from '../config/catConfig';
import { daysBetween, formatHours, formatLongDate } from '../domain/date';
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
const chance = (p: number) => (p < 0.01 ? 'under 1%' : p > 0.99 ? 'over 99%' : `about ${Math.round(p * 100)}%`);

export function Home({ navigate }: { navigate: (r: RouteKey) => void }) {
  const { state, today, weekStart } = useStore();
  const engine = useEngine();
  const { feasibility, workload, todayPlan, capacityWeek, insights, conflicts, monthly, forecast } = engine;

  const daysRemaining = Math.max(0, daysBetween(today, state.profile.examDate));
  const week = state.weeks.find((w) => w.startDate === weekStart);
  const weekTasks = state.tasks.filter((t) => t.weekStart === weekStart && t.status !== 'removed');
  // Only work still ahead of us, against capacity still ahead of us.
  const weekAllocated = weekTasks
    .filter((t) => t.status === 'planned' && (t.date ?? '') >= today)
    .reduce((a, t) => a + t.estimateMin, 0);
  const needsDecision = state.tasks.filter((t) => t.needsDecision && t.status === 'missed');

  const habits = calculateHabitStats(state, today);
  const constraintSection = forecast.constraint.top[0]?.section;
  const constraintTask = constraintSection
    ? [...todayPlan.mustDo, ...todayPlan.shouldDo].find((t) => t.section === constraintSection)
    : undefined;
  const focus = [...todayPlan.mustDo, ...todayPlan.shouldDo].slice(0, 3);
  const biggestRisk =
    conflicts.find((c) => c.severity === 'critical') ??
    conflicts.find((c) => c.severity === 'warn') ??
    null;

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
            {/* Only pair the advice with a task that actually serves it. The planner
                allocates by its own weighting, so today's first task is not
                necessarily about the binding constraint. */}
            {constraintTask && (
              <p className="small muted">
                Today, that means: <strong>{constraintTask.title}</strong>
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
              Any chance shown is the share of 10,000 simulated papers, resampled from your own recent mocks, that
              reach the target. It is only as good as those mocks, and it says so when there are too few.
            </p>
          </Collapse>
        </Card>

        {/* Where the evidence puts exam day: a band, never a single number. */}
        <Card title="Exam-day forecast" onOpen={() => navigate('cat')} openLabel="Readiness">
          {!forecast.forecast?.percentile ? (
            <Empty>{forecast.statusRule.replace(/^No status: /, '')}</Empty>
          ) : (
            <>
              <div className="goal-line">
                <div>
                  <div className="goal-value mono">{Math.round(forecast.forecast.percentile.p50)}</div>
                  <div className="tiny muted">likely percentile</div>
                </div>
                <StatusPill status={forecast.status} />
              </div>
              <Progress
                value={forecast.forecast.percentile.p50}
                max={forecast.target}
                tone={
                  forecast.status === 'OFF_TRACK'
                    ? 'risk'
                    : forecast.status === 'AT_RISK' || forecast.status === 'STRETCH'
                      ? 'warn'
                      : 'ok'
                }
              />
              <div className="goal-foot tiny muted">
                <span>
                  Range {Math.round(forecast.forecast.percentile.p10)} to {Math.round(forecast.forecast.percentile.p90)}
                  {forecast.forecast.indicative ? ' (indicative)' : ''}
                </span>
                <span>{daysRemaining}d left</span>
              </div>
              <p className="tiny muted" style={{ marginTop: 10 }}>
                Chance of reaching {forecast.target}: <strong>{chance(forecast.forecast.probability ?? 0)}</strong>
                {forecast.highVariance ? '. High variance between papers.' : '.'}
              </p>
            </>
          )}
          <div className="mini-stats">
            <div>
              <span className="mono">{forecast.n}</span> mocks with marks
            </div>
            <div>
              <span className="mono">{forecast.analysedMocks}</span> analysed
            </div>
            <div>
              trend <span className="mono">{forecast.trend.label.toLowerCase()}</span>
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
          ) : forecast.constraint.established && forecast.constraint.top[0] ? (
            <Callout>
              <strong>{SECTION_LABELS[forecast.constraint.top[0].section]}</strong> is the binding constraint, a{' '}
              {forecast.constraint.top[0].kind === 'CONSISTENCY' ? 'consistency' : 'capability'} gap.
              <div className="small" style={{ marginTop: 4 }}>
                {forecast.constraint.top[0].why}
              </div>
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
