// Branch-only integration follow-up. Original source patch is committed at 732d392d.
import { readFileSync, writeFileSync } from 'node:fs';
const routePath = 'src/routes/agent-v1-turn.ts';
const route = readFileSync(routePath, 'utf8');
const loop = readFileSync('src/orchestrator-v5/agent-lane/runtime/agent-loop.ts', 'utf8');
if (!route.includes('nativeTurn?.finish(') || !loop.includes('readonly nativeContext?:')) {
  throw new Error('Native integration is missing; inspect the isolated branch before proceeding.');
}
const oldCall = 'nativeContextTrialEnabled(process.env)';
const newCall = 'nativeContextTrialEnabled(nativeContextTrialEnvironment())';
const configImport = "import { nativeContextTrialEnvironment } from '../config/native-context-trial.js';\n";
if (route.includes(oldCall)) {
  if (route.split(oldCall).length !== 2) throw new Error('Expected exactly one trial opt-in.');
  writeFileSync(routePath, configImport + route.replace(oldCall, newCall));
  console.log('Trial environment now crosses the configuration boundary.');
} else if (route.includes(newCall) && route.includes(configImport.trim())) {
  console.log('Native context integration already applied; no files changed.');
} else {
  throw new Error('Unexpected trial configuration shape.');
}
