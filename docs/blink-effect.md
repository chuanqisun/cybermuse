# Blink Effect Implementation

The blink effect in `client.js` is a simple timed CSS class toggle. Here's how it works and how to implement it.

---

## Overview

When a point is confirmed, the UI elements briefly flash on/off to give visual feedback to the user. This is driven by two constants and one function.

---

## Configuration

js

```
const BLINK_HALF_CYCLES = 6; // 3 full blinks (on→off = 1 half-cycle)
const BLINK_INTERVAL_MS = 40; // ms between each toggle
```

- `BLINK_HALF_CYCLES` controls how many times visibility is toggled. Divide by 2 to get the number of visible blinks (e.g. `6 → 3 blinks`).
- `BLINK_INTERVAL_MS` controls the speed of each toggle.

---

## CSS

Add a class that hides the element:

CSS

```
.blink-hide {
  opacity: 0;
}
```

---

## The `blinkConfirmation` Function

js

```
function blinkConfirmation() {
  // 1. Collect all elements to blink
  const targets = [];
  if (tooltip) targets.push(tooltip);
  hoverEdges.forEach((el) => targets.push(el));
  // ...add any other elements

  // 2. Toggle .blink-hide on/off for BLINK_HALF_CYCLES iterations
  let count = 0;
  function step() {
    if (count >= BLINK_HALF_CYCLES) {
      // Cleanup: restore full visibility
      targets.forEach((el) => {
        el.style.removeProperty("opacity");
        el.classList.remove("blink-hide");
      });
      return;
    }
    const hide = count % 2 === 0; // even = hide, odd = show
    targets.forEach((el) => el.classList.toggle("blink-hide", hide));
    count++;
    setTimeout(step, BLINK_INTERVAL_MS);
  }
  step();
}
```

### Step-by-step logic

| `count` | `hide`  | State   |
| ------- | ------- | ------- |
| 0       | `true`  | Hidden  |
| 1       | `false` | Visible |
| 2       | `true`  | Hidden  |
| 3       | `false` | Visible |
| 4       | `true`  | Hidden  |
| 5       | `false` | Visible |
| 6       | —       | Cleanup |
