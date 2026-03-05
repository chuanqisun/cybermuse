# Cybermuse Poem Pattern Manual

A poem is programmed as a sequence of **slots**. Each slot produces one spoken word. You control word selection by setting constraints on five dimensions: **syllable stress**, **rhyme group**, **text**, **part of speech**, and **count**.

A blank slot (all fields empty) acts as a rest — a silent pause in the poem.

---

## Syllable Stress

Each word in the dictionary carries a **stress pattern** — a string of digits, one per syllable:

| Digit | Meaning |
|-------|---------|
| `0` | Unstressed syllable |
| `1` | Primary stress |
| `2` | Secondary stress |

For example, the word "ability" has stress `0102` (a-**bil**-i-**ty**), and "absolute" has stress `102` (**ab**-so-**lute**).

A slot has up to three syllable cells. Each cell is either blank or one of `0`, `1`, `2`, `.` (wildcard). The cells are concatenated left-to-right into a single pattern string.

### How matching works

- **Blank** (all cells empty): No stress constraint. Any word is allowed.
- **Exact digits only** (e.g. `01`, `102`): Only words whose stress pattern is exactly that string can match. `01` matches two-syllable words stressed on the second syllable (e.g. "about", "absorb").
- **Wildcard `.`**: The `.` is treated as `*`, which matches **zero or more syllables of any stress**. It is converted to the regex `[012]*`.

### Wildcard examples

| Pattern | Regex | Matches |
|---------|-------|---------|
| `1` | exact `1` | One-syllable stressed words: "art", "bright" |
| `10` | exact `10` | Two-syllable, stress-first: "able", "absence" |
| `1.` | `^1[012]*$` | Any word starting with a stressed syllable: "art" (`1`), "able" (`10`), "absolute" (`102`), "accurately" (`1020`) |
| `.1` | `^[012]*1$` | Any word ending with a stressed syllable: "art" (`1`), "about" (`01`), "absorb" (`01`) |
| `1.0` | `^1[012]*0$` | Starts stressed, ends unstressed: "able" (`10`), "absolute" → no (`102` ends in `2`), "abandon" → no (starts `0`) |

### Fallback

If no words match the stress pattern, the constraint is dropped and all candidates are kept. This ensures every slot always produces a word.

---

## Rhyme Group

Slots can be assigned to a **rhyme group** labeled `A` through `G`. All slots in the same group are constrained to rhyme with each other.

- **Blank**: No rhyme constraint.
- **A–G**: The slot belongs to that rhyme group.

### How the rhyme key is established

The **first slot** in each group that has user-entered text determines the **rhyme key** for the entire group. The system looks up that word in the dictionary and uses its phoneme-based rhyme value.

For example, if the first slot in group `A` contains the text "moon", the rhyme key becomes `UW N` (the phoneme representation of "-oon"). Every other slot in group `A` is then constrained to end with those phonemes.

