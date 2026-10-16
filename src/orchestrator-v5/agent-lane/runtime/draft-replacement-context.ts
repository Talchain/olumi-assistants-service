/**
 * ⭐ B RESTATED GOAL — A REVISED DRAFT IS PREPARED, NEVER WRITTEN, BY THE CONSTRUCTION IT REUSES.
 *
 * DL ruling (B) with PL 6116779075 and AIE 0244: when the user restates their goal in terms the early draft does not
 * contain (Paul's marketing L20: conversion above 15% and 20 new customers, on a draft that models "launch % complete"),
 * Olumi may offer to replace that UNREVIEWED draft with one prepared by C's own construction from the stored brief and
 * the typed goal. The card must show the real candidate, so the construction runs to the point of registration and hands
 * back the graph it would have written (`build-model.ts`, the register hunk). The approval then writes exactly those
 * bytes through `/graph/register`, with compare-and-set on the base it was prepared against (`agent-capabilities.ts`).
 *
 * The same `AsyncLocalStorage` mechanism as `approved-adoption-context.ts`: unreachable from outside the process, and it
 * survives the in-process dispatch. The restated-goal card is retired (no caller today); FOUNDER's explicit rebuild of a
 * saved model is its consumer (DL-3 17:51Z): the prepared result carries the whole construction report (`reported`), and
 * nothing is read or written until that card's own approval registers the exact bytes.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const preparing = new AsyncLocalStorage<{ readonly scenarioId: string }>();

/** Run ONE construction that prepares a revised draft for `scenarioId` and writes nothing. */
export function runPreparingDraftReplacement<T>(scenarioId: string, fn: () => Promise<T>): Promise<T> {
  return preparing.run({ scenarioId }, fn);
}

/** True only inside {@link runPreparingDraftReplacement} for this very scenario. */
export function preparingDraftReplacementFor(scenarioId: string): boolean {
  return preparing.getStore()?.scenarioId === scenarioId;
}
