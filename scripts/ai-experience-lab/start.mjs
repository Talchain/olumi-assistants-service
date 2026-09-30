/** Local-only launcher: reuse an existing OpenAI key without copying credentials. */
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../../', import.meta.url));
let key = process.env.OPENAI_API_KEY?.trim();
if (!key && process.env.OPENAI_ENV_FILE) {
  key = parse(readFileSync(process.env.OPENAI_ENV_FILE, 'utf8')).OPENAI_API_KEY?.trim();
}
if (!key) throw new Error('No existing OpenAI key found. Supply OPENAI_API_KEY or OPENAI_ENV_FILE; never put the key in a command argument.');
const evidence = resolve(process.env.AI_EXPERIENCE_LAB_OUTPUT ?? resolve(root, 'output/ai-experience-lab'));
mkdirSync(evidence, { recursive: true });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const files = ['src/orchestrator-v5/agent-lane/__tests__/ai-experience-lab.manual.test.ts',
  'src/routes/agent-v1-turn.ts',
  'src/orchestrator-v5/agent-lane/model-budgets.ts',
  'src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts',
  'src/orchestrator-v5/agent-lane/runtime/build-model.ts',
  'src/routes/assist.v1.scenario-graph-register.ts',
  'src/routes/assist.v1.scenario-graph.ts',
  'src/routes/assist.v1.scenario-versions.ts',
  'scripts/ai-experience-lab/index.html', 'scripts/ai-experience-lab/pricing-fixture.json', 'scripts/ai-experience-lab/start.mjs',
  'scripts/ai-experience-lab/rehearsal.json', 'scripts/ai-experience-lab/rehearsal.mjs', 'scripts/ai-experience-lab/rehearsal-ui.mjs',
  'scripts/ai-experience-lab/regions-cases.json',
  'scripts/ai-experience-lab/canonical-m1-guard.mjs',
  'scripts/ai-experience-lab/m2-runner.mjs',
  'scripts/m1-host-seam/readback.mjs',
  'scripts/m1-host-seam/readback.test.mjs',
  'scripts/m1-host-seam/witness.mjs',
  'scripts/ai-experience-lab/pinned-runtime/artefact-runtime/canonical.ts',
  'scripts/ai-experience-lab/pinned-runtime/artefact-runtime/evals/mm-1/package.ts',
  'scripts/ai-experience-lab/pinned-runtime/artefact-runtime/evals/mm-1/sealed-provider-pack.ts'];
const hash = createHash('sha256');
for (const path of files) hash.update(path).update(readFileSync(resolve(root, path)));
const env = {};
for (const name of ['PATH', 'HOME', 'USER', 'TMPDIR', 'LANG', 'SHELL']) {
  if (process.env[name]) env[name] = process.env[name];
}
Object.assign(env, {
  OPENAI_API_KEY: key, LLM_PROVIDER: 'openai', NODE_ENV: 'test',
  RUN_AI_EXPERIENCE_LAB: '1', AGENT_LANE_ENABLED: 'true', AGENT_LANE_PREVIEW: 'false',
  AI_EXPERIENCE_LAB_HEAD: head, AI_EXPERIENCE_LAB_SOURCE_HASH: hash.digest('hex'),
  AI_EXPERIENCE_LAB_PORT: process.env.AI_EXPERIENCE_LAB_PORT ?? '8793',
  AI_EXPERIENCE_LAB_EVIDENCE: resolve(evidence, 'turn-receipts.jsonl'),
  AI_EXPERIENCE_LAB_M2_ENABLED: process.env.AI_EXPERIENCE_LAB_M2_ENABLED === '1' ? '1' : '0',
  AI_EXPERIENCE_LAB_M2_EVIDENCE: resolve(evidence, 'm2-receipts.jsonl'),
});
if (process.env.LAB_CEE_BASE) {
  env.LAB_CEE_BASE = process.env.LAB_CEE_BASE;
  if (process.env.LAB_ASSIST_ENV_FILE) env.LAB_ASSIST_ENV_FILE = process.env.LAB_ASSIST_ENV_FILE;
  if (process.env.LAB_ACCOUNT_FILE) env.LAB_ACCOUNT_FILE = process.env.LAB_ACCOUNT_FILE;
} else {
  env.CEE_MODEL_VERSIONS_ENABLED = 'false';
  env.CEE_IDENTITY_MODE = 'off';
}
const vitest = resolve(root, 'node_modules/vitest/vitest.mjs');
if (!existsSync(vitest)) throw new Error('Install the locked dependencies before starting the lab.');
const child = spawn(process.execPath, [vitest, 'run', files[0], '--maxWorkers=1'], {
  cwd: root, env, stdio: 'inherit',
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('exit', code => { process.exitCode = code ?? 0; });
