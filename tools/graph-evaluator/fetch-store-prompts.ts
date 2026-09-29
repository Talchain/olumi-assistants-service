/**
 * Fetches active prompts from Supabase prompt store and writes them
 * to the evaluator's prompts/ directory for benchmark runs.
 *
 * Usage: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx fetch-store-prompts.ts
 */
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const PROMPTS_DIR = join(import.meta.dirname ?? ".", "prompts");

const TASKS: Record<string, string> = {
  draft_graph: "draft_graph_default",
  edit_graph: "edit_graph_default",
  decision_review: "decision_review_default",
  orchestrator: "orchestrator_default",
};

async function query(path: string): Promise<unknown[]> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log("Fetching active prompts from Supabase store...\n");

  // Get active versions for our tasks
  const prompts = (await query(
    `cee_prompts?select=id,task_id,staging_version,active_version&id=in.(${Object.values(TASKS).join(",")})`
  )) as Array<{ id: string; task_id: string; staging_version: number | null; active_version: number }>;

  for (const [task, promptId] of Object.entries(TASKS)) {
    const prompt = prompts.find((p) => p.id === promptId);
    if (!prompt) {
      console.error(`[${task}] No prompt found`);
      continue;
    }

    // Prefer staging_version, fall back to active_version
    const version = prompt.staging_version ?? prompt.active_version;
    console.log(`[${task}] Fetching v${version} from ${promptId}...`);

    const versions = (await query(
      `cee_prompt_versions?select=content,content_hash&prompt_id=eq.${promptId}&version=eq.${version}&limit=1`
    )) as Array<{ content: string; content_hash: string }>;

    if (versions.length === 0) {
      console.error(`  FAILED — version ${version} not found`);
      continue;
    }

    const { content, content_hash } = versions[0];
    const filename = `store_${task}_v${version}.txt`;
    await writeFile(join(PROMPTS_DIR, filename), content, "utf-8");
    console.log(`  ✓ ${content.length} chars, hash ${content_hash?.slice(0, 16) ?? "?"} → ${filename}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
