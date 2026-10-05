# Critical Code Review — Text2GCode

## Executive summary

Text2GCode is a self-contained browser application with useful separation between UI wiring (`text2gcode/js/app.js`), geometry (`text2gcode/js/toolpath.js`), and G-code generation (`text2gcode/js/gcode.js`). The union/offset implementation is unusually well documented, and the glyph-counter regression suite is valuable. The project is easy to run and has no build/dependency-install step.

The main concern is that this application emits machine instructions, but simulation claims and time estimates are not fully reflected in the emitted program. Treat generated files as drafts: inspect them in the target controller/simulator and dry-run before machining.

## Findings

### Medium — The simulation and time estimate do not fully model the exported program

**References:** `text2gcode/js/gcode.js:32-44, 47-65, 76-87, 142-165`; `text2gcode/index.html:159-163, 187-190`

`buildMoves()` estimates rapid motion using the user-entered `rapidFeed`, but `generate()` emits `G0` moves without a feed value. Many common controllers use a machine-configured rapid rate for `G0` and ignore feed settings there, so simulation speed and estimated time can disagree with actual execution. In addition, the optional final `G0 X0 Y0` is appended during G-code generation, after the move list and time statistics have been built; it is absent from the simulation and estimate even though “Return to origin” is checked by default. The initial safe-Z move and spindle startup are also outside that move/time model.

**Recommendation:** Model every generated motion in one shared move list, including the return-home move, and distinguish controller-defined rapid motion from feed-controlled motion. Describe the displayed duration as an estimate with explicit assumptions rather than an exact machine-time prediction.

### Medium — Offline-use documentation contradicts actual font loading behavior

**References:** `text2gcode/README.md:6-9, 46-48`; `text2gcode/js/app.js:124-134, 170-172, 195-200`; `text2gcode/js/fonts_embedded.js`

The README first explains that Roboto is embedded and other outline fonts load lazily, but later says opening `index.html` directly works with “everything (including all fonts)” embedded. The embedded font bundle contains only Roboto; the other bundled TTFs are fetched from relative paths on first selection. Browsers commonly block those fetches under `file://`, and the application itself warns users about that failure.

**Recommendation:** Correct the README to say that the default Roboto/Hershey experience works offline, while other bundled fonts require serving the folder or uploading a font; alternatively, embed the remaining fonts.

### Medium — Uploaded font filename is inserted into HTML without escaping

**References:** `text2gcode/js/app.js:698-703, 827-838`; `text2gcode/js/gcode.js:118-120`

A custom font’s label is derived from `file.name` and later interpolated directly into `topStats.innerHTML`. A crafted filename containing HTML markup can therefore become executable DOM rather than plain text. The same label is also written directly into a G-code comment, where control characters/newlines should not be trusted as metadata.

**Recommendation:** Render the label with `textContent`/DOM nodes (or a rigorously escaped helper) and sanitize control characters in all G-code comment fields. Avoid interpolating user-controlled strings into `innerHTML`.

## Test and validation assessment

The geometry regression tests are a strength: `node --test text2gcode/test/glyphs.test.js` passes **336 tests**, including counters across bundled fonts, pocket/boss offsets, and one synthetic annulus case. However, this suite is concentrated on glyph topology. It does not exercise G-code generation, feed/return-home consistency, malformed settings, or browser-level export and simulation behavior. These are important gaps for software that produces machine instructions.

**Recommended next tests:**

- Assert complete generated programs for each supported engraving mode.
- Verify every generated motion has a corresponding simulation/time-model move, including return-home behavior.
- Test feeds, depth-pass boundaries, empty/degenerate toolpaths, and numeric edge cases.
- Add browser tests for font-loading failure paths and custom-font labels.
- Validate output against the intended controller dialect and its rapid/spindle semantics.

## Lower-priority usability note

The height slider is passed to OpenType as the font’s nominal em size (`buildOpenTypeContours` uses `font.getPath(..., size)`). The visible cap height varies by font and is generally not equal to that nominal size. Since the UI calls this “Height,” consider naming it “Em size” or adding a physical-height mode; the reported output bounds already provide a useful check of the actual result.

## Verification performed

- Ran `node --test text2gcode/test/glyphs.test.js` — **336 passed, 0 failed**.
- Reviewed the static UI, geometry, G-code generation, font-loading paths, README, and current tracked-file layout.
