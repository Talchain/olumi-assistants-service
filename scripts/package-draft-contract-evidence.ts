/**
 * Lossless, non-serving packaging of #1228's banked provider/consumer evidence.
 *
 * pnpm exec tsx scripts/package-draft-contract-evidence.ts --input /capture/dir --out evidence/prompt-consumer/8eb8e19-behaviour.json
 * pnpm exec tsx scripts/package-draft-contract-evidence.ts --verify evidence/prompt-consumer/8eb8e19-behaviour.json --replay
 * Add --case logistics-disagreement-diagnostic-1-candidate to print its decoded records, captures and consumed result.
 *
 * Requests retain full-object hashes and field hashes, not repeated prompt text.
 * Responses, emitted records, consumed results and original scores are retained
 * losslessly. Replay is the initial deterministic records seam, NOT a rerun of
 * the provider/adapter completion and repair path or an independent release gate.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { projectDraftRecords } from "../src/cee/draft/records/seam.js";
import { LLMDraftResponse } from "../src/adapters/llm/shared-schemas.js";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type ObjectJson = { [key: string]: Json };
const root = resolve(import.meta.dirname, "..");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const hash = (value: Json) => sha(JSON.stringify(value));
const obj = (value: Json): ObjectJson => {
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value), "expected JSON object");
  return value;
};
const str = (value: Json): string => { assert.equal(typeof value, "string"); return value as string; };
const list = (value: Json): Json[] => { assert.ok(Array.isArray(value)); return value; };
const read = (path: string): Json => JSON.parse(readFileSync(path, "utf8")) as Json;
const jsonValue = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;
const argument = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? undefined : process.argv[index + 1];
};
const componentPaths = [
  "src/cee/draft/records/grammar.ts", "src/cee/draft/records/seam.ts",
  "src/cee/draft/records/projector.ts", "src/adapters/llm/shared-schemas.ts",
] as const;

function exactIds(expected: string[], actual: string[]) {
  assert.equal(expected.length, 54, "full evidence requires 54 expected case IDs");
  assert.equal(new Set(actual).size, 54, "missing/duplicate evidence cases");
  assert.deepEqual([...actual].sort(), [...expected].sort(), "case collection differs from the frozen corpus");
}
function expectedIds(corpus: Json, repetitions: Json): string[] {
  assert.equal(repetitions, 3, "exploration n=1 is not the full evidence block");
  const pairs = list(corpus);
  assert.equal(pairs.length, 3);
  const ids = pairs.map(pair => str(obj(pair).id!));
  assert.equal(new Set(ids).size, 3);
  return ids.flatMap(id => ["diagnostic", "decision"].flatMap(direction =>
    [1, 2, 3].flatMap(repetition => ["incumbent", "candidate", "destroyed"].map(arm =>
      `${id}-${direction}-${repetition}-${arm}`))));
}

/** These are new deterministic observations, kept separate from the banked scores. */
function replay(raw: Json, brief: string, consumed: Json): Json {
  const seam = projectDraftRecords(raw, brief);
  const projected = seam.ok ? LLMDraftResponse.safeParse(seam.projection.graph) : undefined;
  const actualGraph = LLMDraftResponse.safeParse(obj(consumed).graph);
  return {
    initialSeamSha256: hash(jsonValue(seam)),
    initialParserAccepted: seam.ok,
    initialProjectionConsumerAccepted: projected?.success ?? false,
    initialProjectionConsumerIssues: projected && !projected.success ? jsonValue(projected.error.issues) : [],
    capturedConsumedGraphAccepted: actualGraph.success,
    capturedConsumedGraphIssues: actualGraph.success ? [] : jsonValue(actualGraph.error.issues),
  };
}

function compactRequest(request: Json): Json {
  const body = obj(request);
  const schema = body.output_config === undefined ? undefined : obj(obj(body.output_config).format!).schema;
  return {
    sha256: hash(request),
    parameters: Object.fromEntries(Object.entries(body).filter(([key]) => !["system", "messages", "output_config"].includes(key))),
    system: body.system === undefined ? null : list(body.system).map(block => {
      const text = str(obj(block).text!);
      return { sha256: sha(text), bytes: Buffer.byteLength(text), blockSha256: hash(block) };
    }),
    messagesSha256: hash(body.messages!),
    grammarSha256: schema === undefined ? null : hash(schema),
  };
}

