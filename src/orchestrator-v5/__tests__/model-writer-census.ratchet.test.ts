import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SCRIPT = join(ROOT, 'scripts/census/model-writer-census.mjs');

// RATCHET: the outside-door count may ONLY DECREASE. Never raise it to admit a writer.
// Measured at CEE staging b33222d4047f82a995254ac81cf57ee6794d1479: 13 outside the door.
// A PR that moves a writer through the door must lower BASELINE in the same PR (stale-baseline row).
// Door callers are reported, not capped: routing a writer through the door raises that count.
const BASELINE = 13;

interface Site { file: string; line: number; kind: string; callee: string; reason?: string }
interface Census {
  outside_door: number;
  door_callers: number;
  sites: Site[];
  excluded: Site[];
  production_files: number;
  diagnostics: string[];
}

let measured: Census;

describe('model writer census ratchet', () => {
  beforeAll(() => {
    const json = execFileSync(process.execPath, [SCRIPT], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    });
    measured = JSON.parse(json) as Census;
  }, 120_000);

  it('outside-door writers may only decrease (door callers reported, not capped)', () => {
    expect(measured.outside_door, JSON.stringify(measured.sites, null, 2)).toBeLessThanOrEqual(BASELINE);
    expect(measured.production_files).toBeGreaterThan(300);
    process.stdout.write(`CENSUS outside_door=${measured.outside_door} door_callers=${measured.door_callers}\n`);
  });

  it('refuses a stale baseline: a fixed writer lowers BASELINE in the same PR', () => {
    expect(measured.outside_door, `lower baseline to ${measured.outside_door}`).toBe(BASELINE);
  });

  it('every production RPC must have resolved migration SQL or named deployed evidence', () => {
    expect(measured.diagnostics, 'An incomplete count cannot certify the single writer door').toEqual([]);
  });

  it('prints the real door append and its delegated RPCs as present but excluded', () => {
    const directAppend = measured.excluded.find(s => s.file.endsWith('/persist-graph-write.ts')
      && s.callee === 'store.append');
    const ownRpc = measured.excluded.find(s => s.file.endsWith('/session/supabase-store.ts')
      && s.kind === 'rpc' && s.callee === 'append_turn_atomic_v5');
    expect(directAppend?.reason).toBe('inside door implementation');
    expect(ownRpc?.reason).toBe('session implementation reached by door');
    expect(measured.sites.some(s => s.file === ownRpc?.file && s.line === ownRpc?.line)).toBe(false);
    process.stdout.write(`CONTRAST: present but excluded ${JSON.stringify({ directAppend, ownRpc })}\n`);
  });

  it('same AST run counts a planted direct RPC and excludes a fake door RPC', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'census-controls-'));
    const fixture = join(temp, 'fixture.ts');
    writeFileSync(fixture, [
      'declare const client: { rpc(name: string, args: object): void };',
      "client.rpc('append_turn_atomic_v5', {});",
      'export function appendCheckedGraphWrite() {',
      "  client.rpc('append_turn_atomic_v5', {});",
      '  function nested() {',
      "    client.rpc('append_turn_atomic_v4', {});",
      '  }',
      '  nested();',
      '}',
      'appendCheckedGraphWrite();',
      "// client.rpc('append_turn_atomic_v5', {});",
      "const prose = `client.rpc('append_turn_atomic_v5', {})`; void prose;",
      "client.rpc('census_unclassified_rpc_control', {});",
    ].join('\n'));
    // Import in a subprocess: avoid loading a compiler and service dependencies
    // into the Vitest worker. The fixture uses the exact production instrument.
    const driver = join(temp, 'control.mjs');
    writeFileSync(driver, [
      `import { census } from ${JSON.stringify(new URL('../../../scripts/census/model-writer-census.mjs', import.meta.url).href)};`,
      `console.log(JSON.stringify(census({ root: ${JSON.stringify(ROOT)},`,
      `  extraFiles: [${JSON.stringify(fixture)}], doorFile: ${JSON.stringify(relative(ROOT, fixture))} })));`,
    ].join('\n'));
    const controls = JSON.parse(execFileSync(process.execPath, [driver], {
      cwd: ROOT, encoding: 'utf8', timeout: 120_000,
    })) as Census;
    writeFileSync(join(temp, 'result.json'), JSON.stringify(controls, null, 2));
    const local = (s: Site) => s.file === relative(ROOT, fixture);
    expect(controls.sites.filter(local).filter(s => s.kind === 'rpc')).toEqual([
      { file: relative(ROOT, fixture), line: 2, kind: 'rpc', callee: 'append_turn_atomic_v5' },
    ]);
    expect(controls.excluded.filter(local).filter(s => s.kind === 'rpc')).toHaveLength(2);
    expect(controls.sites.filter(local).filter(s => s.kind === 'door_caller')).toHaveLength(1);
    expect(controls.diagnostics).toEqual([
      `${relative(ROOT, fixture)}:13: no migration SQL for RPC census_unclassified_rpc_control`,
    ]);
    // No changes to production files in this fixture run.
    expect(readFileSync(fixture, 'utf8')).toContain('function nested()');
    process.stdout.write('CONTROLS: direct RPC counted; fake door RPCs excluded; prose ignored; unknown RPC unresolved '
      + JSON.stringify({ sites: controls.sites.filter(local), excluded: controls.excluded.filter(local) }) + '\n');
  }, 120_000);
});
