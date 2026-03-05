import { html, render } from "lit-html";
import "./help-element.css";

export class HelpElement extends HTMLElement {
  static define() {
    if (!customElements.get("help-element")) customElements.define("help-element", HelpElement);
  }

  private dialog?: HTMLDialogElement;

  open() {
    if (this.dialog) {
      this.dialog.close();
      this.dialog.remove();
      this.dialog = undefined;
    }

    const dialog = document.createElement("dialog");
    dialog.className = "help-dialog";

    const onClose = () => {
      dialog.close();
      dialog.remove();
      this.dialog = undefined;
    };

    render(
      html`
        <h2>Cybermuse Poem Pattern Manual</h2>
        <p>
          A poem is programmed as a sequence of <strong>slots</strong>. Each slot produces one spoken word. You control
          word selection by setting constraints on five dimensions: <strong>syllable stress</strong>,
          <strong>rhyme group</strong>, <strong>text</strong>, <strong>part of speech</strong>, and
          <strong>count</strong>.
        </p>
        <p>A blank slot (all fields empty) acts as a rest — a silent pause in the poem.</p>

        <section>
          <h3>Syllable Stress</h3>
          <p>Each word carries a stress pattern — a string of digits, one per syllable:</p>
          <table>
            <tr>
              <th>Digit</th>
              <th>Meaning</th>
            </tr>
            <tr>
              <td><code>0</code></td>
              <td>Unstressed syllable</td>
            </tr>
            <tr>
              <td><code>1</code></td>
              <td>Primary stress</td>
            </tr>
            <tr>
              <td><code>2</code></td>
              <td>Secondary stress</td>
            </tr>
          </table>
          <p>
            A slot has up to three syllable cells. Each cell is blank or one of <code>0</code>, <code>1</code>,
            <code>2</code>, <code>.</code> (wildcard). Cells concatenate left-to-right into a pattern string.
          </p>

          <h4>Matching</h4>
          <ul>
            <li><strong>Blank</strong> — no stress constraint; any word is allowed.</li>
            <li>
              <strong>Exact digits</strong> (e.g. <code>01</code>, <code>102</code>) — only words whose stress pattern
              matches exactly.
            </li>
            <li>
              <strong>Wildcard <code>.</code></strong> — matches zero or more syllables of any stress (converted to
              regex <code>[012]*</code>).
            </li>
          </ul>

          <h4>Wildcard examples</h4>
          <table>
            <tr>
              <th>Pattern</th>
              <th>Matches</th>
            </tr>
            <tr>
              <td><code>1</code></td>
              <td>One-syllable stressed words: "art", "bright"</td>
            </tr>
            <tr>
              <td><code>10</code></td>
              <td>Two-syllable, stress-first: "able", "absence"</td>
            </tr>
            <tr>
              <td><code>1.</code></td>
              <td>Any word starting with a stressed syllable</td>
            </tr>
            <tr>
              <td><code>.1</code></td>
              <td>Any word ending with a stressed syllable</td>
            </tr>
            <tr>
              <td><code>1.0</code></td>
              <td>Starts stressed, ends unstressed</td>
            </tr>
          </table>
          <p>If no words match the stress pattern, the constraint is dropped (fallback).</p>
        </section>

        <section>
          <h3>Rhyme Group</h3>
          <p>
            Slots can be assigned to a rhyme group <code>A</code>–<code>G</code>. All slots in the same group are
            constrained to rhyme with each other.
          </p>
          <ul>
            <li>
              The <strong>first slot</strong> in each group with user-entered text determines the rhyme key (via
              phoneme lookup).
            </li>
            <li>
              The solver uses <strong>progressive suffix relaxation</strong> — it starts with the full rhyme key and
              drops leading phonemes until enough candidates match.
            </li>
          </ul>
        </section>

        <section>
          <h3>Text — Literal &amp; Semantic Search</h3>
          <ul>
            <li>
              <strong>Count ≤ 1</strong> (default): text is emitted <strong>verbatim</strong> — the exact word you
              type.
            </li>
            <li>
              <strong>Count &gt; 1</strong>: text becomes a <strong>semantic query</strong>. Words are ranked by
              meaning similarity via vector embeddings.
            </li>
          </ul>
        </section>

        <section>
          <h3>Parts of Speech</h3>
          <p>Filter each slot to a specific part of speech:</p>
          <table>
            <tr>
              <th>POS</th>
              <th>Examples</th>
            </tr>
            <tr>
              <td>noun</td>
              <td>"nature", "time"</td>
            </tr>
            <tr>
              <td>verb</td>
              <td>"abandon", "write"</td>
            </tr>
            <tr>
              <td>adjective</td>
              <td>"able", "bright"</td>
            </tr>
            <tr>
              <td>adverb</td>
              <td>"absolutely", "abroad"</td>
            </tr>
            <tr>
              <td>pronoun</td>
              <td>"he", "they"</td>
            </tr>
            <tr>
              <td>preposition</td>
              <td>"about", "with"</td>
            </tr>
            <tr>
              <td>conjunction</td>
              <td>"and", "but"</td>
            </tr>
            <tr>
              <td>determiner</td>
              <td>"this", "each"</td>
            </tr>
            <tr>
              <td>number</td>
              <td>"one", "two"</td>
            </tr>
            <tr>
              <td>article</td>
              <td>"the", "a", "an"</td>
            </tr>
            <tr>
              <td>auxiliary / modal</td>
              <td>"have", "can", "should"</td>
            </tr>
            <tr>
              <td>linking verb</td>
              <td>"is", "are"</td>
            </tr>
            <tr>
              <td>exclamation</td>
              <td>"oh", "wow"</td>
            </tr>
          </table>
        </section>

        <section>
          <h3>Count Control</h3>
          <table>
            <tr>
              <th>Count</th>
              <th>Behavior</th>
            </tr>
            <tr>
              <td>blank</td>
              <td>Default = 1. If text is provided, emit that word literally.</td>
            </tr>
            <tr>
              <td><code>2</code>, <code>4</code>, <code>8</code></td>
              <td>Produce that many candidates, ranked by semantic similarity if text is provided.</td>
            </tr>
          </table>
          <p>
            When count &gt; 1 and not enough candidates are found, the solver progressively widens the search (500 →
            2,000 → 10,000 → full dictionary → random fill).
          </p>
        </section>

        <section>
          <h3>Keyboard Shortcuts</h3>
          <table>
            <tr>
              <th>Shortcut</th>
              <th>Action</th>
            </tr>
            <tr>
              <td><code>Ctrl/⌘ + Enter</code></td>
              <td>Play / re-evaluate</td>
            </tr>
            <tr>
              <td><code>Ctrl/⌘ + Shift + Enter</code></td>
              <td>Stop</td>
            </tr>
          </table>
        </section>

        <button class="help-close" type="button" @click=${onClose}>Close</button>
      `,
      dialog,
    );

    document.body.appendChild(dialog);
    this.dialog = dialog;
    dialog.showModal();
  }
}
