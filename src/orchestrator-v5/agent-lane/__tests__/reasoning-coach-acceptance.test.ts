import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import acceptance from './fixtures/reasoning-coach-acceptance.json';
import { checkMethodTurn, entryKey, renderCopy, selectGuidance, stateKeyHash } from '../guidance/index.js';
import { POLICY, SPEC_SHA } from '../guidance/policy.js';
import { computeResponseHash } from '../../../utils/response-hash.js';
import type { GuidanceSignals, GuidanceState, MethodInputs, MethodTurnId, PolicyId, SelectedRow } from '../guidance/types.js';

const cases = acceptance.cases;
const fixtures = acceptance.method_turn_fixtures;
const stateOf = (id: string): GuidanceSignals => structuredClone(cases.find(c => c.id === id)!.state) as GuidanceSignals;
const rowsOf = (state: GuidanceSignals, guidance: GuidanceState = state.guidance ?? {}) => {
  const selection = selectGuidance(state, guidance);
  return { selection, rows: [selection.slot1, selection.slot2].filter((r): r is SelectedRow => r !== undefined) };
};

describe('pinned reasoning-coach acceptance contract (RC re-pin)', () => {
  it('imports all 35 cases and all 20 checker fixtures, with unique ids', () => {
    expect(cases).toHaveLength(35); expect(fixtures).toHaveLength(20);
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    expect(new Set(fixtures.map(f => f.id)).size).toBe(fixtures.length);
    expect(SPEC_SHA).toBe('41b36299ff754a41f0e8a4685342eb069dc865c3');
  });
  it('vendors exact source bytes and uses the same typed policy constants', () => {
    const policy = readFileSync(new URL('../guidance/reasoning-interventions.json', import.meta.url));
    const fixture = readFileSync(new URL('./fixtures/reasoning-coach-acceptance.json', import.meta.url));
    expect(createHash('sha256').update(policy).digest('hex')).toBe('772d309fbf9eca166b8d3d98f452256ad80d961388d412625b24c1515d841f3f');
    expect(createHash('sha256').update(fixture).digest('hex')).toBe('cd8a41074a90d66776ac9af4c743f2dec5cbbb1609d8e7e4cf2ef172c86a8846');
    const source = JSON.parse(policy.toString());
    expect(POLICY).toEqual(Object.fromEntries(Object.keys(POLICY).map(key => [key, source[key]])));
  });
  it.each(cases)('$id — real selector, exact slots/items/actions and rendered copy', c => {
    const state = c.state as GuidanceSignals;
    const before = JSON.stringify(state);
    const { selection, rows } = rowsOf(state);
    expect(rows.length).toBeLessThanOrEqual('max_chips' in c.expect ? c.expect.max_chips as number : 2);
    expect(rows.map(r => r.policy_id).sort()).toEqual(c.expect.offered.map(r => r.policy_id).sort());
    for (const offered of c.expect.offered) {
      const row = offered.slot === 1 ? selection.slot1 : selection.slot2;
      expect(row?.policy_id).toBe(offered.policy_id);
      if ('variant' in offered) expect(row?.variant).toBe(offered.variant);
      if ('priority' in offered) expect(row?.priority).toBe(offered.priority);
      if ('item' in offered) expect(row?.item).toBe(offered.item);
      if ('item_one_of' in offered) expect(row?.item).toBe((offered.item_one_of as string[])[0]);
      if ('primary_action_kind' in offered) expect(row?.primary_action.action_kind).toBe(offered.primary_action_kind);
    }
    if ('not_offered' in c.expect && c.expect.not_offered) for (const id of c.expect.not_offered) expect(rows.some(r => r.policy_id === id)).toBe(false);
    expect(selection.runs_method).toBe('runs_method' in c.expect ? c.expect.runs_method : undefined);
    if ('mode' in c.expect) expect(selection.mode ?? null).toBe(c.expect.mode);
    if ('choices' in c.expect) expect(selection.choices ?? null).toEqual(c.expect.choices);
    if ('runs_method' in c.expect && 'item' in c.expect) expect(selection.item ?? null).toBe(c.expect.item);
    if ('rendered_example' in c.expect && c.expect.rendered_example) for (const example of c.expect.rendered_example) {
      const row = rows.find(r => r.policy_id === example.policy_id)!;
      const copy = renderCopy(row, state);
      expect({ policy_id: row.policy_id, variant: row.variant ?? null, item: row.item ?? null, ...copy }).toEqual(example);
      expect(row.copy).toEqual(copy);
    }
    const copy = rows.flatMap(r => Object.values(r.copy)).filter(Boolean).join('\n');
    if ('copy_must_contain' in c.expect && c.expect.copy_must_contain) for (const phrase of c.expect.copy_must_contain) expect(copy).toContain(phrase);
    if ('copy_must_not_contain' in c.expect && c.expect.copy_must_not_contain) for (const phrase of c.expect.copy_must_not_contain) expect(copy).not.toContain(phrase);
    expect(JSON.stringify(state)).toBe(before);
  });
  it.each(fixtures)('$id — real text checker, exact failed-id set', f => {
    const result = checkMethodTurn(f.policy_id as MethodTurnId, f.reply, f.inputs as MethodInputs);
    expect(result.pass).toBe(f.expect === 'pass');
    expect(new Set(result.failed)).toEqual(new Set('failing_checks' in f ? f.failing_checks : []));
    if ('expect_targets' in f) expect(result.targets).toEqual(f.expect_targets);
  });
  it('cold reload preserves the complete selection from the on-disk (content-free) entries', () => {
    const state = stateOf('A-TWO-LOAD-HIDDEN-AFTER-RELOAD');
    const inMemory = selectGuidance(state, state.guidance!);
    // What coaching_state persists (selection.state_key_persistence): {status, state_key_hash, turn_id}, nothing raw.
    const onDisk: GuidanceState = Object.fromEntries(Object.entries(state.guidance!).map(([key, record]) =>
      [key, { status: record!.status, state_key_hash: record!.state_key_hash, turn_id: record!.turn_id }]));
    expect(selectGuidance(state, JSON.parse(JSON.stringify(onDisk)))).toEqual(inMemory);
    expect(inMemory.slot1?.policy_id).not.toBe('RC-WIDEN');
    expect(JSON.stringify(onDisk)).not.toContain('switch_to_gcp');
  });
  it('every guidance entry in the contract is on-disk form: envelope-safe key, hash only, no raw id', () => {
    const KEY = /^[A-Za-z0-9_.:-]{1,128}$/u;
    for (const c of cases) for (const [key, record] of Object.entries((c.state as GuidanceSignals).guidance ?? {})) {
      expect(key).toMatch(KEY);
      expect(key).not.toContain('->');
      expect(Object.keys(record!).sort()).toEqual(expect.arrayContaining(['state_key_hash', 'status']));
      expect(record).not.toHaveProperty('state_key_fields');
    }
  });
});

