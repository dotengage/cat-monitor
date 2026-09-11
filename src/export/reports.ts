/**
 * Report builders.
 *
 * Kept as pure functions of `AppState` and a date, exactly like the planning
 * engine, so the contents of a report can be asserted in tests rather than
 * eyeballed in a PDF viewer.
 */
import { ERROR_TYPE_LABELS, SECTIONS, SECTION_FULL_NAMES, SECTION_LABELS } from '../config/catConfig';
import { addDays, formatDate, formatHours, formatLongDate } from '../domain/date';
import type { AppState, ErrorType, ISODate, SectionKey } from '../domain/types';
import {
  errorCountsByType,
  fullMocks,
  overallPercentileHistory,
  sectionPercentileHistory,
  sectionStats,
  sortedMocks,
  topicStats,
} from '../engine/derive';
import { buildEstimationModel } from '../engine/estimation';
import { calculateHabitStats, studyLogRows, studyTotals } from '../engine/habits';
import { calculateCATReadiness } from '../engine/readiness';
import { calculateFeasibility } from '../engine/workload';
import { PdfDoc } from './pdf';

function stamp(state: AppState, today: ISODate): string {
  return `${state.profile.targetPercentile}+ percentile target  -  exam ${formatLongDate(state.profile.examDate)}  -  generated ${formatDate(today, { withYear: true })}`;
}

/* ------------------------------------------------------------------ */
/* Mock report                                                         */
/* ------------------------------------------------------------------ */

