import type { GraphT } from "../../src/schemas/graph.js";

/**
 * Functional Stability Checks (Deterministic, No External ML)
 *
 * These checks validate that graph generation is stable across runs for the same brief.
 * All algorithms are deterministic and use simple string/set operations.
 */

/**
 * Calculate Jaccard similarity between two sets
 * J(A,B) = |A ∩ B| / |A ∪ B|
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);

  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  if (union.size === 0) return 1.0; // Both empty = perfect similarity
  return intersection.size / union.size;
}

/**
 * Build sorted edge pair keys from graph
 * Format: "from:to" sorted alphabetically
 */
export function edgeKeys(graph: GraphT): string[] {
  return graph.edges.map((e) => `${e.from}:${e.to}`).sort();
}

/**
 * Check topology match using Jaccard similarity over edge pairs
 * Threshold: ≥ 0.90
 */
export function checkTopologyMatch(expected: GraphT, actual: GraphT): {
  pass: boolean;
  similarity: number;
  threshold: number;
} {
  const expectedKeys = edgeKeys(expected);
  const actualKeys = edgeKeys(actual);
  const similarity = jaccardSimilarity(expectedKeys, actualKeys);
  const threshold = 0.9;

  return {
    pass: similarity >= threshold,
    similarity,
    threshold,
  };
}

/**
 * Count nodes by kind
 */
export function nodeKindDistribution(graph: GraphT): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const node of graph.nodes) {
    counts[node.kind] = (counts[node.kind] || 0) + 1;
  }
  return counts;
}

/**
 * Check node-kind distribution (exact counts match)
 */
export function checkNodeKindDistribution(expected: GraphT, actual: GraphT): {
  pass: boolean;
  expectedCounts: Record<string, number>;
  actualCounts: Record<string, number>;
  mismatches: string[];
} {
  const expectedCounts = nodeKindDistribution(expected);
  const actualCounts = nodeKindDistribution(actual);

  const allKinds = new Set([...Object.keys(expectedCounts), ...Object.keys(actualCounts)]);
  const mismatches: string[] = [];

  for (const kind of allKinds) {
    const expectedCount = expectedCounts[kind] || 0;
    const actualCount = actualCounts[kind] || 0;
    if (expectedCount !== actualCount) {
      mismatches.push(`${kind}: expected ${expectedCount}, got ${actualCount}`);
    }
  }

  return {
    pass: mismatches.length === 0,
    expectedCounts,
    actualCounts,
    mismatches,
  };
}

/**
 * Extract all labels from graph nodes
 */
export function extractLabels(graph: GraphT): string[] {
  return graph.nodes.map((n) => n.label || "").filter((label) => label.length > 0);
}

/**
 * Simple stopwords list for English
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "he",
  "in", "is", "it", "its", "of", "on", "that", "the", "to", "was", "will", "with",
]);

/**
 * Tokenize text into words, removing stopwords and converting to lowercase
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ") // Remove punctuation
    .split(/\s+/)
    .filter((word) => word.length > 0 && !STOPWORDS.has(word));
}

/**
 * Build term frequency (TF) map
 */
export function termFrequency(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) {
    tf.set(token, (tf.get(token) || 0) + 1);
  }
  return tf;
}

/**
 * Calculate TF-IDF vectors for a set of documents (labels)
 * Returns: Map of term → TF-IDF value for each document
 */
