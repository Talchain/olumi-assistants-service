/** Compiler-API census of our sentence literals; never reads runtime/user text. */
import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';
import { CLASS_MARKERS, type ClaimLicenceEntry } from '../../src/orchestrator-v5/claims/claim-licence-registry.js';

export interface DiscoveredClaimOwner {
  owner: string;
  literals: string[];
}

export function discoverClaimOwners(root: string): DiscoveredClaimOwner[] {
  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'fixtures') continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name !== 'claim-licence-registry.ts' && entry.name.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(entry.name)) files.push(path);
    }
  };
  walk(resolve(root, 'src/orchestrator-v5'));
  files.push(resolve(root, 'src/routes/agent-v1-turn.ts'));
  const markers = Object.values(CLASS_MARKERS).flat();
  const owners = new Map<string, Set<string>>();
  for (const file of files.sort()) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        const value = node.text;
        if (markers.some(marker => value.toLowerCase().includes(marker))) {
          // Use the top-level sentence owner, not local fragments; split each lens body.
          let ancestor: ts.Node | undefined = node;
          let symbol = '<module>';
          let lensKey: string | undefined;
          while (ancestor && !ts.isSourceFile(ancestor)) {
            if (ts.isPropertyAssignment(ancestor) && ts.isIdentifier(ancestor.name)) lensKey = ancestor.name.text;
            if ((ts.isFunctionDeclaration(ancestor) || ts.isVariableDeclaration(ancestor)) && ancestor.name
              && ts.isIdentifier(ancestor.name)) symbol = ancestor.name.text;
            ancestor = ancestor.parent;
          }
          if (symbol === 'BODY_BY_RATIONALE' && lensKey) symbol += `.${lensKey}`;
          const owner = `${relative(root, file).replaceAll('\\', '/')}#${symbol}`;
          if (!owners.has(owner)) owners.set(owner, new Set());
          owners.get(owner)!.add(value);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return [...owners].map(([owner, literals]) => ({ owner, literals: [...literals] }));
}

/** Exact set equality: new nulls fail; licensed or deleted baseline entries must be removed. */
export function claimLicenceRatchetFailures(entries: readonly ClaimLicenceEntry[], baseline: readonly string[]): {
  newUnlicensed: string[]; staleBaseline: string[];
} {
  const unlicensed = entries.filter(e => e.class !== 'not_a_claim' && e.licence === null).map(e => e.id);
  return {
    newUnlicensed: unlicensed.filter(id => !baseline.includes(id)),
    staleBaseline: baseline.filter(id => !unlicensed.includes(id)),
  };
}
