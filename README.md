# p5.export

One-click lossless animation capture for p5.js sketches (and any other
canvas-based animation). Point it at a project folder, press Record, and
a ready-to-post MP4 (or a lossless PNG sequence) lands in
`[project]/export/` right next to the sources.

Offline H.264 encoding via Mediabunny + WebCodecs — no realtime screen
recorder, no round-trip through the Downloads folder. The sketch runs in
an iframe built from your project's real `index.html`, so addons that
latch on at load time (p5.waves, p5.svg, p5.sound, …) behave exactly as
they do standalone.

The three-profile shape (social / edit / master) and the post-draw hook
pattern are inspired by
[p5.capture](https://github.com/tapioca24/p5.capture) (MIT, © tapioca24).
See [CREDITS.md](CREDITS.md).

## Why

Realtime encoders (MediaRecorder, screen-record) visibly stumble on
dense p5 animations — wave shifts, flow fields, moiré patterns. p5.export
renders the sketch, hands each finished frame to an offline H.264
encoder or writes it as a lossless PNG, then encodes to a final MP4 only
once every frame is in. The output shows what the sketch actually drew,
not what a realtime encoder could squeeze into the bandwidth.

Because capture is offline, **wall-clock time is decoupled from
playback time**. Lightweight sketches capture faster than real-time
(10s/60fps in a second or two); heavy sketches on the `master` profile
get 500 ms per frame to finish drawing and still produce smooth 60 fps
output.

## Quick start

1. Serve the folder over a local web server, e.g.
   `http://localhost/p5.export/`. `file://` won't work — blob URLs for
   the project files need an HTTP origin.
2. **Pick folder…** — choose a project directory containing
   `index.html` + your sketch `.js` + any libs. Grant readwrite
   permission so exports can land next to the sources.
3. Pick a **Profile** (Instagram / Edit master / Lossless PNG), a **FPS**
   (24 / 30 / 60) and a **Duration** in seconds. The hint under the
   duration shows the computed frame count and the rough file size.
4. Press **● Record**. Each captured frame is encoded on the fly. When
   the target frame count is hit, the MP4 is finalised and written to
   `[project]/export/YYYYMMDD_HHMMSS.mp4`. The status line turns into a
   clickable preview link.

Press **■ Stop now and save** at any point to finalise the capture
early with whatever frames you've got. Click **● Record again** for a
new take (fresh timestamp, no collisions).

## UI

```
OUTPUT      [path]                [Choose folder…] [×]
[ File | Generic ]

PROJECT FOLDER
[Pick folder…]  [path]
RECENT          [membrane ×] [flow-field ×] [grid-100 ×]

PROFILE                  FPS
[Instagram ▾]            [60 ▾]
DURATION                 FILENAME
[90] sec                 [p5export]
= 5400 frames · ~39.4MB

[● Record]  [■ Stop now and save]

C:\> recording — 5400 frames → mp4
     the canvas is holding its breath.
```

- **Profile** picks the preset (format + bitrate). Instagram = MP4 @
  3.5 Mbps. Edit master = MP4 @ 20 Mbps. Lossless = PNG sequence.
- **FPS** is the playback rate of the output file. Defaults to 60.
  Changing Profile resets FPS to the preset's default — unless you've
  already touched it manually, in which case your choice is respected.
- **Duration** is in seconds. The frame count is shown live.
- **Recent** chips show the last five project folders you picked.
  Click to reopen (browser re-asks for permission). × removes one.
- **Format** and **render fps** are not UI controls. Format is decided
  by Profile. Render fps (wall-clock capture speed) is left uncapped
  for MP4 profiles — WebCodecs backpressure throttles so there's no
  queue blow-up. The `master` profile keeps an explicit 2 fps cap so
  heavy sketches have time per frame.

## Modes

### File mode (default)

Uses the **File System Access API** (`showDirectoryPicker`, readwrite)
to grant the tool permission on a project folder. The tool then:

- Recursively reads every file (skipping any pre-existing `export/`
  subfolder so old captures don't feed back in).
- Takes the project's `index.html`, rewrites every relative `src` /
  `href` to a blob URL pointing at the in-memory copy of that file,
  and injects a short bridge script at the top of `<head>`.
- Loads the resulting HTML in an iframe — the sketch runs in its real
  environment (same global scope, same load order, same auto-start
  path for p5 global mode).
- Persists the folder handle in IndexedDB so it shows up in the
  **Recent** chip row on the next visit.
- Writes exports back into the same folder under `export/` using the
  already-granted readwrite handle.

Chrome / Edge only (File System Access API).

### Generic mode

Paste any p5 sketch into the textarea. The pasted code is wrapped in a
synthetic `File` and flows through the same iframe runner. No project
folder, no libs — useful for testing snippets. Output goes to the
separate **Output** folder at the top of the panel (or Downloads if
unset).

## Profiles

| Profile     | Format | Render fps   | Playback fps | Bitrate  | Use for |
|-------------|--------|--------------|--------------|----------|---------|
| Instagram   | mp4    | uncapped     | 60           | 3.5 Mbps | IG feed / Reels upload. 60 fps accepted; transcode-friendly. |
| Edit master | mp4    | uncapped     | 60           | 20 Mbps  | MP4 masters for Premiere / DaVinci import. |
| Lossless    | png    | 2            | 60           | —        | PNG sequence → local ffmpeg. |

### Why `master` caps render at 2 fps

`master` intentionally runs `frameRate(2)` so heavy draws have up to
500 ms to complete each frame. The MP4 is still played back at 60 fps,
so the final video looks smooth — **but only for sketches whose
animation reads time from `millis()` / `deltaTime`**. The bridge
overrides those inside the iframe to be frame-deterministic
(`millis() = frameCount * (1000 / playbackFps)`) so sketch time
advances 1:1 with playback, regardless of real wall-clock.

Sketches that animate via `frameCount` directly will look slowed down
on `master`. Stick to Instagram / Edit for those, or rewrite the time
source to be millis-based.

## Lossless master workflow (PNG → MP4)

With the **Lossless PNG** profile, frames stream straight to
`[project]/export/YYYYMMDD_HHMMSS/frame_00001.png…` via the File System
Access API. No zip, no memory ceiling — masters can be longer than RAM
would allow.

Then assemble locally with ffmpeg:

**H.264 (small, universal):**
```bash
ffmpeg -framerate 60 -i frame_%05d.png \
  -c:v libx264 -crf 15 -preset slow -pix_fmt yuv420p \
  -movflags +faststart master.mp4
```

**ProRes 422 HQ (video editing, 10-bit colour):**
```bash
ffmpeg -framerate 60 -i frame_%05d.png \
  -c:v prores_ks -profile:v 3 -pix_fmt yuv422p10le \
  master.mov
```

**AV1 (smallest, modern, slow):**
```bash
ffmpeg -framerate 60 -i frame_%05d.png \
  -c:v libsvtav1 -crf 28 -preset 6 -pix_fmt yuv420p \
  master.mkv
```

## Instagram tuning

The MP4 output is prepared to pass the common platform ingest checks:

- **Faststart** (`moov` atom at file start, Mediabunny's
  `fastStart: 'in-memory'`) — lets uploaders index the file before it's
  fully transferred.
- **`mp42` major brand** (patched after finalize) — preferred over
  `isom` by iOS Photos, Instagram, and several mobile clients.
- **Forced keyframe every second** — downstream HLS packagers can seek
  and thumbnail without rebuilding the stream.
- **Video-only** — no silent audio track. Instagram's transcoder
  accepts video-without-audio for feed; for Reels, experiment if a
  specific upload keeps failing.
- **H.264 High profile** via WebCodecs — compatible with every modern
  uploader; level is picked automatically based on canvas size.

If IG still rejects, the most common remaining causes are **canvas
dimensions** (square 1:1 for feed = `createCanvas(1080, 1080)`;
vertical 9:16 for Reels = `createCanvas(1080, 1920)`) and **duration**
(feed ≤ 60 s, Reels ≤ 90 s).

## Architecture

```
┌────────── parent page (p5.export) ──────────┐
│  UI (prjcts huisstijl)                       │
│  p5export.startCapture({ canvas, … })        │
│    └─ Mediabunny CanvasSource → BufferTarget │
│  P5ExportRunner.run({ files, mainFile, … })  │
│    └─ iframe (blob URL of rewritten HTML)    │
└──────────────────┬───────────────────────────┘
                   │ postMessage
                   ▼
┌────────── iframe (sketch's environment) ────┐
│  bridge script (injected first)              │
│    ├ p5.prototype.registerMethod('post')     │
│    │   → postdraw message per sketch frame   │
│    ├ rAF fallback if no p5                   │
│    └ millis() / deltaTime override           │
│  project's index.html → loads libs + sketch  │
└──────────────────────────────────────────────┘
```

- **runner.js** builds the iframe, injects the bridge, relays postdraw
  messages, and applies the bridge's frameRate cap (only when set —
  `master` only) and deterministic-time overrides during recording.
- **p5export.js** takes the iframe's canvas (mirrored into a parent-realm
  canvas so Mediabunny and `toBlob` always see a native
  `HTMLCanvasElement`) and turns post-draw ticks into encoded frames.
  Backpressure-aware (awaits `source.add(...)`), serializes ticks on a
  promise chain, forces keyframes per second, patches `ftyp` brand.