export function tfidfVectors(documents: string[][]): Map<string, number>[] {
  // Build document frequency (DF) map
  const df = new Map<string, number>();
  const uniqueTermsPerDoc = documents.map((doc) => new Set(doc));

  for (const terms of uniqueTermsPerDoc) {
    for (const term of terms) {
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  const numDocs = documents.length;

  // Build TF-IDF vector for each document
  return documents.map((doc) => {
    const tf = termFrequency(doc);
    const tfidf = new Map<string, number>();

    for (const [term, termFreq] of tf.entries()) {
      const docFreq = df.get(term) || 1;
      const idf = Math.log(numDocs / docFreq);
      tfidf.set(term, termFreq * idf);
    }

    return tfidf;
  });
}

/**
 * Calculate cosine similarity between two TF-IDF vectors
 */
export function cosineSimilarity(vecA: Map<string, number>, vecB: Map<string, number>): number {
  // Get all unique terms
  const allTerms = new Set([...vecA.keys(), ...vecB.keys()]);

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (const term of allTerms) {
    const a = vecA.get(term) || 0;
    const b = vecB.get(term) || 0;

    dotProduct += a * b;
    magnitudeA += a * a;
    magnitudeB += b * b;
  }

  if (magnitudeA === 0 || magnitudeB === 0) return 0;

  return dotProduct / (Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB));
}

/**
 * Calculate average label similarity using TF-IDF cosine similarity
 * Threshold: ≥ 0.85
 * Optimised to O(n) by comparing labels only for matching node IDs
 */
export function checkLabelSimilarity(expected: GraphT, actual: GraphT): {
  pass: boolean;
  similarity: number;
  threshold: number;
} {
  const expectedLabels = extractLabels(expected);
  const actualLabels = extractLabels(actual);

  // If both have no labels, they are perfectly similar
  if (expectedLabels.length === 0 && actualLabels.length === 0) {
    return {
      pass: true,
      similarity: 1.0,
      threshold: 0.85,
    };
  }

  // If only one has labels, they are dissimilar
  if (expectedLabels.length === 0 || actualLabels.length === 0) {
    return {
      pass: false,
      similarity: 0,
      threshold: 0.85,
    };
  }

  // Build node ID → label maps for efficient O(1) lookup
  const expectedMap = new Map<string, string>();
  for (const node of expected.nodes) {
    if (node.label && node.label.length > 0) {
      expectedMap.set(node.id, node.label);
    }
  }

  const actualMap = new Map<string, string>();
  for (const node of actual.nodes) {
    if (node.label && node.label.length > 0) {
      actualMap.set(node.id, node.label);
    }
  }

  // Find common node IDs (only compare labels for matching nodes)
  const commonIds = [...expectedMap.keys()].filter((id) => actualMap.has(id));

  if (commonIds.length === 0) {
    // No common labeled nodes to compare
    return {
      pass: false,
      similarity: 0,
      threshold: 0.85,
    };
  }

  // Tokenize labels for common nodes only (O(n) instead of O(n²))
  const expectedTokens: string[][] = [];
  const actualTokens: string[][] = [];

  for (const id of commonIds) {
    expectedTokens.push(tokenize(expectedMap.get(id)!));
    actualTokens.push(tokenize(actualMap.get(id)!));
  }

  // Build TF-IDF vectors for all labels combined
  const allDocuments = [...expectedTokens, ...actualTokens];
  const tfidfVecs = tfidfVectors(allDocuments);

  // Split vectors back into expected and actual
  const expectedVecs = tfidfVecs.slice(0, expectedTokens.length);
  const actualVecs = tfidfVecs.slice(expectedTokens.length);

  // Calculate similarity by zipping: compare label[i] with label[i] for same node ID
  // This is O(n) instead of O(n²) pairwise comparison
  let totalSimilarity = 0;
  for (let i = 0; i < expectedVecs.length; i++) {
    totalSimilarity += cosineSimilarity(expectedVecs[i], actualVecs[i]);
  }

  const avgSimilarity = expectedVecs.length > 0 ? totalSimilarity / expectedVecs.length : 0;
  const threshold = 0.85;

  return {
    pass: avgSimilarity >= threshold,
    similarity: avgSimilarity,
    threshold,
  };
}

/**
 * Run all functional stability checks on a graph pair
 */
export function runStabilityChecks(expected: GraphT, actual: GraphT): {
  topologyMatch: ReturnType<typeof checkTopologyMatch>;
  nodeKindDistribution: ReturnType<typeof checkNodeKindDistribution>;
  labelSimilarity: ReturnType<typeof checkLabelSimilarity>;
  allPassed: boolean;
} {
  const topologyMatch = checkTopologyMatch(expected, actual);
  const nodeKindDist = checkNodeKindDistribution(expected, actual);
  const labelSim = checkLabelSimilarity(expected, actual);

  return {
    topologyMatch,
    nodeKindDistribution: nodeKindDist,
    labelSimilarity: labelSim,
    allPassed: topologyMatch.pass && nodeKindDist.pass && labelSim.pass,
  };
}
