import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { draftReferenceDate } from '../draft-reference.js';

describe('the ONE reference-date resolver: stated date > version > the scenario\'s server stamp > nothing (never the clock)', () => {
  const V = '2026-10-10T10:00:00Z', S = '2026-10-09T10:00:00Z';
  it('precedence', () => {
    expect(draftReferenceDate({ asOf: '2026-01-02', versionCreatedAt: V, scenarioCreatedAt: S })).toBe('2026-01-02');
    expect(draftReferenceDate({ versionCreatedAt: V, scenarioCreatedAt: S })).toBe('2026-10-10');
    expect(draftReferenceDate({ versionCreatedAt: null, scenarioCreatedAt: S })).toBe('2026-10-09');
    expect(draftReferenceDate({ scenarioCreatedAt: S })).toBe('2026-10-09');
  });
  it('an unusable stamp falls through; nothing usable is no reference (never the clock)', () => {
    expect(draftReferenceDate({ versionCreatedAt: 'nope', scenarioCreatedAt: S })).toBe('2026-10-09');
    expect(draftReferenceDate({ versionCreatedAt: 'nope', scenarioCreatedAt: 'also nope' })).toBeUndefined();
    expect(draftReferenceDate({ versionCreatedAt: null, scenarioCreatedAt: null })).toBeUndefined();
    expect(draftReferenceDate({})).toBeUndefined();
  });
  it('the day is the London day of the stamp (a late-evening UTC stamp in BST is the next London day)', () => {
    expect(draftReferenceDate({ scenarioCreatedAt: '2026-10-09T23:30:00Z' })).toBe('2026-10-10');
  });
});

/** Repo guard: both issuers of the deadline card take their reference from the resolver, and nothing beside it turns a stamp into a day. */
describe('both deadline-card issuers call the one resolver', () => {
  const source = readFileSync(join(fileURLToPath(new URL('../../', import.meta.url)), 'agent-lane/runtime/agent-capabilities.ts'), 'utf8');
  const file = ts.createSourceFile('c.ts', source, ts.ScriptTarget.Latest, true);
  const calls = (name: string): ts.CallExpression[] => {
    const found: ts.CallExpression[] = [];
    const visit = (n: ts.Node): void => { if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === name) found.push(n); ts.forEachChild(n, visit); };
    visit(file);
    return found;
  };
  /** The name of the enclosing method / property (`proposeGoalDeadline`, `deadlineCardFromDraft`). */
  const owner = (n: ts.Node): string => {
    for (let p: ts.Node | undefined = n.parent; p; p = p.parent) if ((ts.isMethodDeclaration(p) || ts.isPropertyAssignment(p)) && ts.isIdentifier(p.name)) return p.name.text;
    return '';
  };
  it('exactly the door and the automatic offer call draftReferenceDate, each with the scenario stamp and the version stamp', () => {
    const found = calls('draftReferenceDate');
    expect(found.map(owner).sort()).toEqual(['deadlineCardFromDraft', 'proposeGoalDeadline']);
    for (const c of found) {
      const text = c.arguments.map(a => a.getText(file)).join(' ');
      expect(text).toContain('scenarioCreatedAt: g.scenario_created_at');
      expect(text).toContain('versionCreatedAt: draft?.created_at');
    }
  });
  it('each resolver call is the initializer of the issuer\'s `reference` (its result is used, not discarded)', () => {
    for (const c of calls('draftReferenceDate')) {
      expect(ts.isVariableDeclaration(c.parent) && c.parent.name.getText(file), owner(c)).toBe('reference');
    }
  });
  it('no other site in the file turns a stored stamp into a day: every todayInLondon call takes the injected clock, and no Date is built from a stamp', () => {
    expect(calls('todayInLondon').length).toBeGreaterThan(0);
    for (const c of calls('todayInLondon')) expect(c.arguments.map(a => a.getText(file)).join(' '), c.getText(file)).toContain('opts.now');
    const stamped: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isNewExpression(n) && n.expression.getText(file) === 'Date' && (n.arguments?.length ?? 0) > 0
        && /created_at|scenario_created_at|stamp|timestamp/i.test(n.arguments!.map(a => a.getText(file)).join(' '))) stamped.push(n.getText(file));
      ts.forEachChild(n, visit);
    };
    visit(file);
    expect(stamped).toEqual([]);
  });
});
