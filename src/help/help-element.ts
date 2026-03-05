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
        <div class="help-content">
          <h2>Quick Start</h2>
          <p>
            CyberMUSE lets you live-code a poem. Each row in the grid is a <strong>slot</strong> that produces one spoken word. Press <strong>Loop</strong> to
            hear it, or turn on <strong>AI</strong> to let a Gemini agent compose for you.
          </p>
          <table>
            <tr>
              <th>Control</th>
              <th>Description</th>
            </tr>
            <tr>
              <td>Loop</td>
              <td>Start or stop the poem loop. Each cycle reads every row and speaks the resolved word.</td>
            </tr>
            <tr>
              <td>AI</td>
              <td>Toggle AI composition mode. The agent fills and edits slots automatically. Requires a Gemini API key (see Settings).</td>
            </tr>
            <tr>
              <td>Update</td>
              <td>
                Re‑evaluate all pattern constraints with the current grid data (same as pressing <span class="nowrap"><kbd>Ctrl</kbd>&nbsp;/&nbsp;<kbd>⌘</kbd>&nbsp;+&nbsp;<kbd>Enter</kbd></span>
                  >Enter</kbd
                >
                while playing).
              </td>
            </tr>
            <tr>
              <td>WPM</td>
              <td>Words per minute — controls playback speed (1–600).</td>
            </tr>
            <tr>
              <td>Settings</td>
              <td>Configure your Gemini API key. Only needed for AI mode.</td>
            </tr>
            <tr>
              <td>Clear</td>
              <td>Reset the entire grid to a blank state.</td>
            </tr>
            <tr>
              <td>Help</td>
              <td>Opens this dialog.</td>
            </tr>
          </table>

          <table>
            <tr>
              <th>Shortcut</th>
              <th>Action</th>
            </tr>
            <tr>
              <td><span class="nowrap"></span><kbd>Ctrl</kbd>&nbsp;/&nbsp;<kbd>⌘</kbd>&nbsp;+&nbsp;<kbd>Enter</kbd></span></td>
              <td>Start playback / re‑evaluate patterns while playing.</td>
            </tr>
            <tr>
              <td><span class="nowrap"><kbd>Ctrl</kbd>&nbsp;/&nbsp;<kbd>⌘</kbd>&nbsp;+&nbsp;<kbd>Shift</kbd>&nbsp;+&nbsp;<kbd>Enter</kbd></span></td>
              <td>Stop playback.</td>
            </tr>
          </table>

          <h2>Voicing</h2>
          <p>A poem is a sequence of slots. Each slot produces one spoken word. A blank row (all fields empty) acts as a silent rest.</p>

          <h3>Syllable Stress</h3>
          <p>
            Each word carries a stress pattern — a string of digits, one per syllable. A slot has up to three syllable cells. Each cell is blank or one of
            <code>0</code> (unstressed), <code>1</code> (primary stress), <code>2</code> (secondary stress), or <code>.</code> (matches zero or more
            syllables of any stress). Cells concatenate left-to-right.
          </p>
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
          <p>If no words match the stress pattern, the constraint is dropped.</p>

          <h3>Rhyme Groups</h3>
          <p>
            Assign slots to a rhyme group (<code>A</code>–<code>G</code>). All slots in the same group are constrained to rhyme with each other. The first slot
            in each group with user-entered text anchors the rhyme key. The solver uses progressive suffix relaxation to find the tightest partial rhyme when
            exact matches are scarce.
          </p>

          <h2>Word Selection &amp; Patterning</h2>
          <p>Each slot's text, part of speech, and count fields work together to control which words are eligible to fill it.</p>

          <h3>Text</h3>
          <p>
            When count ≤ 1 (default), the text you type is the exact word spoken (literal mode). When count &gt; 1, the text becomes a
            <strong>semantic query</strong> — the system finds words whose meaning is similar using vector embeddings. Leave text blank with count &gt; 1 to
            draw from the full dictionary.
          </p>

          <h3>Part of Speech</h3>
          <p>Filter candidates to a specific part of speech. Applied before stress and rhyme constraints.</p>
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

          <h3>Count</h3>
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
            When count &gt; 1 and not enough candidates are found, the solver progressively widens the search.
          </p>
        </div>
        <footer class="help-footer">
          <button class="help-close" type="button" @click=${onClose}>Close</button>
        </footer>
      `,
      dialog
    );

    document.body.appendChild(dialog);
    this.dialog = dialog;
    dialog.showModal();
  }
}
