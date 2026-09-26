import { readGoalLabelSense, labelContradictsSense, resolveRequestGoalDirection, deriveEmittedGoalDirection } from '../orchestrator-v5/goal-target/goal-direction.js';
import { attestedGoalDirection } from '../orchestrator-v5/agent-lane/admit-model.js';
import { deriveGoalIntent } from '../orchestrator-v5/coaching/objective-contradiction.js';

const labels = [
  'Maximise revenue','Maximize revenue','Grow revenue','Increase revenue','Boost conversion','Raise NPS','Improve NPS','Improve churn',
  'Reduce churn','Cut costs','Lower churn','Decrease churn','Minimise cost','Minimize cost',
  'Not reduce churn','Do not reduce headcount','Never cut the support budget','Avoid cutting the support team','Don\'t grow headcount','Do not increase headcount',
  'Grow revenue and reduce costs','Reduce costs and grow revenue','Grow revenue while cutting costs',
  'Revenue maximised','Revenue maximized','Churn reduced','Costs cut','Revenue increased','Revenue growth','Revenue increase','Cost reduction','Churn decrease',
  'Maximise','Maximize','Grow','Increase','Boost','Raise','Reduce','Cut','Lower','Decrease','Minimise','Minimize',
  'MAXIMISE REVENUE','maximise revenue','Maximise: revenue','Maximise — revenue','Maximise £ revenue','Maximise 12-month revenue','Grow 2027 revenue','Reduce 30-day churn',
  'Revenue (maximise)','Revenue — maximise','Revenue, grow','Revenue: increase to 20k',
  'Monthly churn rate','Pro MRR','Profit to maximise','Churn to reduce','Churn, to be reduced',
  'Maximise-revenue','Maximising revenue','Maximises revenue','Raising prices','Lifting retention','Expanding reach','Double revenue','Accelerate growth',
  'Shrink costs','Drop churn','Dropping churn','Increasing costs','Cost increase','Price increase',
];
const ops = ['<=','<','>=','>'];
const rows: string[] = [];
for (const l of labels) {
  const intent = deriveGoalIntent(l);
  const ls = readGoalLabelSense(l);
  const cells: string[] = [];
  for (const op of ops) {
    const stamp = attestedGoalDirection({ metric: l, operator: op as any, provenance: 'explicit' } as any);
    const graph = { nodes: [{ id: 'g', kind: 'goal', label: l, ...(stamp ? { goal_direction: stamp } : {}) }] };
    const r = resolveRequestGoalDirection({ graph, goalNodeId: 'g', goalConstraints: undefined });
    cells.push(`${op}:stamp=${stamp ?? '-'}/sent=${r.goal_direction ?? '-'}(${r.provenance ?? '-'})`);
  }
  rows.push(`${JSON.stringify(l).padEnd(40)} intent=${intent.direction}/${JSON.stringify(intent.subject)} read=${ls ?? '-'} base=${deriveEmittedGoalDirection({nodes:[{id:'g',label:l}]},'g') ?? '-'} | ${cells.join('  ')}`);
}
console.log(rows.join('\n'));
