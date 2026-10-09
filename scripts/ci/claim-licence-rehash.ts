/**
 * Re-review a not_a_claim owner after its marker-bearing literals moved, in one step:
 *   npx tsx scripts/ci/claim-licence-rehash.ts '<owner>' ['<owner>' …]
 *   npx tsx scripts/ci/claim-licence-rehash.ts --prune   (drop registry rows whose owner no longer exists in src)
 * It prints the added/removed literals. Run it ONLY when none of the added literals reaches a user as a science claim;
 * otherwise register the owner as a claim (licence or declared gap) instead. Never touches claim entries.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverClaimOwners } from './claim-licence-discovery.js';

type Row = Record<string, unknown> & { owner: string; class: string; reviewedLiterals?: string[]; reviewedLiteralHash?: string };

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const path = resolve(root, 'scripts/ci/claim-licence-registry.json');
export const literalHash = (literals: readonly string[]): string => createHash('sha256').update(JSON.stringify(literals)).digest('hex');
export const writeRegistry = (rows: readonly Row[]): void =>
  writeFileSync(path, `[\n${rows.map(r => ` ${JSON.stringify(r)}`).join(',\n')}\n]\n`);

function main(args: string[]): number {
  const rows = JSON.parse(readFileSync(path, 'utf8')) as Row[];
  const found = new Map(discoverClaimOwners(root).map(f => [f.owner, f.literals]));
  if (args[0] === '--prune') {
    const gone = rows.filter(r => !found.has(r.owner));
    for (const r of gone) console.log(`pruned ${r.owner} (${r.class})`);
    if (gone.some(r => r.class !== 'not_a_claim')) {
      console.error('A CLAIM owner disappeared: remove its row and its baseline id by hand, after checking the sentence really left src.');
      return 1;
    }
    writeRegistry(rows.filter(r => found.has(r.owner)));
    return 0;
  }
  if (args.length === 0) { console.error('usage: claim-licence-rehash.ts <owner> [<owner> …] | --prune'); return 2; }
  for (const owner of args) {
    const row = rows.find(r => r.owner === owner);
    const literals = found.get(owner);
    if (row === undefined || literals === undefined) { console.error(`not in registry or not discovered: ${owner}`); return 1; }
    if (row.class !== 'not_a_claim') { console.error(`${owner} is a ${row.class} claim: change its licence, not its hash`); return 1; }
    const before = row.reviewedLiterals ?? [];
    console.log(`${owner}\n  added:   ${JSON.stringify(literals.filter(l => !before.includes(l)))}\n  removed: ${JSON.stringify(before.filter(l => !literals.includes(l)))}`);
    row.reviewedLiterals = literals;
    row.reviewedLiteralHash = literalHash(literals);
  }
  writeRegistry(rows);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
