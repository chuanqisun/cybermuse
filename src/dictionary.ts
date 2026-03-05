import wordsData from "./data/words.json";
import type { Word } from "./types";

const words: Word[] = wordsData as Word[];

const byStress = new Map<string, Word[]>();
const byRhyme = new Map<string, Word[]>();
const byPos = new Map<string, Word[]>();
const byText = new Map<string, Word>();

export function normalizePos(pos: string): string {
  const lower = pos.toLowerCase();
  if (lower === "n" || lower === "noun") return "noun";
  if (lower === "v" || lower === "verb") return "verb";
  if (lower === "adj" || lower === "adjective") return "adjective";
  if (lower === "adv" || lower === "adverb") return "adverb";
  return lower;
}

for (const word of words) {
  byText.set(word.text, word);

  const s = byStress.get(word.stress);
  if (s) s.push(word);
  else byStress.set(word.stress, [word]);

  const r = byRhyme.get(word.rhyme);
  if (r) r.push(word);
  else byRhyme.set(word.rhyme, [word]);

  const np = normalizePos(word.pos);
  const p = byPos.get(np);
  if (p) p.push(word);
  else byPos.set(np, [word]);
}

export function findByStress(pattern: string): Word[] {
  return byStress.get(pattern) ?? [];
}

export function findByRhyme(key: string): Word[] {
  return byRhyme.get(key) ?? [];
}

export function findByPos(pos: string): Word[] {
  return byPos.get(normalizePos(pos)) ?? [];
}

export function findBySyllables(count: number): Word[] {
  return words.filter((w) => w.syllables === count);
}

export function findWord(text: string): Word | undefined {
  return byText.get(text.toLowerCase());
}

export function randomWord(): Word {
  return words[Math.floor(Math.random() * words.length)];
}

export function getAllWords(): Word[] {
  return words;
}
