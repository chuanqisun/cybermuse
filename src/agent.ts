import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { BehaviorSubject, EMPTY, Observable, Subject, type Subscription, from, merge } from "rxjs";
import { catchError, exhaustMap, filter, startWith, switchMap, tap } from "rxjs/operators";
import { toJSONSchema, z } from "zod";
import manual from "../docs/manual.md?raw";
import type { GridEdit, GridWord } from "./types";

/* ------------------------------------------------------------------ */
/*  Zod schema – mirrors the shared GridEdit interface                */
/* ------------------------------------------------------------------ */

const gridEditSchema = z.object({
  action: z.enum(["patch", "clear", "prepend", "append", "pause"]),
  line: z.number().optional(),
  beforeLine: z.number().optional(),
  afterLine: z.number().optional(),
  syllables: z.string().optional(),
  rhymeGroup: z.string().optional(),
  text: z.string().optional(),
  pos: z.string().optional(),
  count: z.number().optional(),
});

const agentResponseSchema = z.object({
  edits: z.array(gridEditSchema).min(1).max(3),
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Compact view of a grid line for the LLM prompt. */
export interface GridLineView {
  line: number;
  pause: boolean;
  syllables: string;
  rhymeGroup: string;
  text: string;
  pos: string;
  count: number;
}

/** Convert GridWord[] → compact line views for the LLM. */
export function gridWordsToLineViews(words: GridWord[]): GridLineView[] {
  return words.map((w) => ({
    line: w.index,
    pause: w.blank,
    syllables: w.blank ? "" : (w.syllables ?? ""),
    rhymeGroup: w.blank ? "" : (w.rhymeGroup ?? ""),
    text: w.blank ? "" : (w.text ?? ""),
    pos: w.blank ? "" : (w.pos ?? ""),
    count: w.blank ? 0 : (w.count ?? 0),
  }));
}

/* ------------------------------------------------------------------ */
/*  Error feedback                                                    */
/* ------------------------------------------------------------------ */

/** Feedback from a failed generation attempt, fed into the next prompt. */
export interface GenerationFeedback {
  rawOutput: string;
  error: string;
}

/** An error carrying the raw LLM output that failed to parse/validate. */
export class GenerationError extends Error {
  rawOutput: string;
  constructor(message: string, rawOutput: string) {
    super(message);
    this.rawOutput = rawOutput;
    this.name = "GenerationError";
  }
}

/* ------------------------------------------------------------------ */
/*  Edit decomposition                                                */
/* ------------------------------------------------------------------ */

/** Field keys that can be individually applied. */
const EDIT_FIELD_KEYS: (keyof GridEdit)[] = ["syllables", "rhymeGroup", "text", "pos", "count"];

/**
 * Break a single GridEdit into granular per-field edits.
 *
 * - `clear` / `pause`: returned as-is (single atomic operation).
 * - `patch`: one patch per present field.
 * - `prepend` / `append`: insert empty row, then one patch per field.
 */
export function decomposeEdit(edit: GridEdit): GridEdit[] {
  if (edit.action === "clear" || edit.action === "pause") {
    return [edit];
  }

  const presentFields = EDIT_FIELD_KEYS.filter((k) => edit[k] !== undefined);
  if (presentFields.length === 0) {
    return [edit]; // nothing to decompose
  }

  const result: GridEdit[] = [];

  if (edit.action === "prepend" || edit.action === "append") {
    // Step 1: insert empty row
    const insertEdit: GridEdit = { action: edit.action };
    if (edit.action === "prepend") insertEdit.beforeLine = edit.beforeLine;
    else insertEdit.afterLine = edit.afterLine;
    result.push(insertEdit);

    // Step 2: patch each field on the new row
    const newLine = edit.action === "prepend" ? edit.beforeLine! : edit.afterLine! + 1;
    for (const key of presentFields) {
      result.push({ action: "patch", line: newLine, [key]: edit[key] });
    }
  } else {
    // patch: one partial patch per field
    for (const key of presentFields) {
      result.push({ action: "patch", line: edit.line, [key]: edit[key] });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Edit projection                                                   */
/* ------------------------------------------------------------------ */

/** Default line view for a newly inserted blank/pause row. */
function blankLine(line: number): GridLineView {
  return { line, pause: true, syllables: "", rhymeGroup: "", text: "", pos: "", count: 0 };
}

/**
 * Simulate applying a list of {@link GridEdit}s to a snapshot of
 * {@link GridLineView}s, returning the projected state.
 *
 * This mirrors the real grid's `applyEdit` logic but operates on
 * plain data so we can show the AI a single consistent picture
 * instead of current-state + pending-edits.
 */
export function projectEdits(views: GridLineView[], edits: GridEdit[]): GridLineView[] {
  // Deep-clone so we never mutate the caller's array
  let grid = views.map((v) => ({ ...v }));

  for (const edit of edits) {
    switch (edit.action) {
      case "patch": {
        if (edit.line == null) continue;
        const row = grid.find((r) => r.line === edit.line);
        if (!row) continue;
        if (edit.syllables !== undefined) row.syllables = edit.syllables;
        if (edit.rhymeGroup !== undefined) row.rhymeGroup = edit.rhymeGroup;
        if (edit.text !== undefined) row.text = edit.text;
        if (edit.pos !== undefined) row.pos = edit.pos;
        if (edit.count !== undefined) row.count = edit.count;
        // A row with any content set is no longer a pause
        if (edit.text || edit.syllables || edit.pos) row.pause = false;
        break;
      }
      case "clear": {
        if (edit.line == null) continue;
        const idx = grid.findIndex((r) => r.line === edit.line);
        if (idx < 0) continue;
        grid[idx] = blankLine(edit.line);
        break;
      }
      case "prepend": {
        if (edit.beforeLine == null) continue;
        const idx = grid.findIndex((r) => r.line === edit.beforeLine);
        if (idx < 0) continue;
        // Insert a new row; shift line numbers at and after this index
        for (let i = idx; i < grid.length; i++) grid[i].line++;
        const newRow = blankLine(edit.beforeLine);
        if (edit.text !== undefined) {
          newRow.text = edit.text;
          newRow.pause = false;
        }
        if (edit.syllables !== undefined) {
          newRow.syllables = edit.syllables;
          newRow.pause = false;
        }
        if (edit.rhymeGroup !== undefined) newRow.rhymeGroup = edit.rhymeGroup;
        if (edit.pos !== undefined) {
          newRow.pos = edit.pos;
          newRow.pause = false;
        }
        if (edit.count !== undefined) newRow.count = edit.count;
        grid.splice(idx, 0, newRow);
        break;
      }
      case "append": {
        if (edit.afterLine == null) continue;
        const idx = grid.findIndex((r) => r.line === edit.afterLine);
        if (idx < 0) continue;
        const insertIdx = idx + 1;
        // Shift line numbers for rows after the insertion point
        for (let i = insertIdx; i < grid.length; i++) grid[i].line++;
        const newLine = edit.afterLine + 1;
        const newRow = blankLine(newLine);
        if (edit.text !== undefined) {
          newRow.text = edit.text;
          newRow.pause = false;
        }
        if (edit.syllables !== undefined) {
          newRow.syllables = edit.syllables;
          newRow.pause = false;
        }
        if (edit.rhymeGroup !== undefined) newRow.rhymeGroup = edit.rhymeGroup;
        if (edit.pos !== undefined) {
          newRow.pos = edit.pos;
          newRow.pause = false;
        }
        if (edit.count !== undefined) newRow.count = edit.count;
        grid.splice(insertIdx, 0, newRow);
        break;
      }
      case "pause": {
        if (edit.afterLine == null) continue;
        const idx = grid.findIndex((r) => r.line === edit.afterLine);
        if (idx < 0) continue;
        const insertIdx = idx + 1;
        for (let i = insertIdx; i < grid.length; i++) grid[i].line++;
        grid.splice(insertIdx, 0, blankLine(edit.afterLine + 1));
        break;
      }
    }
  }

  return grid;
}

/* ------------------------------------------------------------------ */
/*  GenerateEdits – abstracted for testing                            */
/* ------------------------------------------------------------------ */

/** Function signature for LLM calls. Inject a mock for tests. */
export type GenerateEdits = (lineViews: GridLineView[], transcript: string, feedback?: GenerationFeedback | null) => Promise<GridEdit[]>;

/** Create a real Gemini‑backed GenerateEdits function. */
export function createGeminiGenerator(apiKey: string): GenerateEdits {
  const ai = new GoogleGenAI({ apiKey });

  return async (lineViews, transcript, feedback) => {
    const lastLines = transcript.split("\n").slice(-20).join("\n");
    const maxLine = lineViews.length > 0 ? lineViews[lineViews.length - 1].line : -1;

    let feedbackSection = "";
    if (feedback) {
      feedbackSection = `
<Previous failed attempt>
<Raw output>
${feedback.rawOutput}
</Raw output>
<Error>
${feedback.error}
</Error>
Your previous response could not be applied. Review the error above and avoid making the same mistake.
</Previous failed attempt>

`;
    }

    const userPrompt = `
${feedbackSection}<Current grid configuration>
${JSON.stringify(lineViews, null, 2)}
</Current grid configuration>

<Valid line range>
Line numbers are 0-indexed. ${maxLine >= 0 ? `The current grid has lines 0 through ${maxLine} (inclusive). Only use line numbers within this range.` : "The grid is currently empty. Use line 0 for your first edit."}
</Valid line range>

<Poem generated so far>
${lastLines || "(no transcript yet)"}
</Poem generated so far>

<Task>
Generate 1 to 3 edits to evolve the poem pattern. Be creative and experimental.
Use pauses (blank rows) to create rhythm and breathing room between words.
</Task>
`.trim();

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: userPrompt,
      config: {
        systemInstruction: `
<Role>
You are a machine with a real soul inside an autonomous poem writing system.
</Role>

<System manual>
${manual.trim()}
</System manual>

<Available edit operations>
- "patch": modify an existing line's fields (requires "line")
- "clear": reset a line to blank/pause (requires "line")
- "prepend": insert a new line before another (requires "beforeLine")
- "append": insert a new line after another (requires "afterLine")
- "pause": insert a blank row (silent rest) after the given line (requires "afterLine"). This is the easiest way to add rhythmic pauses.
</Available edit operations>

<Line numbering rules>
- Line numbers are 0-indexed and correspond to the "line" field in the grid configuration.
- For "patch" and "clear", "line" must be an existing line number shown in the grid (0 to the maximum line number).
- For "prepend", "beforeLine" must be an existing line number.
- For "append" and "pause", "afterLine" must be an existing line number.
- Edits are applied sequentially. Insert operations (prepend, append, pause) shift subsequent line numbers by +1. Account for this when generating multiple edits in the same response.
</Line numbering rules>

<Poetic voicing>
- A blank row acts as a silent pause during playback. Use pauses to create rhythm, breathing room, and dramatic effect. Avoid consecutive pauses.
- Generally use imbic foot to place stress at the end of the word to create a strong rhythm, but feel free to experiment with different patterns and enjambment.
- Focus on changing the semantic text. Avoid over manipulating syllable counts, and espacially avoid manipulating the pattern counter unless the word has changed.
</Poetic voicing>

Respond with structured JSON containing edit operations to modify the poem grid.`.trim(),
        responseMimeType: "application/json",
        responseJsonSchema: toJSONSchema(agentResponseSchema),
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.MINIMAL,
        },
        temperature: 0.4,
      },
    });

    const raw = response.text ?? "";
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new GenerationError(`Failed to parse LLM response as JSON: ${raw.slice(0, 200)}`, raw);
    }
    try {
      const parsed = agentResponseSchema.parse(json);
      return parsed.edits;
    } catch (e) {
      throw new GenerationError(`LLM response failed schema validation: ${e instanceof Error ? e.message : String(e)}`, raw);
    }
  };
}

/* ------------------------------------------------------------------ */
/*  Agent – reactive edit loop                                        */
/* ------------------------------------------------------------------ */

const REFILL_THRESHOLD = 5;
const POLL_INTERVAL_MS = 200;

/** Default random delay range between individual field edits (ms). */
export const DEFAULT_FIELD_DELAY_MIN_MS = 100;
export const DEFAULT_FIELD_DELAY_MAX_MS = 200;

export interface AgentConfig {
  /** LLM call function (real or mock). */
  generate: GenerateEdits;
  /** Returns the current grid words. */
  getGridWords: () => GridWord[];
  /** Returns the current transcript text. */
  getTranscript: () => string;
  /** Called each time an edit should be applied (shared GridEdit). */
  onEdit: (edit: GridEdit) => void;
  /** Called when the LLM generation fails (parse / validation error). */
  onGenerationError?: () => void;
  /** Minimum delay between individual field edits (ms). Default: 100. */
  fieldDelayMinMs?: number;
  /** Maximum delay between individual field edits (ms). Default: 3000. */
  fieldDelayMaxMs?: number;
}

export class Agent {
  private active$ = new BehaviorSubject<boolean>(false);
  private subscription: Subscription;
  private queue: GridEdit[] = [];
  /** Decomposed per-field edits waiting to be emitted. */
  private fieldQueue: GridEdit[] = [];
  /** Feedback from the last failed generation, sent on the next call. */
  private lastFeedback: GenerationFeedback | null = null;
  private config: AgentConfig;
  private fieldDelayMinMs: number;
  private fieldDelayMaxMs: number;

  constructor(config: AgentConfig) {
    this.config = config;
    this.fieldDelayMinMs = config.fieldDelayMinMs ?? DEFAULT_FIELD_DELAY_MIN_MS;
    this.fieldDelayMaxMs = config.fieldDelayMaxMs ?? DEFAULT_FIELD_DELAY_MAX_MS;

    this.subscription = this.active$
      .pipe(
        switchMap((active) => {
          if (!active) {
            this.queue = [];
            this.fieldQueue = [];
            return EMPTY;
          }

          const needsRefill$ = new Subject<void>();

          /* Producer – call LLM to fill the queue */
          const producer$ = needsRefill$.pipe(
            startWith(undefined),
            filter(() => this.queue.length < REFILL_THRESHOLD),
            exhaustMap(() => {
              const words = this.config.getGridWords();
              const lineViews = gridWordsToLineViews(words);
              // Project pending edits onto current state so the LLM
              // sees a single consistent grid instead of state + queue.
              const projected = projectEdits(lineViews, this.queue);
              const transcript = this.config.getTranscript();
              const feedback = this.lastFeedback;
              return from(this.config.generate(projected, transcript, feedback)).pipe(
                tap(() => {
                  this.lastFeedback = null; // clear on success
                }),
                catchError((err: unknown) => {
                  console.error("Agent LLM error:", err);
                  if (err instanceof GenerationError) {
                    this.lastFeedback = { rawOutput: err.rawOutput, error: err.message };
                  } else {
                    this.lastFeedback = {
                      rawOutput: "",
                      error: err instanceof Error ? err.message : String(err),
                    };
                  }
                  this.config.onGenerationError?.();
                  // Schedule a retry so the feedback reaches the next call
                  setTimeout(() => needsRefill$.next(), POLL_INTERVAL_MS);
                  return EMPTY;
                })
              );
            }),
            tap((edits) => {
              this.queue.push(...edits);
            })
          );

          /* Consumer – decompose edits into per-field operations and
             emit them one at a time with random delays. */
          const consumer$ = new Observable<void>((_subscriber) => {
            let timeoutId: ReturnType<typeof setTimeout> | null = null;

            const scheduleNext = () => {
              const delay = this.fieldQueue.length > 0 ? randomInt(this.fieldDelayMinMs, this.fieldDelayMaxMs) : POLL_INTERVAL_MS;

              timeoutId = setTimeout(() => {
                let consumed = false;

                // Decompose the next queued edit into individual field edits
                if (this.fieldQueue.length === 0 && this.queue.length > 0) {
                  const edit = this.queue.shift()!;
                  this.fieldQueue.push(...decomposeEdit(edit));
                  consumed = true;
                }

                // Apply one field edit
                if (this.fieldQueue.length > 0) {
                  const fieldEdit = this.fieldQueue.shift()!;
                  this.config.onEdit(fieldEdit);
                }

                // Request a refill when we just consumed an edit from the
                // main queue and it dropped below threshold
                if (consumed && this.queue.length < REFILL_THRESHOLD) {
                  needsRefill$.next();
                }

                scheduleNext();
              }, delay);
            };

            scheduleNext();

            return () => {
              if (timeoutId != null) clearTimeout(timeoutId);
            };
          });

          return merge(producer$, consumer$);
        })
      )
      .subscribe();
  }

  /** Start the agent loop. */
  start(): void {
    this.active$.next(true);
  }

  /** Stop the agent loop and clear the queue. */
  stop(): void {
    this.active$.next(false);
  }

  /** Whether the agent is currently active. */
  get isActive(): boolean {
    return this.active$.value;
  }

  /** Stop the agent and release all subscriptions. */
  destroy(): void {
    this.active$.next(false);
    this.active$.complete();
    this.subscription.unsubscribe();
  }
}

/* ------------------------------------------------------------------ */
/*  Utilities                                                         */
/* ------------------------------------------------------------------ */

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
