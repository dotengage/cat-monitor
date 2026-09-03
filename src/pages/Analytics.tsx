import { useMemo } from 'react';
import { ERROR_TYPE_LABELS, SECTIONS, SECTION_LABELS, TASK_TYPE_LABELS } from '../config/catConfig';
import { addDays, formatDate, formatHours, startOfWeek } from '../domain/date';
import type { ErrorType, TaskType } from '../domain/types';
import { errorCountsByType, overallPercentileHistory, topicStats } from '../engine/derive';
import { buildEstimationModel } from '../engine/estimation';
import { useStore } from '../state/store';
import { BarPairChart, ChartLegend, HBarList, TrendChart } from '../ui/charts';
import { Card, Collapse, Empty, Stat, StatGrid } from '../ui/components';

export function Analytics() {
  const { state, today, weekStart } = useStore();

  const weeks = useMemo(() => {
    const list: { start: string; planned: number; actual: number; tasks: number; done: number }[] = [];
    for (let i = 7; i >= 0; i -= 1) {
      const start = addDays(weekStart, -i * 7);
      const end = addDays(start, 6);
      const tasks = state.tasks.filter((t) => t.date !== null && t.date >= start && t.date <= end && t.status !== 'removed');
      if (tasks.length === 0 && !state.capacityRecords.some((r) => r.weekStart === start)) continue;
      const record = state.capacityRecords.find((r) => r.weekStart === start);
      const doneMin = tasks
        .filter((t) => t.status === 'done' || t.status === 'partial')
        .reduce((a, t) => a + (t.actualMin ?? t.estimateMin), 0);
      list.push({
        start,
        planned: tasks.reduce((a, t) => a + t.estimateMin, 0) / 60,
        actual: (record?.actualMin ?? doneMin) / 60,
        tasks: tasks.length,
        done: tasks.filter((t) => t.status === 'done').length,
      });
    }
    return list;
  }, [state.tasks, state.capacityRecords, weekStart]);

  const percentiles = overallPercentileHistory(state);
  const topics = topicStats(state).filter((t) => t.attempted >= 5);
  const errors = errorCountsByType(state);
  const model = buildEstimationModel(state, state.settings.planning);

  const dilrSeries = useMemo(() => {
    const byWeek = new Map<string, number>();
    for (const p of state.practice) {
      if (p.section !== 'DILR' || !p.setsSolved) continue;
      const key = startOfWeek(p.date, state.settings.weekStartsOn);
      byWeek.set(key, (byWeek.get(key) ?? 0) + p.setsSolved);
    }
    return [...byWeek.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [state.practice, state.settings.weekStartsOn]);

  const completionRates = weeks.map((w) => (w.tasks > 0 ? Math.round((w.done / w.tasks) * 100) : 0));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Analytics</h1>
          <div className="sub">Every chart here answers a question. Nothing decorative.</div>
        </div>
      </div>

      <Card title="Plan vs reality" subtitle="Planned against actual focused hours, by week">
        {weeks.length === 0 ? (
          <Empty>No completed weeks yet.</Empty>
        ) : (
          <>
            <BarPairChart
              labels={weeks.map((w) => formatDate(w.start))}
              a={weeks.map((w) => Number(w.planned.toFixed(1)))}
              b={weeks.map((w) => Number(w.actual.toFixed(1)))}
              aLabel="Planned hours"
              bLabel="Actual hours"
              unit="h"
            />
            <ChartLegend
              items={[
                { label: 'Planned', tone: 'neutral' },
                { label: 'Actual', tone: 'accent' },
              ]}
            />
            <div className="table-wrap" style={{ marginTop: 12 }}>
              <table>
                <thead>
                  <tr>
                    <th>Week</th>
                    <th className="num">Planned</th>
                    <th className="num">Actual</th>
                    <th className="num">Tasks</th>
                    <th className="num">Completed</th>
                    <th className="num">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((w, i) => (
                    <tr key={w.start}>
                      <td>{formatDate(w.start, { withYear: true })}</td>
                      <td className="num mono">{w.planned.toFixed(1)}h</td>
                      <td className="num mono">{w.actual.toFixed(1)}h</td>
                      <td className="num mono">{w.tasks}</td>
                      <td className="num mono">{w.done}</td>
                      <td className="num mono">{completionRates[i]}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card title="Mock percentile over time">
        {percentiles.length === 0 ? (
          <Empty>No mock percentiles recorded yet.</Empty>
        ) : (
          <TrendChart
            labels={percentiles.map((p) => formatDate(p.date))}
            series={[{ name: 'Overall percentile', values: percentiles.map((p) => p.percentile), tone: 'accent' }]}
            target={state.profile.targetPercentile}
          />
        )}
      </Card>

      <Card title="Sectional percentile over time">
        {SECTIONS.every((s) => state.mocks.every((m) => !m.sections[s])) ? (
          <Empty>No sectional percentiles recorded yet.</Empty>
        ) : (
          <TrendChart
            labels={[...state.mocks].sort((a, b) => (a.date < b.date ? -1 : 1)).map((m) => formatDate(m.date))}
            series={SECTIONS.map((s) => ({
              name: s,
              values: [...state.mocks]
                .sort((a, b) => (a.date < b.date ? -1 : 1))
                .map((m) => m.sections[s]?.percentile ?? null),
              tone: (s === 'VARC' ? 'ok' : s === 'DILR' ? 'warn' : 'risk') as 'ok' | 'warn' | 'risk',
            }))}
            target={state.profile.targetPercentile}
          />
        )}
        <ChartLegend
          items={[
            { label: 'VARC', tone: 'ok' },
            { label: 'DILR', tone: 'warn' },
            { label: 'QA', tone: 'risk' },
          ]}
        />
      </Card>

      <Card title="Task completion rate" subtitle="Share of planned tasks actually completed, by week">
        {weeks.length === 0 ? (
          <Empty>Not enough data.</Empty>
        ) : (
          <TrendChart
            labels={weeks.map((w) => formatDate(w.start))}
            series={[{ name: 'Completion rate', values: completionRates, tone: 'accent' }]}
            yMin={0}
            yMax={100}
          />
        )}
      </Card>

      <Card title="Estimated vs actual duration" subtitle="A factor above 1.0 means sessions run longer than planned">
        {model.size === 0 ? (
          <Empty>No completed tasks with logged durations yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Task type</th>
                  <th className="num">Samples</th>
                  <th className="num">Avg est.</th>
                  <th className="num">Avg actual</th>
                  <th className="num">Factor</th>
                </tr>
              </thead>
              <tbody>
                {[...model.values()]
                  .sort((a, b) => b.samples - a.samples)
                  .map((s) => {
                    const [type, section] = s.key.split('|');
                    return (
                      <tr key={s.key}>
                        <td>
                          {s.key === '*'
                            ? 'All tasks'
                            : `${TASK_TYPE_LABELS[type as TaskType] ?? type}${section ? ` · ${section}` : ''}`}
                        </td>
                        <td className="num mono">{s.samples}</td>
                        <td className="num mono">{s.meanEstimateMin}m</td>
                        <td className="num mono">{s.meanActualMin}m</td>
                        <td className="num mono">{s.factor.toFixed(2)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Accuracy by topic" subtitle="Topics with at least 5 logged attempts">
        {topics.length === 0 ? (
          <Empty>No practice logged yet.</Empty>
        ) : (
          <HBarList
            items={[...topics]
              .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
              .slice(0, 12)
              .map((t) => ({
                label: `${SECTION_LABELS[t.section]} · ${t.name}`,
                value: Math.round((t.accuracy ?? 0) * 100),
                caption: `${t.attempted} qs`,
                tone: (t.accuracy ?? 0) < 0.5 ? 'risk' : (t.accuracy ?? 0) < 0.7 ? 'warn' : 'ok',
              }))}
            max={100}
            suffix="%"
          />
        )}
      </Card>

      <Card title="Error category distribution">
        {errors.length === 0 ? (
          <Empty>No errors logged yet.</Empty>
        ) : (
          <HBarList
            items={errors.map((e) => ({
              label: ERROR_TYPE_LABELS[e.type as ErrorType] ?? e.type,
              value: e.count,
              tone: 'warn' as const,
            }))}
          />
        )}
      </Card>

      <Card title="DILR sets solved over time">
        {dilrSeries.length === 0 ? (
          <Empty>No DILR sets logged yet.</Empty>
        ) : (
          <TrendChart
            labels={dilrSeries.map(([d]) => formatDate(d))}
            series={[{ name: 'Sets solved', values: dilrSeries.map(([, v]) => v), tone: 'warn' }]}
            yMin={0}
          />
        )}
      </Card>

      <Card title="Study volume">
        <StatGrid>
          <Stat
            label="Total focused"
            value={formatHours(
              state.tasks.filter((t) => t.status === 'done').reduce((a, t) => a + (t.actualMin ?? t.estimateMin), 0),
              0,
            )}
          />
          <Stat label="Questions logged" value={state.practice.reduce((a, p) => a + p.attempted, 0)} />
          <Stat label="DILR sets" value={state.practice.reduce((a, p) => a + (p.setsAttempted ?? 0), 0)} />
          <Stat label="Errors logged" value={state.errors.length} />
        </StatGrid>
      </Card>

      <Collapse title={`Planning decision log (${state.decisions.length})`}>
        <p className="small muted">
          Every automatic change the planner made, and why. If a decision was wrong, override it in the Week view.
        </p>
        {state.decisions.length === 0 ? (
          <Empty>No decisions recorded yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Subject</th>
                  <th>Decision</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {state.decisions.slice(0, 60).map((d) => (
                  <tr key={d.id}>
                    <td className="mono">{formatDate(d.date)}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 160 }}>{d.subject}</td>
                    <td>{d.kind}</td>
                    <td style={{ whiteSpace: 'normal', minWidth: 260 }} className="small muted">
                      {d.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Collapse>

      <p className="tiny faint">Data as of {formatDate(today, { withYear: true })}.</p>
    </>
  );
}
