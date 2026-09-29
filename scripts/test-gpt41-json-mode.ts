/**
 * Test script to verify GPT-4.1 JSON mode support
 *
 * This script tests whether gpt-4.1-2025-04-14 properly supports
 * OpenAI's response_format: { type: "json_object" } parameter.
 *
 * Run with:
 *   OPENAI_API_KEY=<key> npx tsx scripts/test-gpt41-json-mode.ts
 */

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface TestResult {
  model: string;
  success: boolean;
  rawResponse?: string;
  parsedJson?: unknown;
  error?: string;
}

async function testJsonMode(model: string): Promise<TestResult> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Testing model: ${model}`);
  console.log("=".repeat(60));

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful assistant that outputs JSON. Always respond with valid JSON only.",
        },
        {
          role: "user",
          content:
            "Create a JSON object representing a simple graph with nodes and edges arrays. Include at least 2 nodes with id and label fields, and 1 edge with from and to fields.",
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content || "";
    console.log("\nRaw response (first 500 chars):");
    console.log(content.substring(0, 500));

    // Check if response starts with JSON-like characters
    const trimmed = content.trim();
    const startsWithJson = trimmed.startsWith("{") || trimmed.startsWith("[");
    console.log(`\nStarts with JSON character: ${startsWithJson ? "✅ Yes" : "❌ No"}`);

    if (!startsWithJson) {
      console.log(`First 50 chars: "${trimmed.substring(0, 50)}"`);
      return {
        model,
        success: false,
        rawResponse: content,
        error: `Response does not start with JSON. Starts with: "${trimmed.substring(0, 20)}..."`,
      };
    }

    // Try to parse as JSON
    const parsed = JSON.parse(content);
    console.log("\n✅ JSON parsed successfully!");
    console.log("Parsed structure:", JSON.stringify(parsed, null, 2).substring(0, 300));

    return {
      model,
      success: true,
      rawResponse: content,
      parsedJson: parsed,
    };
  } catch (error: any) {
    console.log(`\n❌ Error: ${error.message}`);

    // Check for specific error types
    if (error.message?.includes("does not exist")) {
      console.log("   -> Model does not exist or no access");
    } else if (error.message?.includes("not valid JSON") || error instanceof SyntaxError) {
      console.log("   -> Response was not valid JSON");
    }

    return {
      model,
      success: false,
      error: error.message,
    };
  }
}

async function main() {
  console.log("GPT-4.1 JSON Mode Test");
  console.log("=".repeat(60));
  console.log("Testing whether gpt-4.1-2025-04-14 supports response_format: json_object\n");

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY environment variable is required");
    process.exit(1);
  }

  const modelsToTest = [
    "gpt-4o",              // Known working baseline
    "gpt-4.1-2025-04-14",  // Model in question
  ];

  const results: TestResult[] = [];

  for (const model of modelsToTest) {
    const result = await testJsonMode(model);
    results.push(result);
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST RESULTS SUMMARY");
  console.log("=".repeat(60));

  for (const result of results) {
    const status = result.success ? "✅ PASS" : "❌ FAIL";
    console.log(`  ${result.model.padEnd(25)} ${status}`);
    if (!result.success && result.error) {
      console.log(`    Error: ${result.error.substring(0, 80)}...`);
    }
  }

  // Conclusion
  console.log("\n" + "=".repeat(60));
  console.log("CONCLUSION");
  console.log("=".repeat(60));

  const gpt4oResult = results.find((r) => r.model === "gpt-4o");
  const gpt41Result = results.find((r) => r.model === "gpt-4.1-2025-04-14");

  if (gpt4oResult?.success && !gpt41Result?.success) {
    console.log("✅ ROOT CAUSE CONFIRMED: gpt-4.1-2025-04-14 does NOT support JSON mode");
    console.log("   while gpt-4o does. The hypothesis is correct.");
  } else if (gpt4oResult?.success && gpt41Result?.success) {
    console.log("⚠️  Both models passed JSON mode test.");
    console.log("   The issue may be prompt-specific or a transient failure.");
    console.log("   Consider testing with the actual draft_graph prompt.");
  } else if (!gpt4oResult?.success && !gpt41Result?.success) {
    console.log("❌ Both models failed. Check API key permissions or network issues.");
  } else {
    console.log("⚠️  Unexpected results. Manual investigation needed.");
  }
}

main().catch(console.error);
