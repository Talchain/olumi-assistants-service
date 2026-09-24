/**
 * Re-derives the route's prompt constants FROM THE SOURCE TEXT at the pinned commit,
 * independently of the module that builds the request — so "the captured instructions
 * are what 57f903c serves" is checked against the file, not against itself.
 */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`source marker not found: ${start}`);
  const j = src.indexOf(end, i + start.length);
  if (j < 0) throw new Error(`source end marker not found after ${start}: ${end}`);
  return src.slice(i, j + end.length);
}

export interface SourcePrompts {
  readonly agent_instructions: string;
  readonly interpret_only: string;
  readonly interpreter_v02: string;
  readonly fast_path_3_instructions: string;
  readonly sha256: { agent_instructions: string; interpret_only: string; interpreter_v02: string; fast_path_3_instructions: string };
}

export function promptsFromSource(routeFile: string): SourcePrompts {
  const src = readFileSync(routeFile, 'utf8');
  // Full (non-preview) mode, as served: AGENT_LANE_PREVIEW=false.
  const mutation = slice(src, 'const MUTATION_INSTRUCTION =', ';\n');
  const agent = slice(src, 'const AGENT_INSTRUCTIONS = [', "].join(' ');");
  const interp = slice(src, 'export const INTERPRET_ONLY_CONSTRAINT =', ';\n');
  const v02 = slice(src, 'export const INTERPRETER_V02_BANKED: string =', ';\n').replace('export const INTERPRETER_V02_BANKED: string =', 'INTERPRETER_V02_BANKED =');
  const ctx: Record<string, unknown> = { config: { proxy: { agentLanePreview: false } } };
  runInNewContext(`${mutation.replace('const MUTATION_INSTRUCTION =', 'MUTATION_INSTRUCTION =')}`, ctx);
  runInNewContext(`${agent.replace('const AGENT_INSTRUCTIONS =', 'AGENT_INSTRUCTIONS =')}`, ctx);
  runInNewContext(`${interp.replace('export const INTERPRET_ONLY_CONSTRAINT =', 'INTERPRET_ONLY_CONSTRAINT =')}`, ctx);
  runInNewContext(v02, ctx);
  const a = String(ctx['AGENT_INSTRUCTIONS']);
  const i = String(ctx['INTERPRET_ONLY_CONSTRAINT']);
  const v = String(ctx['INTERPRETER_V02_BANKED']);
  const fp3 = `${a}\n\n${i}\n\n${v}`;
  return {
    agent_instructions: a, interpret_only: i, interpreter_v02: v, fast_path_3_instructions: fp3,
    sha256: { agent_instructions: sha(a), interpret_only: sha(i), interpreter_v02: sha(v), fast_path_3_instructions: sha(fp3) },
  };
}
