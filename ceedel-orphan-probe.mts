import { buildFactorScaleMap, projectRequestInterventionsToWireScale } from './src/orchestrator-v5/tools/plot-intervention-scale.js';

const budgetNode = { id: 'f-budget', kind: 'factor', label: 'Marketing budget', observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 } };
const riskNode   = { id: 'f-risk',   kind: 'factor', label: 'Risk appetite',    observed_state: { value: 0.5 } };
const NODES_BEFORE = [budgetNode, riskNode];
const NODES_AFTER  = [riskNode];               // f-budget node deleted; its intervention orphaned

// The shapes CEE actually persists for an intervention, per plot-intervention-scale's own rules.
const SHAPES: Record<string, unknown> = {
  'canonical {value unit, raw_value user}': { value: 0.4, raw_value: 40000 },
  'raw magnitude only {value: 40000}'      : { value: 40000 },
  'raw with raw_value {40000, 40000}'      : { value: 40000, raw_value: 40000 },
  'bare number 40000'                      : 40000,
  'unit-scale only {value: 0.4}'           : { value: 0.4 },
};

let anyDiff = false;
for (const [name, budgetIntervention] of Object.entries(SHAPES)) {
  const perOption = [{ 'f-budget': budgetIntervention, 'f-risk': { value: 0.5 } }];
  const before = projectRequestInterventionsToWireScale(perOption, buildFactorScaleMap(NODES_BEFORE), undefined);
  const after  = projectRequestInterventionsToWireScale(perOption, buildFactorScaleMap(NODES_AFTER),  undefined);
  const b = JSON.stringify(before.perOption[0]);
  const a = JSON.stringify(after.perOption[0]);
  const bRisk = (before.perOption[0] as any)['f-risk'];
  const aRisk = (after.perOption[0] as any)['f-risk'];
  const diff = b !== a;
  const riskDiff = bRisk !== aRisk;
  if (diff) anyDiff = true;
  console.log(`${diff ? 'DIFFERS ' : 'same    '} | risk ${riskDiff ? 'CHANGED' : 'stable '} | ${name}`);
  if (diff) { console.log(`      before: ${b}`); console.log(`      after : ${a}`); }
}
console.log(`\nANY WIRE DIFFERENCE CAUSED BY THE ORPHAN: ${anyDiff}`);
