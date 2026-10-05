/**
 * ⛔ THE ONE IDENTICAL-ARMS DETECTOR (DL #2575/#2574): two arms of one Run whose outcome distributions are identical
 * split each other's wins (ISL shares ties), so that Run's win shares cannot name a leader. Read from the RESULT, never
 * from graph structure. SCI-DEEP's compare (`runIdenticalArmGroups`) and gate 1 v2's Run-time withhold
 * (`detectIdenticalArms`) both call THIS core: one usability gate, one equality rule, one tolerance.
 */
import { optionIdOf } from '../../orchestrator/context/placeholder-parts.js';
import { isRecommendableOption } from '../tools/handlers/recommendable-option.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Two arms are identical when every outcome statistic agrees within this relative tolerance. */
export const IDENTICAL_ARMS_RELATIVE_TOLERANCE = 1e-12;
export const ARM_STATS = ['mean', 'std', 'p10', 'p50', 'p90'] as const;

/** The draw count `optionRows` trusts: a present `n_valid_samples` is authoritative, else `n_samples`. */
export const drawCount = (o: Rec): number | null => {
  const n = num(o.n_valid_samples !== undefined ? o.n_valid_samples : o.n_samples);
  return n !== null && Number.isSafeInteger(n) && n > 0 ? n : null;
};

export const sameStat = (x: unknown, y: unknown): boolean => {
  const a = num(x); const b = num(y);
  return a !== null && b !== null && Math.abs(a - b) <= IDENTICAL_ARMS_RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
};

/** Same draw count, and every statistic either agrees or is absent on BOTH arms. */
export const sameArm = (a: Rec, b: Rec): boolean => drawCount(a) !== null && drawCount(a) === drawCount(b)
  && ARM_STATS.every((k) => (a[k] === undefined && b[k] === undefined) || sameStat(a[k], b[k]));

export interface ArmOutcome { readonly id: string; readonly outcome: Rec }

/**
 * Each submitted arm that is usable ON ITS OWN, by `optionRows`' own reading: exactly one row, a computed status, its
 * trusted draw count, finite mean and std. An unusable arm never hides a pair among the others: this reader only BLOCKS
 * a comparison, so it must see every pair a ranking could read.
 */
export function usableArmsFromRows(rows: readonly unknown[], submittedIds: readonly string[]): ArmOutcome[] {
  const byId = new Map<string, Rec[]>();
  for (const row of rows) {
    if (!isRec(row)) continue;
    const id = optionIdOf(row);
    if (typeof id === 'string' && id !== '') byId.set(id, [...(byId.get(id) ?? []), row]);
  }
  const arms: ArmOutcome[] = [];
  for (const id of new Set(submittedIds)) {
    const found = byId.get(id);
    if (found?.length !== 1) continue;
    const row = found[0];
    if (!isRecommendableOption(row) || !isRec(row.outcome)) continue;
    if (drawCount(row.outcome) === null || num(row.outcome.mean) === null || num(row.outcome.std) === null) continue;
    arms.push({ id, outcome: row.outcome });
  }
  return arms;
}

/** Groups (two or more, submitted order) of arms that come out identical; any group blocks a win-share leader. */
export function identicalArmGroups(arms: readonly ArmOutcome[]): string[][] {
  const groups: string[][] = [];
  const grouped = new Set<number>();
  for (let i = 0; i < arms.length; i++) {
    if (grouped.has(i)) continue;
    const group = [arms[i].id];
    for (let j = i + 1; j < arms.length; j++) {
      if (!grouped.has(j) && sameArm(arms[i].outcome, arms[j].outcome)) { group.push(arms[j].id); grouped.add(j); }
    }
    if (group.length > 1) groups.push(group);
  }
  return groups;
}