export function buildMockReport(state: AppState, today: ISODate): PdfDoc {
  const doc = new PdfDoc('CAT Monitor - Mock report');
  const readiness = calculateCATReadiness(state, today);
  const trajectory = readiness.trajectory;
  const mocks = sortedMocks(state);
  const full = fullMocks(state);
  const percentiles = full.map((m) => m.overallPercentile).filter((p): p is number => typeof p === 'number');

  doc.title('Mock report', stamp(state, today));

  /* ---- Summary ---- */
  doc.stats([
    { label: 'Mocks taken', value: String(full.length) },
    { label: 'Analysed', value: `${full.filter((m) => m.analysed).length} of ${full.length}` },
    { label: 'Sectionals', value: String(mocks.filter((m) => m.kind === 'sectional').length) },
    { label: 'Latest percentile', value: percentiles.length ? String(percentiles[percentiles.length - 1]) : 'n/a' },
    { label: 'Best percentile', value: percentiles.length ? String(Math.max(...percentiles)) : 'n/a' },
    {
      label: 'Average',
      value: percentiles.length ? (percentiles.reduce((a, v) => a + v, 0) / percentiles.length).toFixed(1) : 'n/a',
    },
  ]);

  /* ---- Trajectory ---- */
  doc.heading('Trajectory');
  doc.keyValues([
    ['Status', trajectory.status.replace('_', ' ')],
    ['Evidence confidence', trajectory.confidence],
    ['Current', trajectory.current === undefined ? 'no data' : String(trajectory.current)],
    ['Projected', trajectory.projected === undefined ? 'needs 2+ mocks' : String(trajectory.projected)],
    ['Trend', trajectory.trend.toLowerCase()],
    ['Main constraint', trajectory.constraint ? SECTION_FULL_NAMES[trajectory.constraint] : 'not established'],
    ['Days remaining', String(trajectory.daysRemaining)],
  ]);
  doc.paragraph(trajectory.reason, { muted: true });
  doc.paragraph(`Recommended: ${trajectory.recommendedAction}`);

  const history = overallPercentileHistory(state);
  if (history.length > 0) {
    doc.heading('Overall percentile over time');
    doc.lineChart(
      history.map((h) => ({ label: formatDate(h.date), value: h.percentile })),
      state.profile.targetPercentile,
    );
  }

  /* ---- Section readiness ---- */
  doc.heading('Section readiness');
  doc.table(
    [
      { header: 'Section', width: 26 },
      { header: 'Status', width: 22 },
      { header: 'Latest', width: 13, align: 'right' },
      { header: 'Readiness', width: 15, align: 'right' },
      { header: 'Accuracy', width: 13, align: 'right' },
      { header: 'Coverage', width: 13, align: 'right' },
    ],
    readiness.sections.map((s) => [
      SECTION_LABELS[s.section],
      s.status.replace('_', ' '),
      s.latestPercentile === undefined ? '-' : String(s.latestPercentile),
      `${s.readiness}/100`,
      s.accuracy === undefined ? '-' : `${Math.round(s.accuracy * 100)}%`,
      `${Math.round(s.coverage * 100)}%`,
    ]),
  );
  for (const s of readiness.sections) {
    doc.paragraph(`${SECTION_LABELS[s.section]}: ${s.nextAction}`, { size: 9 });
  }

  /* ---- Every mock ---- */
  doc.pageBreak();
  doc.title('Mock by mock', `${mocks.length} recorded`);

  if (mocks.length === 0) {
    doc.paragraph('No mocks have been recorded yet.', { muted: true });
  }

  for (const mock of [...mocks].reverse()) {
    doc.heading(`${mock.name || mock.provider}${mock.kind === 'sectional' ? ' (sectional)' : ''}`);
    doc.keyValues([
      ['Date', formatDate(mock.date, { withYear: true })],
      ['Provider', mock.provider],
      ['Analysis', mock.analysed ? 'complete' : 'INCOMPLETE'],
      ...(mock.kind === 'full'
        ? ([
            ['Overall score', mock.overallScore === undefined ? '-' : String(mock.overallScore)],
            ['Overall percentile', mock.overallPercentile === undefined ? '-' : String(mock.overallPercentile)],
          ] as [string, string][])
        : []),
    ]);

    const rows = SECTIONS.filter((s) => mock.sections[s]).map((s) => {
      const sec = mock.sections[s]!;
      const acc = sec.attempts > 0 ? `${Math.round((sec.correct / sec.attempts) * 100)}%` : '-';
      return [SECTION_LABELS[s], String(sec.score), String(sec.percentile), String(sec.attempts), String(sec.correct), acc];
    });
    if (rows.length > 0) {
      doc.table(
        [
          { header: 'Section', width: 24 },
          { header: 'Score', width: 14, align: 'right' },
          { header: 'Percentile', width: 18, align: 'right' },
          { header: 'Attempts', width: 16, align: 'right' },
          { header: 'Correct', width: 14, align: 'right' },
          { header: 'Accuracy', width: 14, align: 'right' },
        ],
        rows,
      );
    }

    if ((mock.dilrSetsAttempted ?? 0) > 0) {
      doc.paragraph(`DILR sets: ${mock.dilrSetsSolved ?? 0} solved of ${mock.dilrSetsAttempted} attempted.`, { size: 9 });
    }
    if (mock.timeNotes) doc.paragraph(`Time management: ${mock.timeNotes}`, { size: 9 });
    if (mock.selectionNotes) doc.paragraph(`Question selection: ${mock.selectionNotes}`, { size: 9 });
    if (mock.mainMistakes) doc.paragraph(`Main mistakes: ${mock.mainMistakes}`, { size: 9 });
    const lessons = mock.lessons.filter(Boolean);
    if (lessons.length > 0) doc.bullets(lessons);
    if (!mock.analysed) {
      doc.paragraph('This mock has not been analysed, so its percentile carries less weight in the trajectory.', {
        muted: true,
        size: 9,
      });
    }
  }

  return doc;
}

/* ------------------------------------------------------------------ */
/* Analytics report                                                    */
/* ------------------------------------------------------------------ */

