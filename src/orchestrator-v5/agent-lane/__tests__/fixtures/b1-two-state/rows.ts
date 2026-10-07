import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { composeProposalReply } from '../../../proposal-reply.js';
import { sayFigure, sayFigureExactly, sayFigureRead, sayFigureAsWritten, twoStateLevelWords } from '../../../say-figure.js';
import { figureInUserUnits } from '../../../approval-chips.js';
import { formatFactorValue, formatFactorValueApprox } from '../../../../compose/format-factor-value.js';
import { buildWarrantDemotion } from '../../../../compose/warrant-demotion.js';
import type { ProposalAction } from '../../../../routing/types.js';

const original = readFileSync(new URL('./WIDEN.wire.txt', import.meta.url), 'utf8');
const wire = JSON.parse(readFileSync(new URL('./turn-004-WIDEN-1791343253849.json', import.meta.url), 'utf8'));
// The capture retains the reply, not the internal tool result. Reconstruct only the typed fields it discloses.
const paragraphs = original.trimEnd().split('\n\n');
const result = {
  ok: true, mutated: false, proposal_id: 'capture-replay', public_label: 'Approve 4 changes',
  held_message: `Yes, ${paragraphs[0]!.slice('I’ve prepared this change: '.length)}`,
  levels: [
    { factor: 'Price rise', value: 10, unit: '%', stated_by: 'olumi_estimate', basis: paragraphs[1]!.split('Olumi’s estimate (')[1]!.split('), for you to correct.')[0] },
    { factor: 'Starter tier launched', value: 1, unit: '0/1', stated_by: 'olumi_estimate', basis: paragraphs[2]!.split('Olumi’s estimate (')[1]!.split('), for you to correct.')[0] },
  ],
};
const compose = (r: unknown, tool = 'propose_new_option') => composeProposalReply(tool, { whole_request: true }, r, 'Suggest options');
const optionLevel = (value: number, unit?: string) => ({
  ok: true, mutated: false, proposal_id: 'option-level', public_label: 'Set switch',
  interventions: [{ option: 'Launch', factor: 'Starter tier launched', value, unit, stated_by: 'olumi_estimate', basis: 'Suggested switch.' }],
});
export const rows: readonly { name: string; check: () => void }[] = [
  { name: 'w10b-2 capture: switched on; all other reply bytes unchanged', check: () => {
    assert.equal(wire.assistant_text, original.trimEnd());
    const actual = compose(result);
    assert.equal(actual, original.trimEnd().replace('is set to 1 0 / 1', 'is switched on'));
    assert.ok(!actual!.includes('0 / 1'));
  } },
  { name: 'value 0 is switched off', check: () => {
    assert.ok(compose({ ...result, levels: [{ ...result.levels[1], value: 0 }] })!.includes('‘Starter tier launched’ is switched off, Olumi’s estimate'));
  } },
  ...['binary', 'yes/no', 'on/off', 'true/false', '0/1', '0 / 1', 'boolean'].map((unit) => ({ name: `typed ${unit}: both states and every shared formatter`, check: () => {
    for (const value of [0, 1]) {
      const state = value === 1 ? 'on' : 'off';
      assert.ok(compose(optionLevel(value, unit), 'propose_option_interventions')!.includes(`‘Starter tier launched’ under ‘Launch’ is switched ${state},`));
      for (const format of [sayFigure, sayFigureExactly, sayFigureRead, sayFigureAsWritten, figureInUserUnits]) assert.equal(format(value, unit), state);
      assert.equal(formatFactorValue(value, unit)?.display, state);
      assert.deepEqual(formatFactorValueApprox(value, unit), { display: state, rounded: value, approximate: false });
    }
  } })),
  { name: 'unitless switch created by options; mixed nonbinary values remain numeric', check: () => {
    assert.ok(compose({ ...result, levels: [{ ...result.levels[1], unit: undefined }] })!.includes('is switched on,'));
    assert.ok(compose(optionLevel(0), 'propose_option_interventions')!.includes('is switched off,'));
    const mixed = optionLevel(1);
    mixed.interventions.push({ ...mixed.interventions[0]!, value: 2 });
    assert.ok(compose(mixed, 'propose_option_interventions')!.includes('is set to 1,'));
  } },
  { name: 'hires at 1 remain 1 hire; £ proposal is byte-identical', check: () => {
    for (const [value, unit, figure] of [[1, 'hires', '1 hire'], [15000, '£ over 6 months', '£15,000 over 6 months']] as const) {
      const r = { ...result, levels: [{ factor: 'X', value, unit, stated_by: 'olumi_estimate', basis: 'B' }] };
      assert.equal(compose(r), `I’ve prepared this change: ${paragraphs[0]!.slice('I’ve prepared this change: '.length)}\n\n‘X’ is set to ${figure}, Olumi’s estimate (B), for you to correct.\n\nApprove these 4 changes?`);
    }
  } },
  { name: 'new-factor user and pairing replies say the switch', check: () => {
    for (const stated_by of ['user', 'user_to_confirm']) {
      const actual = compose({ ok: true, mutated: false, proposal_id: 'factor', held_message: 'Yes, add X.', factors: [{ label: 'X', affects: 'Y', current_value: { value: 1, unit: 'binary', stated_by, quote: 'on' }, how_strongly: 'not known yet: Olumi uses a placeholder strength for the link, not an estimate' }] }, 'propose_new_factor');
      assert.ok(actual!.includes(stated_by === 'user' ? '‘X’ is switched on,' : '‘X’: on,'));
    }
  } },
  { name: 'factor-value warrant demotion says off/on', check: () => {
    for (const value of [0, 1]) {
      const action = { handler_id: 'set_factor_value', entity: { id: 'switch', kind: 'node', label: 'X', resolution_status: 'resolved', resolution_method: 'label_match' }, parameters: [{ name: 'value', value: { value, unit: 'binary' }, source: 'user_explicit', operator: 'set' }], cited_context_fields: [] } as ProposalAction;
      const built = buildWarrantDemotion(action, []);
      assert.equal(built.ok && built.changeDescription, `setting "X" to ${value === 1 ? 'on' : 'off'}`);
    }
  } },
  { name: 'ordinary shared-format outputs retain their bytes; nonstates stay numeric', check: () => {
    assert.equal(sayFigure(1, 'hires'), '1 hires'); // preserve this formatter's existing count policy
    for (const format of [sayFigureExactly, sayFigureRead, sayFigureAsWritten, figureInUserUnits]) assert.equal(format(1, 'hires'), '1 hire');
    assert.equal(sayFigureExactly(58.8, 'GBP/month'), '£58.80 / month');
    assert.deepEqual(formatFactorValue(15000, '£'), { display: '£15,000', value: 15000 });
    assert.deepEqual(formatFactorValueApprox(58.8, '£'), { display: '£58.8', rounded: 58.8, approximate: false });
    assert.equal(twoStateLevelWords(2, 'binary'), null);
    assert.equal(twoStateLevelWords(1, 'hires', [{ kind: 'option', interventions: { X: 1 } }], 'X'), null);
  } },
];
