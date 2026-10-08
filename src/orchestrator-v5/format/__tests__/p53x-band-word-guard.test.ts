import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

const helper = 'src/orchestrator-v5/format/edge-strength-words.ts';
// Every exception is class (b) in p53x-class.md. Words describing stored edges must use the helper instead.
const arithmetic = [
  // Validate the proposed band against the current magnitude for an amendment.
  ['src/orchestrator-v5/agent-lane/proposal-object/amend.ts', 'amendAgentProposal', 'edgeBandFromMagnitude(currentMagnitude)'],
  // Required _proposal_fields current.band wire enum; protected record stays unchanged.
  ['src/orchestrator-v5/agent-lane/proposal-object/record.ts', 'linkField', 'edgeBandFromMagnitude(Math.abs(mean))'],
  // Validate the user's named band matches the proposed numeric write.
  ['src/orchestrator-v5/agent-lane/stated-link-band-context.ts', 'statedLinkBandFor', 'edgeBandFromMagnitude(Math.abs(magnitude))'],
  // A provenance-only confirmation must preserve the current band.
  ['src/orchestrator-v5/system-events/edge-strength-edit.ts', 'isProvenanceOnlyEdgeConfirmation', 'edgeBandFromMagnitude(Math.abs(beforeEdge.strength.mean))'],
  // The requested numeric write is a proposed band, not a description of a stored prior.
  ['src/orchestrator-v5/system-events/edge-strength-edit.ts', 'applyEdgeStrengthEdit', 'edgeBandFromMagnitude(Math.abs(target.mean))'],
  // Reject numeric writes inconsistent with the expressly named band.
  ['src/orchestrator-v5/tools/handlers/adjust-edge-strength.ts', 'adjustEdgeStrengthHandler', 'edgeBandFromMagnitude(Math.abs(newMean))'],
  // Run snapshot band enum is recorded on the existing wire, not voiced here.
  ['src/orchestrator-v5/tools/handlers/run-input-snapshot.ts', 'buildRunInputSnapshot', 'edgeBandFromMagnitude(Math.abs(mean))'],
  // Compare the current magnitude to the singular proposal's band for write/review.
  ['src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts', 'proposeLinkStrength', 'edgeBandFromMagnitude(Math.abs(mean))'],
  // Compare current magnitudes to the plural proposal's bands for write/review.
  ['src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts', 'proposeLinkStrengths', 'edgeBandFromMagnitude(Math.abs(mean))'],
  // Internal proposal target enum; placeholders are excluded before this calculation.
  ['src/orchestrator-v5/agent-lane/guidance/select-strengthen-placeholder.ts', 'linkTargetOf', 'edgeBandFromMagnitude(Math.abs(mean))'],
  // Proposed add-edge ghost band enum on the existing wire.
  ['src/orchestrator-v5/agent-lane/turn-context/proposal-preview.ts', 'proposalPreviewFor', 'edgeBandFromMagnitude(Math.abs(magnitude))'],
  // Compare first-pass edge strength to the adjusted estimate for contested metadata.
  ['src/cee/validation-pipeline/comparison.ts', 'compareEdge', 'strengthBand(Math.abs(p1Mean))'],
  // The second-pass strength band is likewise comparison arithmetic, not user prose.
  ['src/cee/validation-pipeline/comparison.ts', 'compareEdge', 'strengthBand(Math.abs(p2Mean))'],
] as const;

// These class (c) sites translate an explicit proposed/recorded band, never a stored edge mean.
// The final class (b) site words the requested numeric write. New map readers require a fresh census.
const explicitBandWords = [
  // The approved interpretation of the user's own words.
  ['src/orchestrator-v5/agent-lane/approval-chips.ts', 'readingShownFor', 'CANVAS_BAND_WORD[stored.reading as InfluenceBand]'],
  // Recorded Run-delta band enum, with historical sizing gates at the caller.
  ['src/orchestrator-v5/agent-lane/rerun-explanation.ts', 'bandWord', 'CANVAS_BAND_WORD[edgeBandFromStrengthBand(raw as Parameters<typeof edgeBandFromStrengthBand>[0])]'],
  // Authored within-band Run row, already excluded for placeholders at its producer.
  ['src/orchestrator-v5/agent-lane/rerun-explanation.ts', 'rerunExplanationPlan', 'CANVAS_BAND_WORD[edgeBandFromStrengthBand(m.band)]'],
  // Explicit proposed/user band vocabulary; stored prior-word callers now use the helper.
  ['src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts', 'linkBandWord', 'CANVAS_BAND_WORD[band]'],
  // Model-change proposal names the band it offers, not the stored link's prior.
  ['src/orchestrator-v5/agent-lane/runtime/agent-capabilities.ts', 'proposeModelChange', 'CANVAS_BAND_WORD[band]'],
  // Closed display phrase weak-to-slight normalization; projectEdge gates placeholder sizing first.
  ['src/orchestrator-v5/format/format-graph-for-context.ts', 'asAllowedRelationship', 'CANVAS_BAND_WORD.weak'],
  // Class (b): explicit proposed numeric event target, never the stored before-edge.
  ['src/orchestrator-v5/system-events/edge-strength-edit.ts', 'applyEdgeStrengthEdit', 'CANVAS_BAND_WORD[statedBand ?? edgeBandFromMagnitude(Math.abs(target.mean))]'],
] as const;

