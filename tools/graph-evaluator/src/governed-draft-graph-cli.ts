import {
  assertLegacyRubricIdentity,
  verifyGovernedPack,
} from "./governed-draft-graph.js";

async function main(): Promise<void> {
  const emitJson = process.argv.slice(2).includes("--json");
  const unknown = process.argv.slice(2).filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    throw new Error(`unknown argument(s): ${unknown.join(", ")}`);
  }
  const verification = await verifyGovernedPack();
  assertLegacyRubricIdentity(verification.manifest);
  if (emitJson) {
    process.stdout.write(`${JSON.stringify(verification, null, 2)}\n`);
  } else if (verification.ok) {
    process.stdout.write(
      [
        "Governed draft_graph pack: VERIFIED",
        `Serving base: ${verification.manifest.serving.git_sha}`,
        `Prompt: ${verification.manifest.prompt.prompt_id}@v${verification.manifest.prompt.store_version} (${verification.prompt_sha256})`,
        `Model: ${verification.manifest.model.provider}/${verification.manifest.model.model_id}`,
        `Corpus: ${verification.brief_ids.length} pinned briefs`,
        `Candidate: ${verification.manifest.candidate_status}`,
      ].join("\n") + "\n",
    );
  } else {
    for (const item of verification.problems) {
      process.stderr.write(`${item.code}: ${item.detail}\n`);
    }
    process.exitCode = 1;
  }
}

await main();
