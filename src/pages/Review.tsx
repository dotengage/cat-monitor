import { useState } from 'react';
import { ENERGY_LABELS } from '../config/catConfig';
import { addDays, formatDate, formatHours } from '../domain/date';
import type { EnergyLevel, ReviewAnswers, WeeklyReviewOutput } from '../domain/types';
import { assessCapacityReality, generateWeeklyReview } from '../engine/weeklyReview';
import { useStore } from '../state/store';
import { Callout, Card, Collapse, Empty, Field, HealthPill, Stat, StatGrid, StatusPill } from '../ui/components';

export function Review() {
  const { state, dispatch, today, weekStart } = useStore();
  const lastWeekStart = addDays(weekStart, -7);
  const [target, setTarget] = useState(lastWeekStart);
  const existing = state.reviews.find((r) => r.weekStart === target);

  const [answers, setAnswers] = useState<ReviewAnswers>({
    completedNote: '',
    missedNote: '',
    realityNote: '',
    energy: 3,
    actualFocusedHours: 0,
    friction: '',
    wins: '',
  });

  const preview = existing ? existing.output : generateWeeklyReview(state, target, today, answers);
  const reality = assessCapacityReality(state, target, today);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Weekly review</h1>
          <div className="sub">
            The review is the input to next week's plan, not a report card.
          </div>
        </div>
        <div className="btn-group">
          <button type="button" className="btn small" onClick={() => setTarget(addDays(target, -7))}>
            ← Earlier week
          </button>
          <button type="button" className="btn small" onClick={() => setTarget(lastWeekStart)}>
            Last week
          </button>
          <button type="button" className="btn small" onClick={() => setTarget(weekStart)}>
            This week
          </button>
        </div>
      </div>

      <Card title={`Week of ${formatDate(target, { withYear: true })}`}>
        {existing ? (
          <Callout tone="ok">
            Review completed and applied. Next week was regenerated from it.
          </Callout>
        ) : (
          <>
            <p className="small muted">Seven questions. Keep it quick enough that you will actually do it.</p>
            <Field label="1. What did you actually achieve?" htmlFor="r1">
              <textarea id="r1" value={answers.completedNote} onChange={(e) => setAnswers({ ...answers, completedNote: e.target.value })} />
            </Field>
            <Field label="2. What did you miss?" htmlFor="r2">
              <textarea id="r2" value={answers.missedNote} onChange={(e) => setAnswers({ ...answers, missedNote: e.target.value })} />
            </Field>
            <Field label="3. What happened that you did not plan for?" htmlFor="r3">
              <textarea id="r3" value={answers.realityNote} onChange={(e) => setAnswers({ ...answers, realityNote: e.target.value })} />
            </Field>
            <fieldset className="field">
              <legend>4. How was energy this week?</legend>
              <div className="choice-row">
                {([1, 2, 3, 4, 5] as EnergyLevel[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    className="choice"
                    aria-pressed={answers.energy === level}
                    onClick={() => setAnswers({ ...answers, energy: level })}
                  >
                    {level} · {ENERGY_LABELS[level]}
                  </button>
                ))}
              </div>
            </fieldset>
            <Field label="5. How many focused hours were actually available?" htmlFor="r5" hint="Leave at 0 to use logged data instead.">
              <input
                id="r5"
                type="number"
                min={0}
                step={0.5}
                value={answers.actualFocusedHours}
                onChange={(e) => setAnswers({ ...answers, actualFocusedHours: Number(e.target.value) })}
              />
            </Field>
            <Field label="6. What felt unusually difficult?" htmlFor="r6">
              <textarea id="r6" value={answers.friction} onChange={(e) => setAnswers({ ...answers, friction: e.target.value })} />
            </Field>
            <Field label="7. What worked unusually well?" htmlFor="r7">
              <textarea id="r7" value={answers.wins} onChange={(e) => setAnswers({ ...answers, wins: e.target.value })} />
            </Field>
            <Callout tone={reality.kind === 'new-reality' ? 'warn' : 'neutral'}>{reality.explanation}</Callout>
            <button
              type="button"
              className="btn primary block"
              style={{ marginTop: 10 }}
              onClick={() => dispatch({ type: 'review/save', weekStart: target, today, answers })}
            >
              Complete review and rebuild next week
            </button>
          </>
        )}
      </Card>

      <ReviewOutput output={preview} />

      {state.reviews.length > 0 && (
        <Collapse title={`Past reviews (${state.reviews.length})`}>
          <ul className="list-reset stack">
            {[...state.reviews]
              .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
              .map((r) => (
                <li key={r.id} className="row-between small">
                  <span>Week of {formatDate(r.weekStart, { withYear: true })}</span>
                  <span className="muted">
                    {formatHours(r.output.planVsReality.actualMin, 1)} of {formatHours(r.output.planVsReality.plannedMin, 1)} planned
                  </span>
                  <button type="button" className="btn small subtle" onClick={() => setTarget(r.weekStart)}>
                    View
                  </button>
                </li>
              ))}
          </ul>
        </Collapse>
      )}
    </>
  );
}

