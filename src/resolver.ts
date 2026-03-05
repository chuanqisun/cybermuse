import { solveConstraints } from "./solver";
import type { GridWord, ResolvedGrid, ResolvedWord } from "./types";
import { findSimilar } from "./vectors";

/**
 * Phase 1 — Resolver
 *
 * Converts a flat list of GridWord slots into a ResolvedGrid by pre-fetching
 * semantic word pools from the vector database for every slot that carries a
 * text query.
 *
 * The vector search always uses a larger K than the desired pool size so that
 * enough candidates survive downstream syllable / rhyme filtering.
 *
 * @param gridWords  Non-null output from GridElement.getWords().
 */
export async function resolve(gridWords: GridWord[]): Promise<ResolvedGrid> {
  const resolvedWords: ResolvedWord[] = [];

  for (const gw of gridWords) {
    if (gw.blank) {
      resolvedWords.push({ index: gw.index, blank: true, pool: [], count: 0 });
      continue;
    }

    const count = gw.count ?? 1;
    // Use a much larger K for the vector search so that syllable / rhyme
    // constraints (applied during sampling) still leave enough candidates.
    const searchK = count > 0 ? Math.max(count * 20, 200) : 200;

    let pool: string[] = [];
    if (gw.text) {
      pool = await findSimilar(gw.text, searchK, gw.pos);
    }

    resolvedWords.push({
      index: gw.index,
      blank: false,
      text: gw.text,
      // Map grid "." wildcard to sampler "*" wildcard
      syllables: gw.syllables ? gw.syllables.replace(/\./g, "*") : undefined,
      rhymeGroup: gw.rhymeGroup,
      pos: gw.pos,
      pool,
      count,
    });
  }

  const candidates = await solveConstraints(resolvedWords);
  return { words: resolvedWords, candidates };
}