/** Only repeated long strings are interned. Every other byte-level JSON value survives. */
function pack(value: Json): { strings: ObjectJson; value: Json } {
  const frequencies = new Map<string, number>();
  const visit = (entry: Json) => {
    if (typeof entry === "string" && entry.length >= 256) frequencies.set(entry, (frequencies.get(entry) ?? 0) + 1);
    else if (Array.isArray(entry)) entry.forEach(visit);
    else if (entry !== null && typeof entry === "object") {
      assert.ok(!Object.hasOwn(entry, "$evidenceText"), "reserved text-reference field in input");
      Object.values(entry).forEach(visit);
    }
  };
  visit(value);
  const strings: ObjectJson = {};
  const encode = (entry: Json): Json => {
    if (typeof entry === "string" && (frequencies.get(entry) ?? 0) > 1) {
      const key = sha(entry);
      strings[key] = entry;
      return { $evidenceText: key };
    }
    if (Array.isArray(entry)) return entry.map(encode);
    if (entry !== null && typeof entry === "object") return Object.fromEntries(Object.entries(entry).map(([key, item]) => [key, encode(item)]));
    return entry;
  };
  return { strings, value: encode(value) };
}
function unpack(value: Json, strings: ObjectJson): Json {
  if (Array.isArray(value)) return value.map(entry => unpack(entry, strings));
  if (value !== null && typeof value === "object") {
    if (Object.hasOwn(value, "$evidenceJson")) {
      assert.equal(Object.keys(value).length, 1, "ambiguous emitted-JSON reference");
      return JSON.parse(str(unpack(value.$evidenceJson!, strings))) as Json;
    }
    if (Object.hasOwn(value, "$evidenceText")) {
      assert.equal(Object.keys(value).length, 1, "ambiguous text reference");
      const key = str(value.$evidenceText!);
      const text = str(strings[key]!);
      assert.equal(sha(text), key, "shared text hash mismatch");
      return text;
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item, strings)]));
  }
  return value;
}

function verify(archive: Json, doReplay: boolean): Json {
  const envelope = obj(archive);
  assert.equal(envelope.format, "olumi.draft-contract-evidence.v1");
  const content = obj(unpack(envelope.content!, obj(envelope.strings!)));
  assert.equal(hash(content), envelope.contentSha256, "archive content hash mismatch");
  const identity = obj(content.identity!);
  assert.equal(hash(content.corpus!), identity.corpusSha256, "corpus is not the one measured");
  const cases = list(content.cases!);
  exactIds(expectedIds(content.corpus!, identity.repetitions!), cases.map(entry => str(obj(entry).id!)));
  if (doReplay) {
    for (const [path, digest] of Object.entries(obj(obj(content.deterministicReplay!).componentHashes!))) {
      assert.equal(sha(readFileSync(resolve(root, path), "utf8")), digest, `replay component changed: ${path}`);
    }
  }
  let captures = 0;
  for (const entry of cases) {
    const item = obj(entry);
    const scores = obj(item.scores!);
    assert.equal(item.id, scores.id);
    const direction = str(scores.direction!);
    const arm = str(scores.arm!);
    assert.ok(["diagnostic", "decision"].includes(direction));
    assert.ok(["incumbent", "candidate", "destroyed"].includes(arm));
    const pair = list(content.corpus!).find(candidate =>
      item.id === `${str(obj(candidate).id!)}-${direction}-${scores.repetition}-${arm}`);
    assert.ok(pair, `${item.id}: identity does not name a frozen corpus case`);
    assert.equal(item.brief, obj(pair)[direction], `${item.id}: brief changed`);
    assert.deepEqual(item.expectedActionSpans, obj(pair).actionSpans);
    assert.equal(hash(item.raw!), item.rawSha256, `${item.id}: raw record hash mismatch`);
    assert.equal(hash(item.consumed!), item.consumedSha256, `${item.id}: consumed result hash mismatch`);
    const calls = list(item.captures!);
    assert.equal(calls.length, scores.providerCalls, `${item.id}: provider capture count mismatch`);
    let firstDraft: Json | undefined;
    for (const [index, capture] of calls.entries()) {
      const call = obj(capture);
      assert.equal(hash(call.response!), call.responseSha256, `${item.id}: response hash mismatch`);
      const request = obj(call.request!);
      assert.match(str(request.sha256!), /^[a-f0-9]{64}$/);
      assert.equal(obj(request.parameters!).model, obj(identity.modelResolution!).resolved_model);
      assert.equal(obj(call.response!).model, list(scores.providerModels!)[index]);
      if (call.kind === "draft") {
        assert.equal(request.grammarSha256, identity.grammarSha256, `${item.id}: draft grammar identity changed`);
        const blocks = list(request.system!);
        if (arm !== "destroyed") {
          assert.equal(blocks.length, 2);
          assert.equal(obj(blocks[0]!).sha256, obj(arm === "incumbent" ? identity.servedPrompt! : identity.candidate!).sha256);
          assert.equal(obj(blocks[1]!).sha256, arm === "incumbent" ? identity.incumbentInstructionSha256 : identity.instructionSha256);
        } else assert.equal(blocks.length, 1, "destroyed control must not retain the appended instruction block");
      }
      if (call.kind === "draft" && firstDraft === undefined) firstDraft = call.response;
      captures++;
    }
    assert.ok(firstDraft, `${item.id}: no draft provider response`);
    const text = list(obj(firstDraft).content!).filter(block => obj(block).type === "text").map(block => str(obj(block).text!)).join("");
    assert.deepEqual(JSON.parse(text), item.raw, `${item.id}: emitted records differ from provider response`);
    if (doReplay) assert.deepEqual(replay(item.raw!, str(item.brief!), item.consumed!), item.replay, `${item.id}: deterministic replay changed`);
  }
  return { cases: cases.length, captures, archiveIntegrity: "PASS", deterministicReplay: doReplay ? "PASS" : "NOT_RUN", semanticVerdict: "UNVERIFIED: original scores and limitations are preserved; this is not independent semantic review" };
}

