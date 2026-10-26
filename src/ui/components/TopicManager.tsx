import { SECTIONS, SECTION_LABELS } from '../../config/catConfig';
import type { Topic } from '../../domain/types';
import { topicStats } from '../../engine/derive';
import { useStore } from '../../state/store';
import { Card, Collapse } from './index';

/**
 * The syllabus list.
 *
 * Lives apart from readiness on purpose: topic status feeds the planner's
 * remaining-workload estimate, not the readiness forecast, which is built from
 * mock marks alone.
 */
export function TopicManager() {
  const { state, dispatch } = useStore();
  const stats = topicStats(state);

  return (
    <Card title="Topics" subtitle="Feeds the remaining-workload estimate the planner works from. Skip what is not worth your time.">
      {SECTIONS.map((section) => (
        <Collapse
          key={section}
          title={`${SECTION_LABELS[section]} · ${state.topics.filter((t) => t.section === section && (t.status === 'practised' || t.status === 'strong')).length}/${
            state.topics.filter((t) => t.section === section).length
          } covered`}
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Topic</th>
                  <th className="num">Acc.</th>
                  <th className="num">Qs</th>
                  <th className="num">Wt</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {state.topics
                  .filter((t) => t.section === section)
                  .map((topic) => {
                    const stat = stats.find((s) => s.topicId === topic.id);
                    return (
                      <tr key={topic.id}>
                        <td>
                          {topic.name}
                          <div className="tiny faint">{topic.area}</div>
                        </td>
                        <td className="num mono">
                          {stat?.accuracy === null || stat === undefined ? '—' : `${Math.round(stat.accuracy * 100)}%`}
                        </td>
                        <td className="num mono">{stat?.attempted ?? 0}</td>
                        <td className="num mono">{topic.weight}</td>
                        <td>
                          <select
                            aria-label={`Status for ${topic.name}`}
                            value={topic.status}
                            onChange={(e) =>
                              dispatch({
                                type: 'topic/update',
                                id: topic.id,
                                patch: { status: e.target.value as Topic['status'] },
                              })
                            }
                          >
                            <option value="not-started">Not started</option>
                            <option value="learning">Learning</option>
                            <option value="practised">Practised</option>
                            <option value="strong">Strong</option>
                            <option value="skipped">Skipped</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Collapse>
      ))}
    </Card>
  );
}
