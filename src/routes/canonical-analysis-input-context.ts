import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { CanonicalAnalysisViewInput } from './canonical-analysis-view.js';

interface CanonicalAnalysisInputReceipt {
  readonly id: string;
  input?: CanonicalAnalysisViewInput;
}

// Keep the selected Run inside the process: it is never a graph-route wire field.
const receipts = new AsyncLocalStorage<CanonicalAnalysisInputReceipt>();
const pendingReceipts = new Map<string, CanonicalAnalysisInputReceipt>();
const inputsByRead = new WeakMap<object, CanonicalAnalysisViewInput>();

/** A dispatch may carry this opaque token across Fastify's injection boundary. */
export function currentCanonicalAnalysisInputReceipt(): string | undefined {
  return receipts.getStore()?.id;
}

/** Attest the exact inputs the scenario read is about to project. */
export function recordCanonicalAnalysisViewInput(input: CanonicalAnalysisViewInput, receiptId?: string): void {
  const receipt = receiptId === undefined ? receipts.getStore() : pendingReceipts.get(receiptId);
  if (receipt !== undefined) receipt.input = input;
}

/** Capture the same in-process read, including repeats served by the graph-read cache. */
export async function captureCanonicalAnalysisViewInput<T extends { readonly json: unknown }>(
  operation: () => Promise<T>,
): Promise<{ readonly response: T; readonly input: CanonicalAnalysisViewInput | undefined }> {
  const receipt: CanonicalAnalysisInputReceipt = { id: randomUUID() };
  pendingReceipts.set(receipt.id, receipt);
  try {
    return await receipts.run(receipt, async () => {
      const response = await operation();
      const read = typeof response.json === 'object' && response.json !== null ? response.json : undefined;
      const input = receipt.input ?? (read === undefined ? undefined : inputsByRead.get(read));
      if (read !== undefined && input !== undefined) inputsByRead.set(read, input);
      return { response, input };
    });
  } finally {
    pendingReceipts.delete(receipt.id);
  }
}

/** Preserve an internal receipt when the read cache gives a caller its isolated JSON copy. */
export function copyCanonicalAnalysisViewInput(source: object, copy: object): void {
  const input = inputsByRead.get(source);
  if (input !== undefined) inputsByRead.set(copy, input);
}