function ReviewOutput({ output }: { output: WeeklyReviewOutput }) {
  const pvr = output.planVsReality;
  return (
    <>
      <Card title="Week completed">
        {output.completed.length === 0 ? (
          <Empty>Nothing recorded as completed for this week.</Empty>
        ) : (
          <ul className="bullets small">
            {output.completed.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Missed">
        {output.missed.length === 0 ? (
          <p className="small muted">Nothing was missed.</p>
        ) : (
          <ul className="bullets small">
            {output.missed.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Plan vs reality">
        <StatGrid>
          <Stat label="Planned" value={formatHours(pvr.plannedMin, 1)} sub={`${pvr.plannedTasks} tasks`} />
          <Stat label="Actual" value={formatHours(pvr.actualMin, 1)} sub={`${pvr.completedTasks} completed`} />
          <Stat label="Outcomes" value={`${pvr.achievedOutcomes}/${pvr.plannedOutcomes}`} sub="achieved" />
          <Stat label="Expected capacity" value={formatHours(pvr.expectedCapacityMin, 1)} />
          <Stat label="Actual capacity" value={formatHours(pvr.actualCapacityMin, 1)} />
          <Stat
            label="Completion"
            value={`${pvr.plannedMin > 0 ? Math.round((pvr.actualMin / pvr.plannedMin) * 100) : 0}%`}
          />
        </StatGrid>
        {pvr.notes.length > 0 && (
          <ul className="bullets small" style={{ marginTop: 10 }}>
            {pvr.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Goal status">
        {output.goalStatus.map((g) => (
          <div key={g.goalId} className="row-between" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
            <div>
              <div className="small">
                <strong>{g.title}</strong>
              </div>
              <div className="tiny muted">{g.reason}</div>
            </div>
            <StatusPill status={g.status} />
          </div>
        ))}
      </Card>

      <Card title="Recalculated workload" action={<HealthPill health={output.recalculatedWorkload.health} />}>
        <StatGrid>
          <Stat label="Remaining work" value={formatHours(output.recalculatedWorkload.remainingMin, 0)} />
          <Stat label="Required / week" value={formatHours(output.recalculatedWorkload.requiredPerWeekMin, 1)} />
          <Stat label="Realistic / week" value={formatHours(output.recalculatedWorkload.realisticPerWeekMin, 1)} />
          <Stat label="Weeks left" value={output.recalculatedWorkload.weeksRemaining} />
        </StatGrid>
        <div className="table-wrap" style={{ marginTop: 10 }}>
          <table>
            <tbody>
              {output.recalculatedWorkload.breakdown.map((b) => (
                <tr key={b.label}>
                  <td className="muted">{b.label}</td>
                  <td className="num mono">{formatHours(b.min, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="What changed">
        <ul className="bullets small">
          {output.whatChanged.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </Card>

      <Card title="Next week">
        <div className="section-label">Outcomes</div>
        <ul className="bullets small">
          {output.nextWeek.outcomes.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
        <div className="section-label">Top priorities</div>
        <ul className="bullets small">
          {output.nextWeek.priorities.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
        <p className="small muted" style={{ marginTop: 8 }}>
          Revised planned volume: {formatHours(output.nextWeek.revisedPlannedMin, 1)}
        </p>
      </Card>

      {(output.removed.length > 0 || output.deprioritised.length > 0) && (
        <Card title="Removed and deprioritised">
          {output.removed.length > 0 && (
            <>
              <div className="section-label">Removed</div>
              <ul className="bullets small">
                {output.removed.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </>
          )}
          {output.deprioritised.length > 0 && (
            <>
              <div className="section-label">Deprioritised / backlog</div>
              <ul className="bullets small">
                {output.deprioritised.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}

      <Card title="Risks">
        <ul className="bullets small">
          {output.risks.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </Card>

      <Card title="Single most important focus">
        <p>
          <strong>{output.singleFocus}</strong>
        </p>
      </Card>
    </>
  );
}
