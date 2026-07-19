# Task 1 Report — Transient visual-guidance module

## Outcome

Implemented a standalone TypeScript visual-guidance module at `src/main/automation/visual-guidance.ts` without changing vision settings, agent tools, or tool registration.

## Implementation

- Added `captureVisualGuidance(page)` at the Playwright `Page` seam.
- Removes stale injected roots, then creates exactly one `#remctrl-overlay-root` with `data-remctrl-exclude="true"`, `data-remctrl-overlay="true"`, and `pointer-events:none`.
- Scans visible interactive elements using element semantics, ARIA roles, keyboard focusability, pointer cursor, and click-handler evidence.
- Draws numbered labels and a fixed SVG grid at normalized 0.1 axis intervals.
- Returns JPEG screenshot bytes in memory, CSS viewport dimensions, numbered mark metadata, normalized rectangles, and typed axis-grid metadata.
- Removes the injected root in `finally`, including when `page.screenshot()` rejects. Cleanup failures are swallowed so the original capture error is preserved.
- Remains independent from agent tools and existing vision configuration.

## Tests

Added `src/main/automation/visual-guidance.test.ts` with a mocked Playwright page/evaluate/screenshot seam covering:

1. Successful capture returns screenshot and typed viewport/mark/grid metadata and verifies the injection script contains the required root, exclusion attribute, and pointer transparency.
2. Screenshot failure still invokes cleanup with the excluded overlay selector and rethrows the screenshot error.

## Validation

- Focused test: 1 file, 2 tests passed.
- `npm test`: 21 files, 57 tests passed.
- `npm run typecheck:all`: passed.
- `npm run build`: renderer and main builds passed.

## Scope / worktree

Only the new module, its focused test, and this report are part of this task. Pre-existing worktree changes in `.codex/hooks.json`, `ENGINEERING_TODO.md`, and `todo.md` were not modified or staged.

## Fix section — review follow-up

- Cleanup now removes every `#remctrl-overlay-root` before injection and in `finally`, including stale roots that lack the exclusion attribute, guaranteeing one active root during capture.
- Discovery now walks the normal DOM and open shadow roots and recognizes contenteditable elements, label/span wrapper controls, and `onclick`, `onmousedown`, and `onkeydown` patterns alongside semantic tags, roles, focusability, and pointer cursors.
- Zero-opacity elements are omitted. Rectangles intersecting the viewport are clipped to viewport bounds before normalized metadata is generated; fully offscreen or zero-area rectangles remain omitted.
- Focused tests now execute the injected evaluator against a fake browser DOM through the mocked Playwright `evaluate` seam. They verify stale-root removal, success cleanup, screenshot-error cleanup, self-exclusion, shadow-root discovery, wrapper controls, contenteditable and handler discovery, opacity filtering, and partial-rectangle clipping.