const verification = argument("verify");
if (verification) {
  const archive = read(resolve(verification));
  const result = verify(archive, process.argv.includes("--replay"));
  const caseId = argument("case");
  if (caseId) {
    const envelope = obj(archive);
    const content = obj(unpack(envelope.content!, obj(envelope.strings!)));
    const selected = list(content.cases!).find(entry => obj(entry).id === caseId);
    assert.ok(selected, `unknown case: ${caseId}`);
    console.log(JSON.stringify({ verification: result, case: selected }, null, 2));
  } else console.log(JSON.stringify(result, null, 2));
} else {
  const input = argument("input");
  const destination = argument("out");
  assert.ok(input && destination, "provide --input capture-directory and --out archive.json, or --verify archive.json");
  const source = resolve(input);
  const output = resolve(destination);
  assert.ok(!existsSync(output), `refusing to overwrite evidence: ${output}`);
  const identity = obj(read(resolve(source, "identity.json")));
  const summaries = obj(read(resolve(source, "summary.json")));
  assert.deepEqual(summaries.identity, identity);
  const corpus = read(resolve(root, "src/cee/draft/records/__tests__/fixtures/draft-intent-pairs.json"));
  assert.equal(hash(corpus), identity.corpusSha256);
  const ids = expectedIds(corpus, identity.repetitions!);
  exactIds(ids, readdirSync(source).filter(name => name.endsWith(".json") && !["identity.json", "summary.json"].includes(name)).map(name => name.slice(0, -5)));
  exactIds(ids, list(summaries.cases!).map(entry => str(obj(entry).id!)));
  const componentHashes = Object.fromEntries(componentPaths.map(path => {
    const bytes = readFileSync(resolve(root, path), "utf8");
    const recorded = execFileSync("git", ["show", `${str(identity.sourceHead!)}:${path}`], { cwd: root, encoding: "utf8" });
    assert.equal(sha(bytes), sha(recorded), `packaging replay differs from measured code: ${path}`);
    return [path, sha(bytes)];
  }));
  const cases = ids.map(id => {
    const path = resolve(source, `${id}.json`);
    const item = obj(read(path));
    assert.deepEqual(item.identity, identity, `${id}: identity changed within block`);
    assert.deepEqual(item.summary, list(summaries.cases!).find(entry => obj(entry).id === id));
    assert.ok(item.raw && item.consumed, `${id}: missing raw or actual consumed output`);
    return {
      id, sourceFileSha256: sha(readFileSync(path, "utf8")), brief: item.brief!, expectedActionSpans: item.expectedActionSpans!,
      scores: item.summary!, raw: item.raw, rawSha256: hash(item.raw), consumed: item.consumed, consumedSha256: hash(item.consumed),
      captures: list(item.captures!).map(entry => {
        const capture = obj(entry);
        assert.ok(capture.response, `${id}: missing provider response`);
        return { kind: capture.kind!, request: compactRequest(capture.request!), response: capture.response, responseSha256: hash(capture.response) };
      }),
      replay: replay(item.raw, str(item.brief!), item.consumed),
    };
  });
  const content: Json = {
    identity, corpus, cases,
    sourceFiles: { identitySha256: sha(readFileSync(resolve(source, "identity.json"), "utf8")), summarySha256: sha(readFileSync(resolve(source, "summary.json"), "utf8")) },
    deterministicReplay: { componentHashes, limitation: "Post-capture deterministic initial seam and schema validation only. Captured consumed graph is preserved, not reconstructed by this replay; provider completion/repair is not rerun." },
    hashConvention: "sha256 of UTF-8 JSON.stringify(object), except sourceFileSha256 and sourceFiles hashes which bind original file bytes. Full request bodies are omitted; captured request hashes and system/message/grammar hashes remain.",
  };
  // The raw record object is already present verbatim in the provider's text.
  // Preserve one copy of those bytes and decode the parsed view on verification.
  // Its original rawSha256 independently checks that this is lossless.
  const shared = structuredClone(content);
  for (const entry of list(obj(shared).cases!)) {
    const item = obj(entry);
    const first = list(item.captures!).find(capture => obj(capture).kind === "draft");
    assert.ok(first);
    const text = list(obj(obj(first).response!).content!).filter(block => obj(block).type === "text").map(block => str(obj(block).text!)).join("");
    assert.deepEqual(JSON.parse(text), item.raw);
    item.raw = { $evidenceJson: text };
  }
  const packed = pack(shared);
  const archive: Json = { format: "olumi.draft-contract-evidence.v1", contentSha256: hash(content), strings: packed.strings, content: packed.value };
  const validation = verify(archive, true);
  const bytes = JSON.stringify(archive) + "\n";
  const byteLength = Buffer.byteLength(bytes);
  assert.ok(byteLength < 1_000_000, `compact archive is ${byteLength} bytes; review before retaining a larger artifact`);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, bytes, { flag: "wx" });
  console.log(JSON.stringify({ output, bytes: byteLength, sha256: sha(bytes), validation }, null, 2));
}
