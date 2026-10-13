/** Separate-process read of bytes saved by the real batch writer; no proposal/cache survives. */
import { readFileSync } from 'node:fs';
import { readGoalRecord } from '../../../goal-target/goal-record.js';
const { graph, clock } = JSON.parse(readFileSync(0, 'utf8'));
const NativeDate = Date;
globalThis.Date = class extends NativeDate {
  constructor(value: string | number = clock) { super(value); }
  static now() { return new NativeDate(clock).getTime(); }
} as DateConstructor;
const goal = graph.nodes.find((n: { kind: string }) => n.kind === 'goal');
const held = readGoalRecord(graph, goal.id);
process.stdout.write(JSON.stringify({ clock: new Date().toISOString(), deadline: held?.horizon?.deadline,
  months: held?.horizon?.months, reference: goal.goal_horizon_reference_date, stated_months: goal.goal_horizon_stated_months }));