- **storage.js** wraps the File System Access API — persists the last
  output directory handle and up to five recent project-folder handles
  in IndexedDB, walks a folder recursively, and writes blobs to nested
  subpaths.
- **index.html** holds the UI and wires everything together.

The iframe approach means: **whatever runs standalone should capture
correctly.** Load order, global scope, CDN imports, custom rAF loops
and non-p5 sketches all work without special-casing in the parent.

## API

### `p5export.startCapture(options)`

| Option        | Default      | Description                                          |
|---------------|--------------|-------------------------------------------------------|
| `canvas`      | *required*   | HTMLCanvasElement to capture (any realm)              |
| `profile`     | —            | `'social'` \| `'edit'` \| `'master'` (optional)       |
| `frames`      | 1200         | Total frame count, then auto-stop                     |
| `renderFps`   | —            | `frameRate()` applied in the sketch (if set)          |
| `playbackFps` | 60           | Framerate of the final file                           |
| `format`      | `'mp4'`      | `'mp4'` \| `'png'`                                    |
| `filename`    | `'p5export'` | Base filename for output                              |
| `onDone`      | —            | `(blob, info) => void` — called on completion         |
| `onFrame`     | —            | `(blob, info) => void` — per-frame (PNG mode)         |
| `bitrateMbps` | 20           | Target bitrate for MP4                                |