const normalize = (text: string): string => text.replace(/\s+/g, '');
const key = (file: string, owner: string, call: string): string => `${file}::${owner}::${normalize(call)}`;

function ownerOf(node: ts.Node, source: ts.SourceFile): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if ((ts.isFunctionDeclaration(parent) || ts.isFunctionExpression(parent) || ts.isMethodDeclaration(parent)) && parent.name) return parent.name.getText(source);
    if (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) {
      if (ts.isPropertyAssignment(parent.parent)) return parent.parent.name.getText(source);
      if (ts.isVariableDeclaration(parent.parent)) return parent.parent.name.getText(source);
    }
  }
  return '<top-level>';
}

function bandMeanCalls(file: string, text: string): string[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const aliases = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const binding of bindings.elements) aliases.set(binding.name.text, binding.propertyName?.text ?? binding.name.text);
    }
  }
  const found: string[] = [];
  const nameOf = (expression: ts.Expression): string => {
    const local = ts.isIdentifier(expression) ? expression.text
      : ts.isPropertyAccessExpression(expression) ? expression.name.text
        : ts.isElementAccessExpression(expression) && ts.isStringLiteral(expression.argumentExpression) ? expression.argumentExpression.text : '';
    return aliases.get(local) ?? local;
  };
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const local = ts.isIdentifier(expression) ? expression.text : '';
      const callee = nameOf(expression);
      if (callee === 'edgeBandFromMagnitude' || callee === 'strengthBand' || /^describeBand[A-Za-z]*$/.test(callee)
        || ['relationshipPhrase', 'bidirectedRelationshipPhrase', 'formatEdgeStrengthMagnitude'].includes(callee)) {
        const call = node.getText(source);
        // Normalize a renamed import back to its authoritative converter name.
        found.push(key(file, ownerOf(node, source), ts.isIdentifier(expression) && local !== callee ? callee + call.slice(local.length) : call));
      }
    }
    if ((ts.isElementAccessExpression(node) || ts.isPropertyAccessExpression(node)) && nameOf(node.expression) === 'CANVAS_BAND_WORD') {
      const expression = node.expression;
      const access = node.getText(source);
      found.push(key(file, ownerOf(node, source), ts.isIdentifier(expression) && expression.text !== 'CANVAS_BAND_WORD'
        ? 'CANVAS_BAND_WORD' + access.slice(expression.text.length) : access));
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found;
}

function forbiddenCalls(file: string, text: string, used: Map<string, number> = new Map()): string[] {
  if (file === helper) return [];
  const allowed = new Set([...arithmetic, ...explicitBandWords].map(([path, owner, call]) => key(path, owner, call)));
  return bandMeanCalls(file, text).filter(call => {
    const count = (used.get(call) ?? 0) + 1;
    used.set(call, count);
    return !allowed.has(call) || count > 1;
  });
}

it('P53x AST: band-from-mean calls exist only in the sizing-aware helper or named arithmetic sites', () => {
  const forbidden: string[] = [];
  const used = new Map<string, number>();
  function scan(dir: string): void {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.name === '__tests__' || item.name === 'fixtures') continue;
      const path = join(dir, item.name);
      if (item.isDirectory()) { scan(path); continue; }
      if (!/\.tsx?$/.test(path) || /\.(test|spec)\.tsx?$/.test(path)) continue;
      forbidden.push(...forbiddenCalls(path, readFileSync(path, 'utf8'), used));
    }
  }
  scan('src');
  expect(forbidden).toEqual([]);
  // Keep the exceptions live: a moved/removed arithmetic site requires a reviewed census update too.
  expect([...used.keys()].sort()).toEqual([...arithmetic, ...explicitBandWords].map(([path, owner, call]) => key(path, owner, call)).sort());
});

it('P53x AST firing control detects forbidden, renamed and extra calls in an allowed function', () => {
  expect(forbiddenCalls('src/new-reader.ts', 'function voice(edge) { return edgeBandFromMagnitude(edge.strength.mean); }')).toHaveLength(1);
  expect(forbiddenCalls('src/new-reader.ts', "import { edgeBandFromMagnitude as band } from './bands.js'; function voice(edge) { return band(edge.strength.mean); }")).toHaveLength(1);
  expect(forbiddenCalls('src/new-reader.ts', 'function voice(mean) { return describeBandWithDirection(mean); }')).toHaveLength(1);
  expect(forbiddenCalls('src/new-reader.ts', 'function voice(edge) { return relationshipPhrase(edge.strength.mean); }')).toHaveLength(1);
  expect(forbiddenCalls('src/new-reader.ts', "function voice(edge) { return CANVAS_BAND_WORD[edge.strength.mean > .4 ? 'strong' : 'weak']; }")).toHaveLength(1);
  expect(forbiddenCalls('src/new-reader.ts', "import { CANVAS_BAND_WORD as words } from './bands.js'; function voice(edge) { return words[edge.strength.mean > .4 ? 'strong' : 'weak']; }")).toHaveLength(1);
  const [file, owner, call] = arithmetic[0];
  expect(forbiddenCalls(file, `function ${owner}() { ${call}; ${call}; }`)).toHaveLength(1);
});
