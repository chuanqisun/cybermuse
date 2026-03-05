import * as dict from "./dictionary";
import { filterByPos, filterByRhymeRelaxed, filterByStress } from "./sampler";
import type { ResolvedWord, Word } from "./types";
import { findSimilar } from "./vectors";

/**
 * Constraint Satisfaction Solver
 *
 * Produces deterministic candidate lists for all slots in a resolved grid,
 * guaranteeing that each slot receives exactly `count` candidates (when
 * count > 0) or at least 1 candidate (when count is 0).
 *
 * Rhyme groups are handled holistically: the first slot in each group is
 * the **anchor** — its user-entered text determines the rhyme key for the
 * entire group.  All other slots in the same group are constrained to that
 * rhyme key.
 *
 * When the initial semantic pool is too small to satisfy `count` under all
 * constraints, the solver progressively expands the pool (larger vector
 * search K) and, as a last resort, falls back to the full dictionary.
 */

/**
 * Solve constraints for every slot and return one candidate list per slot.
 *
 * @param slots  Resolved word slots (from the resolver).
 * @returns      Array of string arrays, one per slot.  Blank slots get `[]`.
 */
export async function solveConstraints(slots: ResolvedWord[]): Promise<string[][]> {
  const rhymeRegistry = new Map<string, string>();

  // ── First pass: register rhyme anchors ──────────────────────────────
  // The first slot in each rhyme group whose text is in the dictionary
  // establishes the rhyme key for the whole group.
  for (const slot of slots) {
    if (slot.blank || !slot.rhymeGroup || rhymeRegistry.has(slot.rhymeGroup)) continue;
    if (slot.text) {
      const anchor = dict.findWord(slot.text);
      if (anchor) {
        rhymeRegistry.set(slot.rhymeGroup, anchor.rhyme);
      }
    }
  }

  // ── Second pass: solve each slot ────────────────────────────────────
  const results: string[][] = [];

  for (const slot of slots) {
    if (slot.blank) {
      results.push([]);
      continue;
    }

    const targetCount = slot.count > 0 ? slot.count : 1;

    // Verbatim: user typed a word with count ≤ 1 → emit as-is
    if (slot.text && slot.count <= 1) {
      results.push([slot.text]);
      continue;
    }

    const rhymeKey = slot.rhymeGroup ? rhymeRegistry.get(slot.rhymeGroup) : undefined;
    const candidates = await satisfyCount(slot, rhymeKey, targetCount);
    results.push(candidates);

    // Late anchor registration: if the first slot in a group had no text
    // (or text wasn't in the dictionary) we register rhyme from its top
    // candidate so subsequent slots can still rhyme-match.
    if (slot.rhymeGroup && !rhymeRegistry.has(slot.rhymeGroup) && candidates.length > 0) {
      const w = dict.findWord(candidates[0]);
      if (w) rhymeRegistry.set(slot.rhymeGroup, w.rhyme);
    }
  }

  return results;
}

// ── Internal helpers ──────────────────────────────────────────────────

/**
 * Find exactly `targetCount` candidates for a slot, progressively expanding
 * the semantic pool and relaxing constraints until the count is met.
 */
async function satisfyCount(slot: ResolvedWord, rhymeKey: string | undefined, targetCount: number): Promise<string[]> {
  // Phase 1: try with the existing pool from the resolver
  let result = filterAndRank(slot.pool, slot, rhymeKey, targetCount);
  if (result.length >= targetCount) return result.slice(0, targetCount);

  // Phase 2: progressively expand the semantic pool
  if (slot.text) {
    for (const k of [500, 2000, 10000]) {
      const expanded = await findSimilar(slot.text, k, slot.pos);
      result = filterAndRank(expanded, slot, rhymeKey, targetCount);
      if (result.length >= targetCount) return result.slice(0, targetCount);
    }
  }

  // Phase 3: drop semantic constraint, search full dictionary
  result = filterAndRank([], slot, rhymeKey, targetCount);
  if (result.length >= targetCount) return result.slice(0, targetCount);

  // Phase 4: fill remaining slots with random words
  const seen = new Set(result);
  while (result.length < targetCount) {
    const w = dict.randomWord().text;
    if (!seen.has(w)) {
      result.push(w);
      seen.add(w);
    }
  }
  return result;
}

/**
 * Filter and rank candidates from a pool, applying POS, stress, and rhyme
 * constraints.  Returns all surviving candidates sorted by semantic rank.
 */
function filterAndRank(
  pool: string[],
  slot: ResolvedWord,
  rhymeKey: string | undefined,
  targetCount: number,
): string[] {
  let candidates: Word[];

  if (pool.length > 0) {
    const poolSet = new Set(pool);
    candidates = dict.getAllWords().filter((w) => poolSet.has(w.text));
    if (candidates.length === 0) return [];
  } else {
    candidates = dict.getAllWords();
  }

  if (slot.pos) {
    const filtered = filterByPos(candidates, slot.pos);
    if (filtered.length > 0) candidates = filtered;
  }

  if (slot.syllables) {
    candidates = filterByStress(candidates, slot.syllables);
  }

  if (rhymeKey) {
    const rhyming = filterByRhymeRelaxed(candidates, rhymeKey, targetCount);
    if (rhyming.length > 0) candidates = rhyming;
  }

  // Sort by pool order for deterministic ranking (most similar first)
  if (pool.length > 0) {
    const poolOrder = new Map(pool.map((text, i) => [text, i]));
    candidates.sort((a, b) => (poolOrder.get(a.text) ?? Infinity) - (poolOrder.get(b.text) ?? Infinity));
  }

  return [...new Set(candidates.map((w) => w.text))];
}
