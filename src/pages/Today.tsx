import { useState } from 'react';
import { ENERGY_LABELS } from '../config/catConfig';
import { addDays, formatHours, formatLongDate, formatMinutes } from '../domain/date';
import type { EnergyLevel } from '../domain/types';
import { useStore } from '../state/store';
import { useEngine } from '../state/useEngine';
import { Callout, CapacityMeter, Card, Empty, Field, Modal, SectionLabel, Stat, StatGrid } from '../ui/components';
import { TaskCard } from '../ui/components/TaskCard';
import type { RouteKey } from '../ui/layout/Shell';

export function Today({ navigate }: { navigate: (r: RouteKey) => void }) {
  const { state, dispatch, today, weekStart } = useStore();
  const { todayPlan, todayCapacity } = useEngine();
  const [modal, setModal] = useState<null | 'unexpected' | 'travel' | 'checkin'>(null);

  const existingLog = state.dayLogs.find((d) => d.date === today);
  const needsDecision = state.tasks.filter((t) => t.needsDecision && t.status === 'missed');

  const setEnergy = (energy: EnergyLevel) =>
    dispatch({
      type: 'day/log',
      log: {
        date: today,
        energy,
        estimatedAvailableMin: existingLog?.estimatedAvailableMin ?? todayCapacity.rawMin,
        focusedMin: existingLog?.focusedMin ?? 0,
        unexpectedCommitments: existingLog?.unexpectedCommitments ?? '',
      },
    });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Today</h1>
          <div className="sub">{formatLongDate(today)}</div>
        </div>
        <div className="right small muted">
          Energy mode: <strong>{todayPlan.energyMode.replace('_', ' ').toLowerCase()}</strong>
        </div>
      </div>

      {needsDecision.length > 0 && (
        <Card title={`Decisions needed (${needsDecision.length})`}>
          <Callout tone="warn">
            These tasks were missed. Nothing has been moved to today automatically - each one needs a fresh decision
            based on importance, dependencies, deadline and remaining capacity.
          </Callout>
          <div style={{ marginTop: 10 }}>
            {needsDecision.map((t) => (
              <TaskCard key={t.id} task={t} />
            ))}
          </div>
        </Card>
      )}

      <Card title="Quick update">
        <div className="btn-group">
          <button type="button" className="btn small" onClick={() => setEnergy(2)}>
            😴 Low energy today
          </button>
          <button type="button" className="btn small" onClick={() => setModal('unexpected')}>
            🚨 Unexpected commitment
          </button>
          <button type="button" className="btn small" onClick={() => setModal('travel')}>
            ✈ Travelling
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => dispatch({ type: 'week/rebalance', weekStart, today })}
          >
            📈 Finished early - pull work forward
          </button>
          <button type="button" className="btn small" onClick={() => navigate('mocks')}>
            🏁 Log a mock
          </button>
          <button type="button" className="btn small" onClick={() => setModal('checkin')}>
            📝 End-of-day check-in
          </button>
        </div>
      </Card>

      {todayPlan.note && <Callout tone="warn">{todayPlan.note}</Callout>}

      <SectionLabel>Must do</SectionLabel>
      {todayPlan.mustDo.length === 0 ? (
        <Empty>Nothing critical scheduled. That is a valid day - protect the buffer.</Empty>
      ) : (
        todayPlan.mustDo.map((t) => <TaskCard key={t.id} task={t} />)
      )}

      <SectionLabel>Should do</SectionLabel>
      {todayPlan.shouldDo.length === 0 ? (
        <Empty>Nothing else committed for today.</Empty>
      ) : (
        todayPlan.shouldDo.map((t) => <TaskCard key={t.id} task={t} />)
      )}

      {todayPlan.optional.length > 0 && (
        <>
          <SectionLabel>Optional</SectionLabel>
          {todayPlan.optional.map((t) => (
            <TaskCard key={t.id} task={t} />
          ))}
        </>
      )}

      {todayPlan.alternatives.length > 0 && (
        <>
          <SectionLabel>Lower-friction alternatives</SectionLabel>
          <Callout>
            Energy is low. These need less cognitive load and still move readiness - swap one in rather than writing off
            the day.
          </Callout>
          {todayPlan.alternatives.map((t) => (
            <TaskCard key={t.id} task={t} compact />
          ))}
        </>
      )}

      {todayPlan.done.length > 0 && (
        <>
          <SectionLabel>Completed today</SectionLabel>
          {todayPlan.done.map((t) => (
            <TaskCard key={t.id} task={t} compact />
          ))}
        </>
      )}

      <Card title="Buffer">
        <StatGrid>
          <Stat label="Planned capacity" value={formatMinutes(todayPlan.plannedMin)} />
          <Stat label="Allocated" value={formatMinutes(todayPlan.allocatedMin)} />
          <Stat label="Unallocated" value={formatMinutes(todayPlan.bufferMin)} />
        </StatGrid>
        <div style={{ marginTop: 10 }}>
          <CapacityMeter
            allocatedMin={todayPlan.allocatedMin}
            plannedMin={todayPlan.plannedMin}
            bufferMin={todayCapacity.bufferMin}
          />
        </div>
        <details className="collapse" style={{ marginTop: 10 }}>
          <summary>How today's capacity was calculated</summary>
          <div className="small muted">
            <div>Base available: {formatMinutes(todayCapacity.baseMin)}</div>
            <div>× energy factor {todayCapacity.energyFactor} (energy {todayCapacity.energy}/5)</div>
            <div>
              × commitment factor {todayCapacity.commitmentFactor}
              {todayCapacity.commitments.length > 0
                ? ` (${todayCapacity.commitments.map((c) => `${c.title} ${c.hours}h`).join(', ')})`
                : ''}
            </div>
            <div>× realism factor {todayCapacity.realismFactor} (learned from logged days)</div>
            <div>
              = {formatMinutes(todayCapacity.rawMin)} realistic, of which {formatMinutes(todayCapacity.plannedMin)} is
              planned and {formatMinutes(todayCapacity.bufferMin)} is buffer.
            </div>
          </div>
        </details>
      </Card>

      <Card title="How did today actually go?">
        <div className="row" style={{ marginBottom: 10 }}>
          {([1, 2, 3, 4, 5] as EnergyLevel[]).map((level) => (
            <button
              key={level}
              type="button"
              className="choice"
              aria-pressed={(existingLog?.energy ?? 0) === level}
              onClick={() => setEnergy(level)}
            >
              {level} · {ENERGY_LABELS[level]}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={() => setModal('checkin')}>
          Log time and commitments
        </button>
        {existingLog && (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            Logged: energy {existingLog.energy}/5, {formatHours(existingLog.focusedMin, 1)} focused of{' '}
            {formatHours(existingLog.estimatedAvailableMin, 1)} estimated.
          </p>
        )}
      </Card>

      {modal === 'checkin' && <CheckInModal onClose={() => setModal(null)} />}
      {modal === 'unexpected' && <UnexpectedModal onClose={() => setModal(null)} />}
      {modal === 'travel' && <TravelModal onClose={() => setModal(null)} />}
    </>
  );
}

function CheckInModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch, today, weekStart } = useStore();
  const { todayCapacity } = useEngine();
  const existing = state.dayLogs.find((d) => d.date === today);
  const [energy, setEnergy] = useState<EnergyLevel>(existing?.energy ?? 3);
  const [estimated, setEstimated] = useState(String(Math.round((existing?.estimatedAvailableMin ?? todayCapacity.rawMin) / 6) / 10));
  const [focused, setFocused] = useState(String(Math.round((existing?.focusedMin ?? 0) / 6) / 10));
  const [unexpected, setUnexpected] = useState(existing?.unexpectedCommitments ?? '');

  const save = () => {
    dispatch({
      type: 'day/log',
      log: {
        date: today,
        energy,
        estimatedAvailableMin: Math.round(Number(estimated) * 60),
        focusedMin: Math.round(Number(focused) * 60),
        unexpectedCommitments: unexpected,
      },
    });
    dispatch({ type: 'week/rebalance', weekStart, today });
    onClose();
  };

  return (
    <Modal
      title="End-of-day check-in"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn primary" onClick={save}>
            Save and rebalance
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="small muted">
        This is what teaches the planner your real capacity. It takes about twenty seconds.
      </p>
      <fieldset className="field">
        <legend>Energy</legend>
        <div className="choice-row">
          {([1, 2, 3, 4, 5] as EnergyLevel[]).map((level) => (
            <button key={level} type="button" className="choice" aria-pressed={energy === level} onClick={() => setEnergy(level)}>
              {level} · {ENERGY_LABELS[level]}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="inline-fields-2">
        <Field label="Time you thought you had (h)" htmlFor="est">
          <input id="est" type="number" step={0.25} min={0} value={estimated} onChange={(e) => setEstimated(e.target.value)} />
        </Field>
        <Field label="Focused time actually spent (h)" htmlFor="foc">
          <input id="foc" type="number" step={0.25} min={0} value={focused} onChange={(e) => setFocused(e.target.value)} />
        </Field>
      </div>
      <Field label="Unexpected commitments" htmlFor="unex">
        <textarea id="unex" value={unexpected} onChange={(e) => setUnexpected(e.target.value)} placeholder="Two unplanned meetings, family visit..." />
      </Field>
    </Modal>
  );
}

function UnexpectedModal({ onClose }: { onClose: () => void }) {
  const { dispatch, today, weekStart } = useStore();
  const [title, setTitle] = useState('Unexpected commitment');
  const [hours, setHours] = useState('2');

  return (
    <Modal
      title="Unexpected commitment"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              dispatch({
                type: 'commitment/add',
                commitment: {
                  title,
                  type: 'unexpected',
                  startDate: today,
                  endDate: today,
                  recurrence: 'once',
                  daysOfWeek: [],
                  hoursPerDay: Number(hours) || 1,
                  reducesCapacity: true,
                  flexible: false,
                },
              });
              dispatch({ type: 'week/rebalance', weekStart, today });
              onClose();
            }}
          >
            Add and recalculate
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="small muted">Capacity for today will be reduced and the week rebalanced around it.</p>
      <Field label="What came up?" htmlFor="utitle">
        <input id="utitle" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field label="Hours lost" htmlFor="uhours">
        <input id="uhours" type="number" min={0} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
      </Field>
    </Modal>
  );
}

function TravelModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch, today, weekStart } = useStore();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(addDays(today, 3));
  const [hours, setHours] = useState(String(Math.max(1, state.profile.weekdayHours.normal - 0.5)));

  return (
    <Modal
      title="Travel"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              dispatch({
                type: 'commitment/add',
                commitment: {
                  title: 'Travel',
                  type: 'travel',
                  startDate: from,
                  endDate: to,
                  recurrence: 'once',
                  daysOfWeek: [],
                  hoursPerDay: Number(hours) || 2,
                  reducesCapacity: true,
                  flexible: true,
                },
              });
              dispatch({ type: 'week/rebalance', weekStart, today });
              onClose();
            }}
          >
            Add and recalculate
          </button>
          <button type="button" className="btn subtle" onClick={onClose}>
            Cancel
          </button>
        </>
      }
    >
      <p className="small muted">
        Travel days are not written off. Capacity is recalculated, P1 work is protected, and low-value work is cut
        rather than piled up for your return.
      </p>
      <div className="inline-fields-2">
        <Field label="From" htmlFor="tfrom">
          <input id="tfrom" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" htmlFor="tto">
          <input id="tto" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>
      <Field label="Hours per day consumed by travel" htmlFor="thours">
        <input id="thours" type="number" min={0} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} />
      </Field>
    </Modal>
  );
}