describe('discriminating controls for selector and rendering', () => {
  it('key builders omit a null member (selection.state_key_rule), so a null never changes the persisted hash', () => {
    const state = stateOf('A-WHAT-CHANGES-MEASURED');
    const most = state['run.decision_sensitivity']!.most_sensitive!;
    const withNull = { ...state, 'run.decision_sensitivity': { status: 'measured' as const, most_sensitive: { ...most, range: null as unknown as undefined } } };
    const row = rowsOf(withNull).rows.find(r => r.policy_id === 'RC-WHAT-CHANGES')!;
    const fields = state['run.run_key'] === undefined ? { factor_id: most.factor_id } : { run_key: state['run.run_key'], factor_id: most.factor_id };
    expect(row.state_key_hash).toBe(stateKeyHash(fields));
  });
  it('a measured factor cannot license WHAT-CHANGES when the leader is unlicensed', () => {
    const state = { ...stateOf('A-WHAT-CHANGES-MEASURED'), 'run.leader_licensed': false };
    expect(rowsOf(state).rows.some(r => r.policy_id === 'RC-WHAT-CHANGES')).toBe(false);
  });
  it('same item and priority favours the reasoning framing over Strengthen', () => {
    const state = stateOf('A-WHAT-CHANGES-MEASURED');
    const factor = state['run.decision_sensitivity']!.most_sensitive!;
    const { rows, selection } = rowsOf({ ...state, 'model.goal_path_factors': [{ ...factor, value_authorship: 'olumi_estimate', goal_distance: 0 }] });
    expect(rows[0].policy_id).toBe('RC-WHAT-CHANGES');
    expect(selection.suppressed).toContainEqual({ policy_id: 'RC-STRENGTHEN-ITEM', reason: 'budget' });
  });
  it('absent/pending signals are silent; missing labels never become guessed copy', () => {
    expect(rowsOf({}).rows).toEqual([]);
    const state = stateOf('A-WHAT-CHANGES-MEASURED');
    const { selection } = rowsOf({ ...state, 'run.decision_sensitivity': { status: 'pending' } });
    expect(selection.suppressed).toContainEqual({ policy_id: 'RC-WHAT-CHANGES', reason: 'pending_signal' });
    expect(renderCopy({ policy_id: 'RC-WIDEN', variant: 'W2' }, { ...stateOf('A-WHAT-CHANGES-NONE-MEASURABLE-SILENT'), 'model.option_labels': {} }).question).toBeNull();
  });
  it('item order is goal distance then id, independent of producer array order', () => {
    const state = stateOf('A-STRENGTHEN-PLACEHOLDER-P1');
    const a = rowsOf(state).rows[0];
    expect(rowsOf({ ...state, 'model.goal_path_links': [...state['model.goal_path_links']!].reverse() }).rows[0]).toEqual(a);
    const links = state['model.goal_path_links']!.map(l => ({ ...l, goal_distance: 0 }));
    const expected = state['model.placeholder_goal_links']!.slice().sort()[0];
    expect(rowsOf({ ...state, 'model.goal_path_links': links }).rows[0].item).toBe(expected);
  });
  it('item cooldown falls across variants and returns when the item digest changes', () => {
    const state = stateOf('A-STRENGTHEN-PLACEHOLDER-P1');
    const first = rowsOf(state).rows[0];
    const otherLinks = state['model.goal_path_links']!.filter(l => l.link_id !== first.item).map(l => ({ ...l, link_sizing: 'user' as const }));
    const link = state['model.goal_path_links']!.find(l => l.link_id === first.item)!;
    const one = { ...state, 'model.goal_path_links': [link, ...otherLinks], 'model.placeholder_goal_links': [link.link_id],
      'model.goal_path_factors': [], 'model.same_lever': false, 'model.risk_ids': ['r1', 'r2'], 'model.goal_path_factor_ids': ['f1', 'f2', 'f3'] };
    const guidance = { [entryKey('RC-STRENGTHEN-ITEM', link.link_id)]: { status: 'dismissed' as const, state_key_hash: first.state_key_hash } };
    expect(rowsOf(one, guidance).rows.some(r => r.policy_id === 'RC-STRENGTHEN-ITEM')).toBe(false);
    // The raw id is never the entry key: a raw-keyed record does not cool the item.
    expect(rowsOf(one, { [`RC-STRENGTHEN-ITEM:${link.link_id}`]: guidance[entryKey('RC-STRENGTHEN-ITEM', link.link_id)] }).rows[0].item).toBe(link.link_id);
    expect(rowsOf({ ...one, 'model.goal_path_links': [{ ...link, value_hash: 'new0estimate' }, ...otherLinks] }, guidance).rows[0].item).toBe(link.link_id);
  });
  it('an asked pre-mortem with no licensed leader and no pick asks which option, offering nothing else', () => {
    const state = { ...stateOf('A-EXPLICIT-REQUEST-BYPASSES-COOLDOWN'), 'run.kind': 'none', 'run.leader_licensed': false, 'user.selected_option_id': null };
    const { rows, selection } = rowsOf(state);
    expect(rows).toEqual([]);
    expect(selection).toMatchObject({ runs_method: 'RC-PREMORTEM', mode: 'choose_plan', choices: [...state['model.non_sq_option_ids']!].sort() });
    const pick = state['model.non_sq_option_ids']![0];
    expect(rowsOf({ ...state, 'user.selected_option_id': pick }).selection.mode).toBeUndefined();
    // A pick that is not one of the user's options (status quo, removed) is not a plan.
    expect(rowsOf({ ...state, 'user.selected_option_id': 'not_an_option' }).selection.mode).toBe('choose_plan');
  });
  it('rename/position edits do not offer Coach my edits', () => {
    const state = stateOf('A-COACH-EDITS-OFFERED');
    const edit = { kind: 'structural_rename', entity_id: 'x', field: 'label', after_hash: 'h' };
    expect(rowsOf({ ...state, 'since_run.goal_path_user_edits': { status: 'available', edits: [edit] } }).rows.some(r => r.policy_id === 'RC-COACH-EDITS')).toBe(false);
  });
  it('canonical hashes sort object keys and unordered option sets, preserving ordered arrays', () => {
    expect(stateKeyHash({ z: 1, a: { y: 2, x: 3 } })).toBe(stateKeyHash({ a: { x: 3, y: 2 }, z: 1 }));
    expect(stateKeyHash({ a: [1, 2] })).not.toBe(stateKeyHash({ a: [2, 1] }));
    expect(stateKeyHash({ a: 'private figure' })).toMatch(/^[a-f0-9]{12}$/u);
    // selection.state_key_persistence: the same bytes as CEE computeResponseHash (persisted hashes must agree).
    for (const fields of [{ item_id: 'a->b', link_sizing: 'placeholder', value_hash: '0123456789ab' }, { z: [3, 1, 2], a: { é: 'ü', b: null } },
      { edits: [{ kind: 'factor_value_edit', entity_id: 'x', field: 'value', after_hash: 'h' }] }, { n: 0.1, m: -2, big: 1e21 }]) {
      expect(stateKeyHash(fields)).toBe(computeResponseHash(fields));
    }
    const state = stateOf('A-PREMORTEM-LICENSED');
    expect(rowsOf({ ...state, 'model.non_sq_option_ids': [...state['model.non_sq_option_ids']!].reverse() }).selection).toEqual(rowsOf(state).selection);
  });
  it('a null goal label (as #2465 types it) is "no label": silent copy, never a throw', () => {
    const state = { ...stateOf('A-PREMORTEM-LICENSED'), 'model.goal_label': null };
    expect(() => rowsOf(state)).not.toThrow();
    expect(() => renderCopy({ policy_id: 'RC-WIDEN', variant: 'W6' }, state)).not.toThrow();
    for (const row of rowsOf(state).rows) for (const field of Object.values(row.copy)) expect(field ?? '').not.toMatch(/\{|null/u);
  });
  it('W7 and W2Z with a null goal label: null copy fields, never a throw (note 3 guard)', () => {
    const state = { ...stateOf('A-PREMORTEM-LICENSED'), 'model.goal_label': null };
    // The field whose template names {goal_label} is null; the rest render (W7: title; W2Z: question).
    for (const [variant, field] of [['W7', 'title'], ['W2Z', 'question']] as const) {
      expect(() => renderCopy({ policy_id: 'RC-WIDEN', variant }, state)).not.toThrow();
      expect(renderCopy({ policy_id: 'RC-WIDEN', variant }, state)[field]).toBeNull();
    }
  });
  it('a user label is inserted verbatim: braces in it neither blank the copy nor pull in another field', () => {
    const state = stateOf('A-PREMORTEM-LICENSED');
    const plan = state['run.leader_option_id']!;
    const braces = renderCopy({ policy_id: 'RC-PREMORTEM' }, { ...state, 'model.option_labels': { ...state['model.option_labels'], [plan]: 'Sprint capacity {AI}' } });
    expect(braces.title).toContain('‘Sprint capacity {AI}’');
    const injected = renderCopy({ policy_id: 'RC-PREMORTEM' }, { ...state, 'model.option_labels': { ...state['model.option_labels'], [plan]: 'Plan {goal_label}' } });
    expect(injected.title).toContain('‘Plan {goal_label}’');
    expect(injected.title).not.toContain(state['model.goal_label']!);
  });
  it('copy handles one-month/deadline horizons, curly quotes, acronyms and Unicode truncation', () => {
    const state = stateOf('A-PREMORTEM-LICENSED');
    expect(renderCopy({ policy_id: 'RC-PREMORTEM' }, { ...state, 'model.goal_horizon': { months: 1 } }).question).toContain('a month from now');
    expect(renderCopy({ policy_id: 'RC-PREMORTEM' }, { ...state, 'model.goal_horizon': { deadline: '2027-01-01' } }).question).toContain('2027-01-01');
    const label = '😀'.repeat(41);
    const copy = renderCopy({ policy_id: 'RC-PREMORTEM' }, { ...state, 'model.option_labels': { switch_to_gcp: label } });
    expect(copy.title).toContain(`‘${'😀'.repeat(39)}…’`);
  });
});

describe('all deterministic text post-check ids, including methods without vendored reply fixtures', () => {
  const textCases: { id: PolicyId; good: string; bad: string; inputs: MethodInputs; failed: string[] }[] = [
    { id: 'RC-WHAT-CHANGES', good: 'Olumi varied annual cost at 10. Give your estimate.',
      bad: 'No single assumption matters. Nothing would change. EVPPI is 90%.', inputs: { factor_label: 'Annual cost', factor_current_value: 10 },
      failed: ['WC-NAMES-FACTOR', 'WC-NO-NEW-FIGURES', 'WC-NO-NOTHING', 'WC-BANNED'] },
    { id: 'RC-STRENGTHEN-ITEM', good: 'Annual cost changes revenue. The current figure is 10.',
      bad: 'This placeholder edge has default strength 90.', inputs: { item_labels: ['Annual cost', 'Revenue'], item_current_value: 10 },
      failed: ['ST-NAMES-ITEM', 'ST-BANNED', 'ST-NO-NEW-FIGURES'] },
    { id: 'RC-COACH-EDITS', good: 'You changed annual cost and revenue. The analysis is out of date.',
      bad: 'The result has changed and this option now leads.', inputs: { edited_labels: ['Annual cost', 'Revenue'], 'run.kind': 'complete_stale' },
      failed: ['CE-NAMES-EDITS', 'CE-STALE-IFF', 'CE-NO-RESULT-CLAIM'] },
  ];
  it.each(textCases)('$id checks every text rule on a good and bad reply', c => {
    expect(checkMethodTurn(c.id, c.good, c.inputs)).toEqual({ pass: true, failed: [], targets: [] });
    expect(new Set(checkMethodTurn(c.id, c.bad, c.inputs).failed)).toEqual(new Set(c.failed));
    expect(new Set(c.failed)).toEqual(new Set(POLICY.method_turns[c.id].post_checks.map(c => c.id)));
  });
  it('list numbers are not invented figures; quoted/punctuated names normalise identically', () => {
    expect(checkMethodTurn('RC-WIDEN', '- ‘Angel-investor outreach’: more.', { current_option_labels: ['Angel investor outreach'] }).failed).toContain('WD-NO-DUP');
    const good = fixtures.find(f => f.id === 'MT-PREMORTEM-GOOD')!;
    expect(checkMethodTurn('RC-PREMORTEM', good.reply, good.inputs as MethodInputs)).toMatchObject({ pass: true, failed: [] });
    expect(checkMethodTurn('RC-WIDEN', '- New route: budget £45,000.', { brief: 'Budget £45,000' })).toEqual({ pass: true, failed: [], targets: [] });
    expect(checkMethodTurn('RC-WHAT-CHANGES', 'Annual cost is 10. The analysis is sensitive to it.', { factor_label: 'Annual cost', factor_current_value: 10 }).pass).toBe(true);
  });
  it('pre-mortem grounding accepts whole-word refs, not prefixes or another plan; each story names its target', () => {
    const text = '1. F2 fell short. Watch for: delays. Mitigate: a test.\n2. R1 happened. Watch for: invoices. Mitigate: a cap.\nOutside the model: what about suppliers?';
    const inputs = { supplied_items: [{ id: 'f2', ref: 'F2' }, { id: 'r1', ref: 'R1' }], plan_label: 'Alpha', current_option_labels: ['Alpha', 'Beta'] };
    expect(checkMethodTurn('RC-PREMORTEM', text, inputs)).toEqual({ pass: true, failed: [], targets: ['f2', 'r1'] });
    expect(checkMethodTurn('RC-PREMORTEM', text.replace('F2', 'F20'), inputs).failed).toContain('PM-GROUNDED');
    expect(checkMethodTurn('RC-PREMORTEM', text.replace('F2', 'Beta F2'), inputs).failed).toContain('PM-PLAN-ONLY');
    expect(checkMethodTurn('RC-PREMORTEM', text.replace('Mitigate:', 'Next:'), inputs).failed).toContain('PM-WATCH-MITIGATE');
  });
  it('shared.label_masking: a ban word inside the user\u2019s own label is grounding; the same word in Olumi\u2019s text still fails', () => {
    expect(checkMethodTurn('RC-STRENGTHEN-ITEM', 'Edge compute cost changes revenue.', { item_labels: ['Edge compute cost', 'Revenue'] }).failed).not.toContain('ST-BANNED');
    expect(checkMethodTurn('RC-STRENGTHEN-ITEM', 'Edge compute cost changes revenue on this edge.', { item_labels: ['Edge compute cost', 'Revenue'] }).failed).toContain('ST-BANNED');
    const rx = { change_labels: ['Churn rose to plan'], attribution_case: 'C2_unpaired' as const, prior_withheld: true, current_option_labels: ['Best-of-breed vendor'], leader_licensed: false };
    expect(checkMethodTurn('RERUN-EXPLANATION', 'You changed Churn rose to plan. Best-of-breed vendor is one option.', rx)).toEqual({ pass: true, failed: [], targets: [] });
    expect(checkMethodTurn('RERUN-EXPLANATION', 'You changed Churn rose to plan. Best-of-breed vendor wins and churn rose.', rx).failed.sort()).toEqual(['RX-NO-LEADER-UNLICENSED', 'RX-NO-MOVEMENT-WITHOUT-PRIOR']);
  });
  it('masking and label matching are WHOLE-TOKEN: short labels never hide Olumi\u2019s own words (HARNESS #2478 P1 probes)', () => {
    const go = { current_option_labels: ['Go', 'No go'], model_labels: ['Go', 'No go'] };
    expect(checkMethodTurn('RC-PREMORTEM', 'The launch is going to fail.', go).failed).toContain('PM-NO-PREDICTION');
    expect(checkMethodTurn('RC-PREMORTEM', 'There is a high probability of this.', { current_option_labels: ['A'], model_labels: ['A'] }).failed).toContain('PM-NO-PROB');
    const lead = { current_option_labels: ['Raise price'], model_labels: ['Lead', 'Raise price'], leader_licensed: false };
    expect(checkMethodTurn('RERUN-EXPLANATION', '\u2018Raise price\u2019 now leads.', lead).failed).toContain('RX-NO-LEADER-UNLICENSED');
    // Control: the whole label is still masked.
    expect(checkMethodTurn('RERUN-EXPLANATION', '\u2018Raise price\u2019 changes Lead.', lead).failed).not.toContain('RX-NO-LEADER-UNLICENSED');
  });
  it('Coach edits requires the stale line only for a stale run', () => {
    expect(checkMethodTurn('RC-COACH-EDITS', 'You changed cost. The analysis is out of date.', { edited_labels: ['Cost'], 'run.kind': 'complete_current' }).failed).toEqual(['CE-STALE-IFF']);
    expect(checkMethodTurn('RC-COACH-EDITS', 'You changed cost.', { edited_labels: ['Cost'], 'run.kind': 'complete_current' })).toEqual({ pass: true, failed: [], targets: [] });
  });
});
