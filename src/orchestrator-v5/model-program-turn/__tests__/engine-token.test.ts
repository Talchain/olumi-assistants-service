/**
 * R11: a stored Run's engine token is the hash of the engine's own modules, read once at start-up, never a hand-bumped literal.
 * So when an engine module changes, a Run computed before it reads as "from before an update" on reopen. Real path: the
 * module's own start-up read, then a copy of exactly those files laid out as they run, with one byte changed.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ENGINE_VERSIONS, engineFilesBeside, engineToken } from '../run-receipt.js';
import { MODEL_PROGRAM, reopenProgram } from '../program-store.js';
import { withNewRun } from '../program-save.js';
import { seedOf } from '../evaluate.js';
import { bakery, BRIEF } from './bakery.fixture.js';

type Json = Record<string, any>;
const HERE = new URL('../run-receipt.ts', import.meta.url).href;
const tmp = mkdtempSync(join(tmpdir(), 'olumi-engine-token-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('the engine token is the engine modules\' bytes (R11)', () => {
  it('is read from the engine modules that run, and is what a new Run carries', () => {
    expect(engineFilesBeside(HERE).map((f) => f.path).sort()).toEqual([
      'agent-lane/say-figure.ts', 'goal-target/goal-chance-display.ts', 'goal-target/goal-chance-driver.ts', 'goal-target/goal-target-basis.ts',
      'goal-target/goal-targets-joint.ts', 'model-program-turn/evaluate.ts', 'model-program/canonical.ts', 'model-program/compile.ts',
      'model-program/executable.ts', 'model-program/links.ts', 'model-program/present/present.ts', 'model-program/present/tipping.ts', 'model-program/project.ts', 'model-program/simulate/prng.ts',
      'model-program/simulate/range-law.ts', 'model-program/simulate/result.ts', 'model-program/simulate/simulate.ts', 'model-program/units.ts',
    ]);
    expect(ENGINE_VERSIONS.engine).toMatch(/^mp-[0-9a-f]{12}$/);
    expect(ENGINE_VERSIONS.engine).toBe(engineToken(engineFilesBeside(HERE)));
  });

  it('one engine byte changed gives a new token, and a Run stored on the old one reads as from before an update; identical bytes give the identical token', () => {
    for (const f of engineFilesBeside(HERE)) { mkdirSync(dirname(join(tmp, f.path)), { recursive: true }); writeFileSync(join(tmp, f.path), f.bytes); }
    const copy = pathToFileURL(join(tmp, 'model-program-turn', 'run-receipt.ts')).href;
    const before = engineToken(engineFilesBeside(copy));
    // Contrast: the same bytes read from another place give the same token as the running engine's.
    expect(before).toBe(ENGINE_VERSIONS.engine);
    const compiled = join(tmp, 'model-program', 'compile.ts');
    const bytes = readFileSync(compiled);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    writeFileSync(compiled, bytes);
    const after = engineToken(engineFilesBeside(copy));
    expect(after).toMatch(/^mp-[0-9a-f]{12}$/);
    expect(after).not.toBe(before);

    const { graph, run } = withNewRun({ model_program: MODEL_PROGRAM, canonical: bakery(), seed: seedOf('r11-engine-token'), person_words: [BRIEF], runs: [] });
    expect(run.receipt.versions.engine).toBe(before);
    const stored = JSON.parse(JSON.stringify(graph)) as Json;
    const same = reopenProgram(stored, { ...ENGINE_VERSIONS, engine: before })!;
    expect([same.current, same.engine_current, (same.view as Json).staleness.stale]).toEqual([true, true, false]);
    const updated = reopenProgram(stored, { ...ENGINE_VERSIONS, engine: after })!;
    expect([updated.run!.run_id, updated.current, updated.engine_current]).toEqual([run.run_id, true, false]);
    expect([(updated.view as Json).staleness.stale, (updated.view as Json).staleness.reason]).toEqual([true, 'engine_or_format_updated']);
    expect((updated.view as Json).face_when_stale).toBe('This result is from before an update. Run again to see the chance.');
  });
});
