import { execFileSync } from 'node:child_process';
import { verifyJ3, verifyIdentity, verifyCertaintyEdges, verifyTargetBytes, verifyNamedGraphs, verifyUserStampExclusions } from './r3-cases.js';
import { verifyHandler } from './handler-r3.js';
verifyJ3(); verifyUserStampExclusions(); await verifyIdentity(); verifyCertaintyEdges(); verifyTargetBytes(); verifyNamedGraphs();
await verifyHandler();
execFileSync(process.execPath, ['--import', 'tsx', 'tools/limit-check-replay/replay.ts'], { stdio: 'pipe' });
const route = execFileSync(process.execPath, ['--import', 'tsx', 'tools/limit-check-replay/route-r3.ts'], { encoding: 'utf8' });
console.log(route.split('\n').filter(line => line.startsWith('Explain route')).join('\n'));
console.log('R3 GREEN: J3, declaration/evaluation, Run score and verdict folds, certainty edges, unchanged target fixtures, 3 named graphs, saved/Explain route and R2 controls');
