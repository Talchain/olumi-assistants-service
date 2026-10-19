/**
 * ⭐ STANCE (AIE reply 20261019 v1, sha 543db8bb): a draft recorded or written before `statements[].stance` existed, with the
 * declaration the stance-aware drafter now makes for it. INPUT CHANGE, never an expectation change: each caller states the stance of
 * its figures by MEANING. The default (`byField`) is only for fixtures whose every non-target figure is a current assertion
 * (reviewed per fixture: no supposition, target-as-level or estimate among them); a supposition is declared `hypothetical` by
 * its caller. A statement that already declares a stance keeps it.
 */
import type { StatementStance } from '../../construction-source-map.js';

type Rec = Record<string, unknown>;
export const byField = (st: Rec): StatementStance => (st['field'] === 'target' ? 'target' : 'stated_current');

export function withDeclaredStance<T>(draft: T, stanceOf: (st: Rec) => StatementStance = byField): T {
  const d = draft as Rec;
  if (!Array.isArray(d['statements'])) return draft;
  return { ...d, statements: (d['statements'] as Rec[]).map((st) => ('stance' in st ? st : { ...st, stance: stanceOf(st) })) } as T;
}