If the first slot in a group has no text (or the text isn't in the dictionary), the system waits until that slot is solved and uses the top candidate's rhyme to anchor the group.

### Relaxation

Exact rhyme matches may be too few to fill all slots. The solver uses **progressive suffix relaxation**:

1. Start with the full rhyme key, e.g. `AO L M OW S T` (6 phonemes for "almost").
2. If not enough candidates match, drop the leading phoneme: `L M OW S T`.
3. Continue dropping: `M OW S T` → `OW S T` → `S T` → `T`.
4. Stop at the tightest (most phonemes) suffix that yields enough candidates.

This means group members share at least a partial rhyme — the system finds the best rhyme it can while still satisfying the requested count.

### Example

Three slots all in group `A`, first slot text = "night":

- Rhyme key: `AY T`
- Exact matches: "light", "sight", "bright", "right", "write", "white", …
- If more candidates are needed, relaxes to `T`: "about", "art", "heart", …

---

## Text — Literal and Semantic Search

The **text** field serves two purposes depending on the count setting.

### Literal output (default)

When **count ≤ 1** (the default) and text is provided, the word is emitted **verbatim** — no search, no filtering. The text you type is the exact word spoken. This is how you pin a specific word into the poem.

### Semantic search

When **count > 1** and text is provided, the text becomes a **semantic query**. The system uses vector embeddings to find words whose meaning is similar to the query. The query can be a single word or a short phrase (e.g. "fast movement", "deep sadness").

Results are ranked by semantic similarity — the closest matches appear first. Other constraints (stress, rhyme, part of speech) are then applied on top of this ranked pool.

If no text is provided and count > 1, the system draws from the entire dictionary (no semantic preference).

---

## Parts of Speech

Each slot can be filtered to a specific **part of speech**. The available categories are:

| POS | Examples |
|-----|----------|
| noun | "nature", "ability", "time" |
| verb | "abandon", "accelerate", "write" |
| adjective | "able", "abstract", "bright" |
| adverb | "absolutely", "abroad", "about" |
| pronoun | "he", "they", "it" |
| preposition | "about", "above", "with" |
| conjunction | "and", "but", "or" |
| determiner | "this", "each", "every" |
| number | "one", "two", "hundred" |
| ordinal number | "first", "second", "third" |
| definite article | "the" |
| indefinite article | "a", "an" |
| auxiliary verb | "have", "do" |
| modal verb | "can", "should", "might" |
| linking verb | "is", "are", "was" |
| infinitive marker | "to" |
| exclamation | "oh", "wow" |

- **Blank**: No POS constraint.
- **Set**: Only words matching that part of speech are candidates.

POS filtering is applied before stress and rhyme filtering, so it narrows the pool early.

---

## Count Control

The **count** determines how many candidate words are available for each slot. During playback, the system cycles through these candidates.

| Count | Behavior |
|-------|----------|
| blank | Default = **1**. If text is provided, emit that word literally. |
| `2`, `4`, `8` | Produce exactly that many candidates. The system finds words matching all constraints, ranked by semantic similarity if text is provided. |
| typed digits | You can type any number (e.g. `3`, `16`). |

### Default mode: literal match

The default count is **1**. When text is present and count is 1, the slot outputs that exact word — this is the **literal match** mode. It bypasses all solver logic. This makes it easy to anchor specific words in your poem.

To switch a slot from literal to generative, increase the count above 1.

### Progressive expansion

When count > 1 and the initial semantic pool doesn't contain enough words satisfying all constraints, the solver progressively expands its search:

1. Widen the semantic search (500 → 2,000 → 10,000 similar words).
2. If still insufficient, search the full dictionary (dropping the semantic preference).
3. As a last resort, fill remaining slots with random words.

---

## Integrated Examples

### Example 1: Fixed haiku

A haiku with exact words and strict meter — every word is literal (default count = 1).

| Stress | Rhyme | Text | POS | Count |
|--------|-------|------|-----|-------|
| `01` | | autumn | | |
| `1` | | leaves | | |
| `1` | | fall | | |
| `1.` | | gently | | |
| `01` | | upon | | |
| `0` | | the | | |
| `1` | | ground | | |

Every slot has text with the default count, so each word is emitted verbatim. The stress patterns document the meter but don't filter (since count ≤ 1 triggers literal mode).

### Example 2: Generative rhyming couplet

Two lines that end with rhyming words, drawn from a semantic pool.

| Stress | Rhyme | Text | POS | Count |
|--------|-------|------|-----|-------|
| `0` | | the | | |
| `10` | | | adjective | `4` |
| `1` | A | night | noun | `4` |
| `0` | | the | | |
| `10` | | | adjective | `4` |
| `1` | A | | noun | `4` |

- Row 2: 4 adjectives with stress `10` (e.g. "gentle", "silent", "golden", "bitter").
- Row 3: Anchors group `A` with the rhyme of "night" (`AY T`). Produces 4 nouns rhyming with "night" — but since it has text and count > 1, it searches semantically near "night" first ("light", "sight", …).
- Row 6: Also group `A` with no text — draws from the full dictionary for nouns rhyming with `AY T`, producing words like "bright", "right", "flight", "white".

### Example 3: Semantic exploration with stress control

Find words related to "ocean" that fit iambic meter.

| Stress | Rhyme | Text | POS | Count |
|--------|-------|------|-----|-------|
| `01` | | ocean | noun | `8` |

Produces 8 nouns with unstressed-stressed pattern, semantically related to "ocean": e.g. "lagoon", "monsoon". If not enough two-syllable matches exist, the stress constraint is relaxed.

### Example 4: Wildcard stress with rhyme groups

A quatrain with flexible meter and an ABAB rhyme scheme.

| Stress | Rhyme | Text | POS | Count |
|--------|-------|------|-----|-------|
| `1.` | A | sorrow | | |
| `1.0` | B | | noun | `4` |
| `1.` | A | | noun | `4` |
| `1.0` | B | silence | noun | `4` |

- `1.` matches any word starting with a stressed syllable (1, 2, or more syllables).
- `1.0` matches words starting stressed and ending unstressed.
- Group `A` anchors on "sorrow" (rhyme `AA R OW`). Row 3 gets nouns rhyming with "-orrow".
- Group `B` anchors on "silence" (rhyme `AY L AH N S`). Row 2 gets nouns rhyming with "-ilence".
- If exact rhymes are scarce, the rhyme relaxes progressively.
