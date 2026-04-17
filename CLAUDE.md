# p5.export

## Missie

One-click lossless animation capture for p5.js and other canvas
sketches. Pick a project folder, click record, MP4 (or PNG sequence)
lands in `[project]/export/`. Quality and correctness over convenience:
offline encoding (Mediabunny + WebCodecs), real project environment
via iframe, Instagram-ready MP4 out of the box.

## Boom

```
p5.export/
├── index.html      UI + wiring (prjcts huisstijl)
├── p5export.js     capture engine (Mediabunny MP4 / canvas.toBlob PNG)
├── runner.js       iframe runner + bridge script
├── storage.js      File System Access helpers (persist, write, walk)
├── style.css       prjcts huisstijl
├── CREDITS.md      attributions (p5.js, Mediabunny, p5.capture)
├── README.md       full user + architecture doc
└── CLAUDE.md       this file
```

External deps (CDN, no build):
- p5.js 1.11 (UMD) — inside the iframe only
- Mediabunny (ESM, `+esm` bundle on jsdelivr, lazy-loaded per capture)

## Regels

- **Taal: Engels.** Alle UI-tekst, errors, comments, docs.
- **Geen nieuwe bestanden** tenzij expliciet gevraagd (README / CLAUDE /
  CREDITS bestaan al).
- **Geen schaduwen, geen border-radius** — prjcts huisstijl is brutalist.
  Lichte achtergrond (`#f5f5f5`), rood (`#ff0000`) alleen als accent.
- **Iframe is canoniek.** Niet terugvallen op global-mode binding in
  de parent — dat veroorzaakte de p5.waves-bug. Elke sketch moet
  draaien zoals hij standalone draait.
- **Backpressure respecteren** bij Mediabunny: `await source.add(...)`,
  seriële tick-chain, keyframe elke seconde.
- **FSA boven webkitdirectory.** File mode gebruikt `showDirectoryPicker`
  readwrite zodat exports direct naast de bronbestanden landen.
- **FPS is user-editable, renderFps is intern.** UI toont Profile + FPS
  + Duration (seconden). FPS = playback-rate; profile vult een default in
  maar user kan 'm vrij aanpassen. renderFps (wall-clock capture-rate) is
  geen UI-veld — social/edit laten 'm uncapped (backpressure throttles),
  master cap't op 2fps voor zware sketches. Format volgt het profile,
  geen UI-toggle.

## Notities

- 2026-04-17: Tool is volledig Engels (van Nederlands omgezet).
- 2026-04-17: Iframe-based runner vervangt de oude instance-mode +
  window-binding runner. Fixed de p5.waves link-met-sketch-breekt-bug.
- 2026-04-17: File mode gebruikt FSA `showDirectoryPicker` (Chrome/Edge
  only). Geen cross-browser fallback ingebouwd — user zit op Chrome.
- 2026-04-17: Preset tab weg. File is default. Exports landen in
  `[project]/export/` via dezelfde FSA-handle.
- 2026-04-17: p5.capture eruit, zelfgebouwd via Mediabunny + canvas.toBlob.
  Credits in CREDITS.md.
- 2026-04-17: `social` profile = Instagram (MP4 / H.264 / 60 fps /
  3.5 Mbps — IG accepteert 60fps, user koos 60 als default).
  `edit` = 60 fps / 20 Mbps. `master` = PNG seq (2/60).
  UI-defaults: FPS=60, Duration=90s (IG Reels max).
- 2026-04-17: Bridge override: `p5.prototype.millis` → frame-
  deterministic tijdens recording. Fixed half-speed bij slow-render
  voor millis-based sketches.
- 2026-04-17: MP4 Instagram-compat: fastStart in-memory, `mp42` major
  brand (post-finalize patch), keyframe elke seconde. Silent AAC-audio
  track EERST toegevoegd, daarna verwijderd — IG verkiest video-only.
- 2026-04-17: UI simplificatie — Render rate en Playback rate inputs
  weg. Seconds-veld toegevoegd (met live "= N frames @ N fps" hint).
  Profile bepaalt alle rates. User raakte in de war door te veel
  gelijkende number-inputs.
- 2026-04-17: Record-knop toggelt stroke ↔ fill tijdens recording.
  Stop disabled wanneer er niks opneemt. "Record again" label na done.
- 2026-04-17: `.grid` kreeg `minmax(0, 1fr) minmax(0, 1fr)` + `min-width:0`
  op children. Default `1fr` is `minmax(auto, 1fr)` en werd uitgerekt door
  intrinsieke min-content van lange `<select>` options, waardoor kolom 2
  (Seconds/Filename) buiten het 380px panel verdween.
- 2026-04-17: FPS weer als UI-veld (24/30/60 select), onafhankelijk van
  Seconds. User-edit "locked in" zodat Profile-switch de FPS niet
  overschrijft. Format-select verdwenen (profile-driven).
- 2026-04-17: Capture-snelheid — social/edit rennen nu uncapped (geen
  `frameRate()` in de bridge). WebCodecs backpressure is de throttle.
  Bij lichte sketches is 10s/30fps nu in ~1-2s wall-clock. `master` houdt
  de 2fps cap voor zware sketches.
- 2026-04-17: History van project-folders (max 5) in IDB onder
  `recentProjects`. Dedupe via `isSameEntry()`. Chip-rij onder Pick-folder
  toont recentste eerst; klik = re-permission + reopen. Stale handle
  (folder verplaatst/weg) wordt automatisch uit de lijst gegooid.