Returns `{ tick, stop, abort, config }`. The parent calls `tick()` on
each iframe post-draw event; `stop()` finalises early with what's been
captured.

### `P5ExportRunner.run({ files, mainFile, renderFps, playbackFps, holderId })`

Builds an iframe from `files` (an array of `File` objects with
`webkitRelativePath`), appends it to the given holder, and returns a
runner with `.on('ready' | 'postdraw' | 'error')`, `.stop()`,
`.cleanup()`.

### `P5ExportStorage`

```
isSupported()
chooseOutputDir()        → pick + persist the Output folder
getStoredHandle()        → read the persisted Output handle
getActiveDir()           → Output handle if permission is still granted
ensureActiveDir()        → Output handle, prompting permission if needed
clearOutputDir()         → forget Output folder
writeBlobToDir(h, sub, name, blob) → write a blob to a (possibly nested) subpath
verifyPermission(handle) → request/check readwrite permission

getRecentProjects()                → list of recent project handles
addRecentProject(handle)           → dedupe via isSameEntry, trim to 5
removeRecentProject(nameOrHandle)  → drop one
clearRecentProjects()              → drop all
```

## Files

```
p5.export/
├── index.html      UI + wiring
├── p5export.js     capture engine (Mediabunny MP4 / canvas.toBlob PNG)
├── runner.js       iframe runner + bridge script
├── storage.js      File System Access helpers
├── style.css       prjcts huisstijl
├── CREDITS.md
├── CLAUDE.md
└── README.md
```

## Dependencies (CDN, no build)

- [p5.js](https://github.com/processing/p5.js) 1.11.0 — used by the
  sketch inside the iframe (the parent page only hosts UI).
- [Mediabunny](https://mediabunny.dev) — ESM, dynamically imported on
  the first MP4 capture (`+esm` bundle on jsdelivr). Wraps WebCodecs
  `VideoEncoder` into an MP4 container.
- **File System Access API** — built into Chromium-based browsers.
  Required for the project-folder picker, the Recent history, and for
  writing exports back to `[project]/export/`.

## What this is not

- Not a realtime screen recorder. All captures are offscreen-encoded.
- No cloud upload. "Temp folder" = in-browser blobs that are released
  after download or after `export/` is written.
- No timeline editor. Cut and paste in Premiere / DaVinci after export.
