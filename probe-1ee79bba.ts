import { EDIT_GRAPH_POSITIVE_REGEX, EDIT_GRAPH_NEGATIVE_REGEX } from './src/orchestrator/routing/edit-graph-intent-regex.js';
import { isAnalyticalQuestion } from './src/orchestrator-v5/routing/analytical-question-guard.js';
import { isBoundedNonMutationAnalyticalRequest } from './src/orchestrator-v5/routing/mutation-warrant.js';
import { classifyAnalyticalIntent, hasMutationSignal } from './src/orchestrator-v5/routing/analytical-intent.js';
import { isValueUpdatePhrasing, shouldSuppressEditDispatchForValueUpdate } from './src/orchestrator/routing/value-update-gate.js';
import { tryVagueEditGuard } from './src/orchestrator-v5/routing/vague-edit-guard.js';
import { tryChipSimplifyIntercept } from './src/orchestrator-v5/routing/chip-simplify-intercept.js';

const NODES = [
  { id: 'f1', kind: 'factor', label: 'Team coordination overhead' },
  { id: 'f2', kind: 'factor', label: 'Launch date' },
  { id: 'o1', kind: 'option', label: 'Hire a Tech Lead' },
  { id: 'o2', kind: 'option', label: 'Upskill the team' },
];

const MSGS = [
  ['R1', 'Change the uncertainty range for Team coordination overhead to low'],
  ['R2', 'Change the team coordination overhead to low.'],
  ['R3', 'Do you think we should add the risk about spending money on the resource and still not hitting our launch date?'],
  ['R4', 'Do you agree that we should add this as a risk?'],
  ['R5', 'How do we include it in the analysis?'],
  // CONTRAST CONTROLS — expected to differ
  ['C1-realedit', 'Set Team coordination overhead to 0.2'],
  ['C2-vague',   'Change this'],
  ['C3-question','What could change the outcome?'],
];

for (const [id, m] of MSGS) {
  const pos = EDIT_GRAPH_POSITIVE_REGEX.test(m);
  const neg = EDIT_GRAPH_NEGATIVE_REGEX.test(m);
  const bounded = isBoundedNonMutationAnalyticalRequest(m);
  const anaQ = isAnalyticalQuestion(m);
  const analytical = anaQ || bounded;
  const vup = shouldSuppressEditDispatchForValueUpdate(m);
  const editVerbCandidate = pos && !neg && !vup && !analytical;
  const vague = tryVagueEditGuard(m, NODES);
  const chip = tryChipSimplifyIntercept(m);
  console.log(JSON.stringify({
    id,
    pos, neg,
    isAnalyticalQuestion: anaQ,
    boundedNonMutationAnalytical: bounded,
    classifyAnalyticalIntent: classifyAnalyticalIntent(m),
    hasMutationSignal: hasMutationSignal(m),
    isValueUpdatePhrasing: isValueUpdatePhrasing(m),
    shouldSuppressEditDispatchForValueUpdate: vup,
    editVerbCandidate,
    vagueEditGuard: vague,
    chipSimplify: chip.matched,
  }));
}
