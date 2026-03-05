import * as dict from "./dictionary";
import { normalizePos } from "./dictionary";
import type { ResolvedWord, Word } from "./types";

/**
 * Count the number of candidate words that strictly satisfy all constraints of
 * a resolved slot.  This function applies each constraint strictly so the
 * displayed count reflects the true number of matching words.
 *
 * Filtering order: pool → POS → stress.
 *
 * Rhyme is excluded because the rhyme key is determined dynamically during
 * playback.  The count value is also excluded — it is applied on top of the
 * resolved candidates at sampling time.
 */
export function countCandidates(rw: ResolvedWord): number {
  // Special case: user typed a word with count ≤ 1 → always 1 candidate
  if (rw.text && rw.count <= 1) {
    return 1;
  }

  let candidates: Word[];

  if (rw.pool.length > 0) {
    const poolSet = new Set(rw.pool);
    candidates = dict.getAllWords().filter((w) => poolSet.has(w.text));
  } else {
    candidates = dict.getAllWords();
  }

  if (rw.pos) {
    candidates = filterByPos(candidates, rw.pos);
  }

  if (rw.syllables) {
    candidates = filterByStressStrict(candidates, rw.syllables);
  }

  return candidates.length;
}

/**
 * Strictly filter words by a stress pattern — returns only actual matches
 * (no fallback).  Used by {@link countCandidates} to give an accurate count.
 */
function filterByStressStrict(candidates: Word[], pattern: string): Word[] {
  if (pattern.includes("*")) {
    if (!/^[012*]+$/.test(pattern)) return candidates;
    const regexStr = "^" + pattern.replace(/\*/g, "[012]*") + "$";
    const regex = new RegExp(regexStr);
    return candidates.filter((w) => regex.test(w.stress));
  }
  return candidates.filter((w) => w.stress === pattern);
}

/**
 * Filter words by part of speech.
 */
export function filterByPos(candidates: Word[], pos: string): Word[] {
  const normalized = normalizePos(pos);
  return candidates.filter((w) => normalizePos(w.pos) === normalized);
}

/**
 * Filter words by a stress pattern.
 * Supports wildcard "*" which matches zero or more syllables of any stress.
 * "." in the grid is converted to "*" before being passed here.
 */
export function filterByStress(candidates: Word[], pattern: string): Word[] {
  if (pattern.includes("*")) {
    if (!/^[012*]+$/.test(pattern)) return candidates;
    const regexStr = "^" + pattern.replace(/\*/g, "[012]*") + "$";
    const regex = new RegExp(regexStr);
    const filtered = candidates.filter((w) => regex.test(w.stress));
    return filtered.length > 0 ? filtered : candidates;
  }
  const exact = candidates.filter((w) => w.stress === pattern);
  return exact.length > 0 ? exact : candidates;
}

/**
 * Filter candidates by rhyme key with progressive suffix relaxation.
 *
 * The rhyme key is a sequence of phonemes, e.g. "AO L M OW S T".  We first
 * try filtering by the full suffix (exact rhyme).  If fewer than `minCount`
 * candidates match we progressively drop the leading phoneme:
 *   "AO L M OW S T"  →  "L M OW S T"  →  "M OW S T"  →  "OW S T"  →  …
 * until we have at least `minCount` matches or run out of phonemes.
 *
 * Uses suffix matching (word.rhyme ends with the partial key) so that words
 * with longer rhyme keys still match shorter suffixes.
 *
 * @param candidates  Pre-filtered candidate words.
 * @param rhymeKey    Full rhyme key established by the first slot in the group.
 * @param minCount    Minimum number of matches required (typically the limit).
 */
export function filterByRhymeRelaxed(candidates: Word[], rhymeKey: string, minCount = 1): Word[] {
  const phonemes = rhymeKey.split(" ");
  let best: Word[] = [];

  for (let start = 0; start < phonemes.length; start++) {
    const suffix = " " + phonemes.slice(start).join(" ");
    const filtered = candidates.filter((w) => (" " + w.rhyme).endsWith(suffix));

    // Keep the tightest match that still has enough candidates
    if (filtered.length >= minCount) {
      best = filtered;
      break;
    }
    // Track the best we've found so far (tightest with any matches)
    if (filtered.length > best.length) {
      best = filtered;
    }
  }

  return best;
}