export function buildAnalyticsReport(state: AppState, today: ISODate): PdfDoc {
  const doc = new PdfDoc('CAT Monitor - Analytics report');
  const feasibility = calculateFeasibility(state, today);
  const workload = feasibility.workload;
  const habits = calculateHabitStats(state, today);

  doc.title('Analytics report', stamp(state, today));

  /* ---- Where things stand ---- */
  doc.heading('Where things stand');
  doc.paragraph(feasibility.headline);
  doc.paragraph(feasibility.reason, { muted: true });
  doc.keyValues(feasibility.inputs.map((i) => [i.label, i.value] as [string, string]));

  /* ---- Workload ---- */
  doc.heading('Remaining workload');
  doc.stats([
    { label: 'Remaining', value: formatHours(workload.remainingMin, 0) },
    { label: 'Required / week', value: formatHours(workload.requiredPerWeekMin, 1) },
    { label: 'Realistic / week', value: formatHours(workload.realisticPerWeekMin, 1) },
    { label: 'Weeks left', value: String(workload.weeksRemaining) },
    { label: 'Health', value: workload.health.replace('_', ' ').toLowerCase() },
    { label: 'Actual / week', value: workload.actualPerWeekMin ? formatHours(workload.actualPerWeekMin, 1) : 'n/a' },
  ]);
  doc.table(
    [
      { header: 'Component', width: 70 },
      { header: 'Hours', width: 30, align: 'right' },
    ],
    workload.breakdown.map((b) => [b.label, formatHours(b.min, 1)]),
  );
  doc.paragraph(feasibility.safety.message, { muted: true, size: 9 });

  /* ---- Plan vs reality ---- */
  const weeks: { start: ISODate; planned: number; actual: number; tasks: number; done: number }[] = [];
  for (let i = 7; i >= 0; i -= 1) {
    const start = addDays(today, -i * 7);
    const end = addDays(start, 6);
    const tasks = state.tasks.filter((t) => t.date !== null && t.date >= start && t.date <= end && t.status !== 'removed');
    const record = state.capacityRecords.find((r) => r.weekStart === start);
    if (tasks.length === 0 && !record) continue;
    const doneMin = tasks
      .filter((t) => t.status === 'done' || t.status === 'partial')
      .reduce((a, t) => a + (t.actualMin ?? t.estimateMin), 0);
    weeks.push({
      start,
      planned: tasks.reduce((a, t) => a + t.estimateMin, 0),
      actual: record?.actualMin ?? doneMin,
      tasks: tasks.length,
      done: tasks.filter((t) => t.status === 'done').length,
    });
  }

  if (weeks.length > 0) {
    doc.heading('Plan vs reality');
    doc.table(
      [
        { header: 'Week of', width: 24 },
        { header: 'Planned', width: 16, align: 'right' },
        { header: 'Actual', width: 16, align: 'right' },
        { header: 'Tasks', width: 14, align: 'right' },
        { header: 'Done', width: 14, align: 'right' },
        { header: 'Rate', width: 16, align: 'right' },
      ],
      weeks.map((w) => [
        formatDate(w.start, { withYear: true }),
        formatHours(w.planned, 1),
        formatHours(w.actual, 1),
        String(w.tasks),
        String(w.done),
        `${w.tasks > 0 ? Math.round((w.done / w.tasks) * 100) : 0}%`,
      ]),
    );
  }

  /* ---- Mock trends ---- */
  const history = overallPercentileHistory(state);
  if (history.length > 0) {
    doc.heading('Mock percentile over time');
    doc.lineChart(
      history.map((h) => ({ label: formatDate(h.date), value: h.percentile })),
      state.profile.targetPercentile,
    );

    doc.heading('Sectional percentiles');
    doc.table(
      [
        { header: 'Section', width: 30 },
        { header: 'First', width: 18, align: 'right' },
        { header: 'Latest', width: 18, align: 'right' },
        { header: 'Change', width: 18, align: 'right' },
        { header: 'Points', width: 16, align: 'right' },
      ],
      SECTIONS.map((s) => {
        const pts = sectionPercentileHistory(state, s);
        if (pts.length === 0) return [SECTION_LABELS[s], '-', '-', '-', '0'];
        const first = pts[0].percentile;
        const last = pts[pts.length - 1].percentile;
        const delta = Math.round((last - first) * 10) / 10;
        return [SECTION_LABELS[s], String(first), String(last), `${delta >= 0 ? '+' : ''}${delta}`, String(pts.length)];
      }),
    );
  }

  /* ---- Study volume ---- */
  doc.pageBreak();
  doc.title('Study, habits and errors', stamp(state, today));

  const rows = studyLogRows(state, addDays(today, -29), today);
  const totals = studyTotals(rows);
  doc.heading('Study log (last 30 days)');
  doc.stats([
    { label: 'Total logged', value: formatHours(totals.totalMin, 1) },
    { label: 'Days logged', value: String(totals.daysLogged) },
    { label: 'Avg per active day', value: formatHours(totals.averageMinPerLoggedDay, 1) },
  ]);
  if (totals.totalMin > 0) {
    doc.bars(
      SECTIONS.map((s) => ({
        label: SECTION_LABELS[s],
        value: Math.round((totals.bySection[s] / 60) * 10) / 10,
        caption: `${Math.round((totals.bySection[s] / Math.max(1, totals.totalMin)) * 100)}%`,
      })),
      'h',
    );
  }

  const logged = rows.filter((r) => r.totalMin > 0);
  if (logged.length > 0) {
    doc.table(
      [
        { header: 'Date', width: 18 },
        { header: 'VARC', width: 24 },
        { header: 'DILR', width: 24 },
        { header: 'QA', width: 24 },
        { header: 'Total', width: 12, align: 'right' },
      ],
      logged
        .slice(0, 30)
        .map((r) => [
          formatDate(r.date),
          cell(r.sections.VARC),
          cell(r.sections.DILR),
          cell(r.sections.QA),
          formatHours(r.totalMin, 1),
        ]),
    );
  }

  /* ---- Habits ---- */
  doc.heading('Consistency');
  doc.stats([
    { label: 'Current streak', value: `${habits.currentStreak} days` },
    { label: 'Best streak', value: `${habits.bestStreak} days` },
    { label: 'Consistency', value: `${Math.round(habits.consistency * 100)}%` },
  ]);

  /* ---- Topic accuracy ---- */
  const topics = topicStats(state).filter((t) => t.attempted >= 5);
  if (topics.length > 0) {
    doc.heading('Accuracy by topic');
    doc.table(
      [
        { header: 'Topic', width: 42 },
        { header: 'Section', width: 14 },
        { header: 'Attempted', width: 16, align: 'right' },
        { header: 'Accuracy', width: 14, align: 'right' },
        { header: 'Errors', width: 14, align: 'right' },
      ],
      [...topics]
        .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))
        .slice(0, 25)
        .map((t) => [
          t.name,
          SECTION_LABELS[t.section],
          String(t.attempted),
          `${Math.round((t.accuracy ?? 0) * 100)}%`,
          String(t.errorCount),
        ]),
    );
  }

  /* ---- Section practice ---- */
  const stats = sectionStats(state);
  doc.heading('Practice volume by section');
  doc.table(
    [
      { header: 'Section', width: 26 },
      { header: 'Sessions', width: 15, align: 'right' },
      { header: 'Questions', width: 15, align: 'right' },
      { header: 'Accuracy', width: 15, align: 'right' },
      { header: 'Hours', width: 15, align: 'right' },
      { header: 'DILR sets', width: 14, align: 'right' },
    ],
    SECTIONS.map((s) => [
      SECTION_LABELS[s],
      String(stats[s].sessions),
      String(stats[s].attempted),
      stats[s].accuracy === null ? '-' : `${Math.round(stats[s].accuracy! * 100)}%`,
      formatHours(stats[s].timeMin, 1),
      s === 'DILR' ? `${stats[s].setsSolved}/${stats[s].setsAttempted}` : '-',
    ]),
  );

  /* ---- Errors ---- */
  const errorCounts = errorCountsByType(state);
  if (errorCounts.length > 0) {
    doc.heading('Error categories');
    doc.bars(
      errorCounts.slice(0, 10).map((e) => ({
        label: ERROR_TYPE_LABELS[e.type as ErrorType] ?? e.type,
        value: e.count,
      })),
    );
    doc.paragraph(
      `${state.errors.filter((e) => !e.resolved).length} of ${state.errors.length} logged errors are still unresolved.`,
      { muted: true, size: 9 },
    );
  }

  /* ---- Estimation drift ---- */
  const model = buildEstimationModel(state, state.settings.planning);
  if (model.size > 0) {
    doc.heading('Estimated vs actual duration');
    doc.table(
      [
        { header: 'Task type', width: 40 },
        { header: 'Samples', width: 15, align: 'right' },
        { header: 'Avg est', width: 15, align: 'right' },
        { header: 'Avg actual', width: 15, align: 'right' },
        { header: 'Factor', width: 15, align: 'right' },
      ],
      [...model.values()]
        .sort((a, b) => b.samples - a.samples)
        .map((s) => [
          s.key === '*' ? 'All tasks' : s.key.replace('|', ' - '),
          String(s.samples),
          `${s.meanEstimateMin}m`,
          `${s.meanActualMin}m`,
          s.factor.toFixed(2),
        ]),
    );
    doc.paragraph('A factor above 1.00 means sessions run longer than planned; future estimates are nudged upward.', {
      muted: true,
      size: 9,
    });
  }

  return doc;
}

function cell(entry: { minutes: number; topics: string }): string {
  if (entry.minutes === 0 && !entry.topics) return '-';
  const hours = formatHours(entry.minutes, 1);
  return entry.topics ? `${hours}  ${entry.topics}` : hours;
}

/** Filename that sorts chronologically and says what it is. */
export function reportFilename(kind: 'mock' | 'analytics', today: ISODate): string {
  return `cat-monitor-${kind}-report-${today}.pdf`;
}

export function sectionLabel(section: SectionKey): string {
  return SECTION_LABELS[section];
}
