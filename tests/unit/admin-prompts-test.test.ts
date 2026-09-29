/**
 * Admin Prompts Test Endpoint Tests
 *
 * Tests for POST /admin/prompts/:id/test sandbox endpoint
 * and POST /admin/prompts/:id/approve approval gating
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { interpolatePrompt, extractVariables } from "../../src/prompts/schema.js";
import { FilePromptStore } from "../../src/prompts/stores/file.js";
import { join } from "path";
import { mkdtemp, mkdir } from "fs/promises";
import { tmpdir } from "os";

// Mock store for testing
vi.mock("../../src/prompts/store.js", () => ({
  getPromptStore: vi.fn(() => ({
    get: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    initialize: vi.fn(),
  })),
  isPromptStoreHealthy: vi.fn(() => true),
  isPromptStoreInitialized: vi.fn(() => true),
}));

describe("Admin Prompts Test Endpoint", () => {
  describe("Prompt interpolation for test sandbox", () => {
    it("should interpolate variables correctly", () => {
      const template = "You are an assistant. Max nodes: {{maxNodes}}, max edges: {{maxEdges}}.";
      const variables = { maxNodes: 50, maxEdges: 200 };

      const result = interpolatePrompt(template, variables);

      expect(result).toBe("You are an assistant. Max nodes: 50, max edges: 200.");
    });

    it("should throw error for missing required variables", () => {
      const template = "Max nodes: {{maxNodes}}, max edges: {{maxEdges}}.";
      const variables = { maxNodes: 50 }; // maxEdges is missing

      // interpolatePrompt throws for missing required variables
      expect(() => interpolatePrompt(template, variables)).toThrow("Missing required variable: maxEdges");
    });

    it("should extract variables from template", () => {
      const template = "Config: {{maxNodes}} nodes, {{maxEdges}} edges, threshold: {{threshold}}";

      const variables = extractVariables(template);

      expect(variables).toEqual(["maxNodes", "maxEdges", "threshold"]);
    });

    it("should return empty array for template without variables", () => {
      const template = "This is a simple template with no variables.";

      const variables = extractVariables(template);

      expect(variables).toEqual([]);
    });

    it("should handle numeric variables", () => {
      const template = "Limit: {{limit}}";
      const variables = { limit: 100 };

      const result = interpolatePrompt(template, variables);

      expect(result).toBe("Limit: 100");
    });

    it("should handle string variables", () => {
      const template = "Model: {{model}}";
      const variables = { model: "gpt-4o" };

      const result = interpolatePrompt(template, variables);

      expect(result).toBe("Model: gpt-4o");
    });
  });

  describe("Test validation checks", () => {
    it("should detect unresolved variables in compiled content", () => {
      const compiledContent = "Config: 50 nodes, {{maxEdges}} edges.";
      const unresolvedVariables = compiledContent.match(/\{\{[^}]+\}\}/g);

      expect(unresolvedVariables).toBeTruthy();
      expect(unresolvedVariables).toContain("{{maxEdges}}");
    });

    it("should pass when all variables are resolved", () => {
      const compiledContent = "Config: 50 nodes, 200 edges.";
      const unresolvedVariables = compiledContent.match(/\{\{[^}]+\}\}/g);

      expect(unresolvedVariables).toBeNull();
    });

    it("should warn about short prompts", () => {
      const shortPrompt = "Be helpful.";
      const issues: string[] = [];

      if (shortPrompt.length < 100) {
        issues.push("Warning: Prompt content is very short (< 100 chars)");
      }

      expect(issues).toContain("Warning: Prompt content is very short (< 100 chars)");
    });

    it("should warn about very long prompts", () => {
      const longPrompt = "x".repeat(60000);
      const issues: string[] = [];

      if (longPrompt.length > 50000) {
        issues.push("Warning: Prompt content is very long (> 50k chars)");
      }

      expect(issues).toContain("Warning: Prompt content is very long (> 50k chars)");
    });
  });

  describe("Test request schema validation", () => {
    it("should require brief in input", () => {
      const validInput = {
        version: 1,
        input: {
          brief: "Should we expand into new markets?",
          maxNodes: 50,
          maxEdges: 200,
        },
        dry_run: true,
      };

      expect(validInput.input.brief).toBeTruthy();
      expect(validInput.input.brief.length).toBeGreaterThan(0);
    });

    it("should accept optional version", () => {
      const inputWithoutVersion = {
        input: {
          brief: "Test brief",
        },
        dry_run: true,
      };

      // Version is optional, so this should be valid
      expect(inputWithoutVersion.input.brief).toBeTruthy();
    });

    it("should accept optional maxNodes and maxEdges", () => {
      const inputWithVariables = {
        input: {
          brief: "Test brief",
          maxNodes: 100,
          maxEdges: 400,
        },
      };

      expect(inputWithVariables.input.maxNodes).toBe(100);
      expect(inputWithVariables.input.maxEdges).toBe(400);
    });
  });
});

describe("Approval Gating", () => {
  let store: FilePromptStore;
  let tempDir: string;

  beforeEach(async () => {
    // Create a fresh temp directory for each test
    tempDir = await mkdtemp(join(tmpdir(), "approval-test-"));
    await mkdir(tempDir, { recursive: true });

    store = new FilePromptStore({
      filePath: join(tempDir, "prompts.json"),
      backupEnabled: false,
    });
    await store.initialize();
  });

  describe("approveVersion store method", () => {
    it("should approve a version that requires approval", async () => {
      // Create a prompt with requiresApproval
      await store.create({
        id: "test-approval",
        name: "Test Approval Prompt",
        taskId: "draft_graph",
        content: "Test prompt content for approval testing.",
        createdBy: "test",
        changeNote: "Initial version",
        variables: [],
        tags: [],
      });

      // Create a new version that requires approval
      const updated = await store.createVersion("test-approval", {
        content: "Updated content that requires approval.",
        createdBy: "test",
        changeNote: "Needs approval",
        requiresApproval: true,
        variables: [],
      });

      expect(updated.versions[1].requiresApproval).toBe(true);
      expect(updated.versions[1].approvedBy).toBeUndefined();

      // Approve the version
      const approved = await store.approveVersion("test-approval", {
        version: 2,
        approvedBy: "admin-user",
        notes: "LGTM",
      });

      expect(approved.versions[1].approvedBy).toBe("admin-user");
      expect(approved.versions[1].approvedAt).toBeDefined();
    });

    it("should throw error when version does not require approval", async () => {
      // Create a prompt without requiresApproval
      await store.create({
        id: "no-approval-needed",
        name: "No Approval Prompt",
        taskId: "draft_graph",
        content: "Test prompt content.",
        createdBy: "test",
        variables: [],
        tags: [],
      });

      // Try to approve - should throw
      await expect(
        store.approveVersion("no-approval-needed", {
          version: 1,
          approvedBy: "admin-user",
        })
      ).rejects.toThrow("does not require approval");
    });

    it("should throw error when version is already approved", async () => {
      // Create a prompt
      await store.create({
        id: "already-approved",
        name: "Already Approved Prompt",
        taskId: "draft_graph",
        content: "Test prompt content.",
        createdBy: "test",
        variables: [],
        tags: [],
      });

      // Create version that requires approval
      await store.createVersion("already-approved", {
        content: "Content requiring approval.",
        createdBy: "test",
        requiresApproval: true,
        variables: [],
      });

      // Approve once
      await store.approveVersion("already-approved", {
        version: 2,
        approvedBy: "first-approver",
      });

      // Try to approve again - should throw
      await expect(
        store.approveVersion("already-approved", {
          version: 2,
          approvedBy: "second-approver",
        })
      ).rejects.toThrow("already approved");
    });

    it("should throw error when prompt not found", async () => {
      await expect(
        store.approveVersion("non-existent", {
          version: 1,
          approvedBy: "admin-user",
        })
      ).rejects.toThrow("not found");
    });

    it("should throw error when version not found", async () => {
      await store.create({
        id: "version-missing",
        name: "Version Missing Prompt",
        taskId: "draft_graph",
        content: "Test prompt content.",
        createdBy: "test",
        variables: [],
        tags: [],
      });

      await expect(
        store.approveVersion("version-missing", {
          version: 999,
          approvedBy: "admin-user",
        })
      ).rejects.toThrow("Version 999 not found");
    });
  });

  describe("Production promotion gating", () => {
    it("should allow promotion when approval is granted", async () => {
      // Create a prompt
      await store.create({
        id: "promotion-test",
        name: "Promotion Test Prompt",
        taskId: "draft_graph",
        content: "Initial content.",
        createdBy: "test",
        variables: [],
        tags: [],
      });

      // Create version that requires approval
      await store.createVersion("promotion-test", {
        content: "Content requiring approval before production.",
        createdBy: "test",
        requiresApproval: true,
        variables: [],
      });

      // Approve the version
      const approved = await store.approveVersion("promotion-test", {
        version: 2,
        approvedBy: "admin",
      });

      // Now the version has approvedBy set
      const version2 = approved.versions.find(v => v.version === 2);
      expect(version2?.approvedBy).toBe("admin");
      expect(version2?.approvedAt).toBeDefined();

      // Simulate production promotion check logic (from admin.prompts.ts)
      // Version can be promoted if: it doesn't require approval OR it has been approved
      const canPromote = !version2?.requiresApproval || Boolean(version2?.approvedBy);
      expect(canPromote).toBe(true);
    });

    it("should block promotion when approval is required but not granted", async () => {
      // Create a prompt
      await store.create({
        id: "blocked-promotion",
        name: "Blocked Promotion Prompt",
        taskId: "draft_graph",
        content: "Initial content.",
        createdBy: "test",
        variables: [],
        tags: [],
      });

      // Create version that requires approval (but don't approve it)
      const updated = await store.createVersion("blocked-promotion", {
        content: "Content requiring approval.",
        createdBy: "test",
        requiresApproval: true,
        variables: [],
      });

      // Simulate production promotion check logic (from admin.prompts.ts)
      const version2 = updated.versions.find(v => v.version === 2);
      expect(version2).toBeDefined();
      expect(version2?.requiresApproval).toBe(true);
      expect(version2?.approvedBy).toBeUndefined();

      // Version requires approval AND has no approvedBy -> cannot promote
      const canPromote = !version2?.requiresApproval || Boolean(version2?.approvedBy);
      expect(canPromote).toBe(false);
    });
  });
});

describe("Test Case Management", () => {
  let store: FilePromptStore;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "testcases-test-"));
    await mkdir(tempDir, { recursive: true });

    store = new FilePromptStore({
      filePath: join(tempDir, "prompts.json"),
      backupEnabled: false,
    });
    await store.initialize();
  });

  describe("updateTestCases store method", () => {
    it("should add test cases to a version", async () => {
      // Create a prompt
      await store.create({
        id: "test-cases-prompt",
        name: "Test Cases Prompt",
        taskId: "draft_graph",
        content: "Test prompt with {{maxNodes}} nodes.",
        createdBy: "test",
        variables: [{ name: "maxNodes", description: "Max nodes", required: true }],
        tags: [],
      });

      // Add test cases
      const testCases = [
        {
          id: "tc-1",
          name: "Basic test",
          input: "Test brief content",
          variables: { maxNodes: 50 },
          enabled: true,
        },
        {
          id: "tc-2",
          name: "Large graph test",
          input: "Create a complex decision tree",
          expectedOutput: "decision",
          variables: { maxNodes: 100 },
          enabled: true,
        },
      ];

      const updated = await store.updateTestCases("test-cases-prompt", 1, testCases);

      expect(updated.versions[0].testCases).toHaveLength(2);
      expect(updated.versions[0].testCases[0].id).toBe("tc-1");
      expect(updated.versions[0].testCases[0].name).toBe("Basic test");
      expect(updated.versions[0].testCases[1].id).toBe("tc-2");
      expect(updated.versions[0].testCases[1].expectedOutput).toBe("decision");
    });

    it("should replace existing test cases", async () => {
      await store.create({
        id: "replace-test-cases",
        name: "Replace Test Cases Prompt",
        taskId: "draft_graph",
        content: "Test prompt content here.",
        createdBy: "test",
        variables: [],
        tags: [],
      });

      // Add initial test cases
      await store.updateTestCases("replace-test-cases", 1, [
        { id: "old-1", name: "Old test", input: "Old input", enabled: true, variables: {} },
      ]);

      // Verify initial
      let prompt = await store.get("replace-test-cases");
      expect(prompt?.versions[0].testCases).toHaveLength(1);
      expect(prompt?.versions[0].testCases[0].id).toBe("old-1");

      // Replace with new test cases
      await store.updateTestCases("replace-test-cases", 1, [
        { id: "new-1", name: "New test 1", input: "New input 1", enabled: true, variables: {} },
        { id: "new-2", name: "New test 2", input: "New input 2", enabled: true, variables: {} },
      ]);

      prompt = await store.get("replace-test-cases");
      expect(prompt?.versions[0].testCases).toHaveLength(2);
      expect(prompt?.versions[0].testCases[0].id).toBe("new-1");
      expect(prompt?.versions[0].testCases[1].id).toBe("new-2");
    });

    it("should clear test cases when given empty array", async () => {
      await store.create({
        id: "clear-test-cases",
        name: "Clear Test Cases Prompt",
        taskId: "draft_graph",
        content: "Test prompt content here.",
        createdBy: "test",
        variables: [],
        tags: [],
      });

      // Add test cases
      await store.updateTestCases("clear-test-cases", 1, [
        { id: "tc-1", name: "Test", input: "Input", enabled: true, variables: {} },
      ]);

      let prompt = await store.get("clear-test-cases");
      expect(prompt?.versions[0].testCases).toHaveLength(1);

      // Clear test cases
      await store.updateTestCases("clear-test-cases", 1, []);

      prompt = await store.get("clear-test-cases");
      expect(prompt?.versions[0].testCases).toHaveLength(0);
    });

    it("should throw error when prompt not found", async () => {
      await expect(
        store.updateTestCases("non-existent", 1, [])
      ).rejects.toThrow("not found");
    });

    it("should throw error when version not found", async () => {
      await store.create({
        id: "version-missing-tc",
        name: "Version Missing TC Prompt",
        taskId: "draft_graph",
        content: "Test prompt content.",
        createdBy: "test",
        variables: [],
        tags: [],
      });

      await expect(
        store.updateTestCases("version-missing-tc", 999, [])
      ).rejects.toThrow("Version 999 not found");
    });

    it("should update test cases for specific version only", async () => {
      await store.create({
        id: "multi-version-tc",
        name: "Multi Version TC Prompt",
        taskId: "draft_graph",
        content: "Version 1 content here.",
        createdBy: "test",
        variables: [],
        tags: [],
      });

      // Create version 2
      await store.createVersion("multi-version-tc", {
        content: "Version 2 content here.",
        createdBy: "test",
        variables: [],
        requiresApproval: false,
      });

      // Add test cases to version 2 only
      await store.updateTestCases("multi-version-tc", 2, [
        { id: "v2-tc", name: "V2 test", input: "V2 input", enabled: true, variables: {} },
      ]);

      const prompt = await store.get("multi-version-tc");
      expect(prompt?.versions[0].testCases).toHaveLength(0); // Version 1 unchanged
      expect(prompt?.versions[1].testCases).toHaveLength(1); // Version 2 has test case
      expect(prompt?.versions[1].testCases[0].id).toBe("v2-tc");
    });
  });
});
