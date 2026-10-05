# ✦ Text2GCode — CNC Text Engraving Generator

A self-contained static website that converts **text + a font choice** into a
**CNC GCode** file for engraving. No build step, no server-side code — just open
`index.html` in a browser (or serve the folder with any static file server).

## Features

- **Multiple fonts (loaded dynamically)**
  - Roboto is embedded and ready instantly; 15 more outline fonts (TTF) load
    on first use and are then cached: Montserrat, Oswald, Bebas Neue, Anton,
    Orbitron, Orbitron Black, Righteous, Lora, Playfair Display, Merriweather,
    Courier Prime, Pacifico, Dancing Script, Caveat, Lobster
  - 7 bundled single-stroke engraving fonts (Hershey): Sans 1-stroke, Sans bold,
    Serif medium/bold, Script 1-stroke/medium, Gothic English
  - **Load your own `.ttf` / `.otf`** via the upload button — any normal font works
- **Engraving modes**
  - **Single line** — fast centerline engraving using single-stroke fonts
  - **Boss** — leaves the letters as a raised region: all glyphs are unioned
    (letters considered together), then the boundary is offset OUTWARD by the
    tool radius. Overlapping letters merge into a single boundary, so no cut
    line runs between touching letters. Letter counters (holes, e.g. in O) stay
    intact and are traced as well.
  - **Pocket** — contour-parallel pocketing: rings that follow the letter
    shapes. The first pass hugs the boundary (tool edge exactly on it, offset
    inward by the tool radius), then rings step inward by the stepover until
    the pocket is fully cleared. Also operates on the union, so overlapping
    letters pocket as one.
- **Layout controls**: text height, multi-line text, line spacing, letter spacing, alignment
- **Tool controls**: diameter, depth per pass, multiple depth passes
- **Machine settings**: safe Z, cut depth, feeds (XY + plunge), spindle RPM, return to home
- **Live preview** of the toolpath on a gridded canvas (cut swathes shown at tool width)
- **▶ Simulate** — animates the exact path the machine will take, including rapids
  (dashed), plunges and multiple depth passes
- **GCode output**: G90/G21/G17, M3/M5 spindle control, per-pass depth comments,
  F-feeds, download as `.nc` or copy to clipboard

## Usage

```
# from the cnc folder
python3 -m http.server 8000
# then open http://localhost:8000/text2gcode/
```

Or simply open `index.html` directly — everything (including all fonts) is
embedded in the page, no internet and no web server needed. This also works
when opened via `file://` in Safari, which blocks network requests for local
files.

## How it works

| Stage | Detail |
|---|---|
| Font parsing | `opentype.js` parses TTF/OTF; glyph outlines are flattened into polylines. Fonts load lazily (fetched + parsed on first selection, then cached) |
| Single-stroke | Embedded Hershey font data (path strokes + derived advances) |
| Union | `polybooljs` boolean union per overlap-cluster (bbox grouping keeps it fast — no union cost for well-separated text) |
| Offsetting | Clipper (ClipperOffset) with round joins — handles acute corners, removes self-intersections, auto-drops features narrower than the tool |
| Pocket fill | Contour-parallel rings: iterative inward Clipper offsets (tool radius first, then stepover) with self-intersection cleanup per ring |
| GCode | Expand polylines into depth passes: rapid → plunge → feed → retract |

GCode uses millimeters, absolute positioning (G90), the XY plane (G17) and
origin at the bottom-left of the text block.

## Safety

⚠️ Always air-cut / dry-run and verify the generated GCode in your machine's
simulator before cutting real material.

## Tests

Geometry regression tests (no dependencies — uses node's built-in test runner):

```
node --test text2gcode/test/glyphs.test.js
```

They assert that glyph counters (the holes in b, d, o, 8, %, …) survive the
union for every bundled outline font, plus pocket/boss ring behaviour and
Clipper-offset sanity. The original regression they guard against: Roboto's
`d` (also b, p, q, g) has a counter that tucks under its separately-drawn
stem — a naive "crossing loops are strokes" rule fills it in.

## Troubleshooting

**Something broken? An error box appears in the bottom-right of the page**
listing every uncaught error — click "⧉ Copy report" and paste it wherever you
report the bug (it includes the browser user-agent, so you don't even need to
know the Safari version).

For deeper inspection in Safari:

1. **macOS:** Safari → Settings → Advanced → enable *"Show features for web
   developers"* (older versions: *"Show Develop menu in menu bar"*). Then
   **Develop → Show Web Inspector** → *Console* tab. Reload the page and copy
   anything in red.
2. **iPhone / iPad:** Settings → Apps → Safari → Advanced → turn on *Web
   Inspector*, connect the device to a Mac by cable, then on the Mac:
   Safari → Develop → *[your device]* → the page.
3. **No Mac around:** plug the device into a Windows/Linux box with Chrome and
   use `chrome://inspect` for the same result.

## Credits

- [opentype.js](https://opentype.js.org) (MIT) — font parsing
- [polybooljs](https://github.com/voidqk/polybooljs) (MIT) — boolean polygon union for boss & pocket modes
- [ClipperLib](https://sourceforge.net/projects/polyclipping/) (Clipper, Angus Johnson) — robust polygon offsetting with self-intersection removal
- [hersheytext](https://github.com/techninja/hersheytextjs) (MIT) — Hershey single-stroke font data
- Fonts from [Google Fonts](https://fonts.google.com) (OFL licensed)