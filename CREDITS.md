# Credits & acknowledgements

`p5.export` is a standalone capture tool for p5.js animations, but
stands on the thinking and API decisions of other, better people.

## Direct dependencies

- **[p5.js](https://p5js.org/)** — Lauren McCarthy, The Processing
  Foundation, and hundreds of contributors. GPL-LGPL. The engine
  that draws the animations.
- **[Mediabunny](https://mediabunny.dev)** — Vanilagy. MPL-2.0.
  Encodes the MP4 output via WebCodecs in the browser.

## Inspiration

- **[p5.capture](https://github.com/tapioca24/p5.capture)** — tapioca24.
  MIT. The three-profile approach (`social` / `master` / `edit`), the
  `duration`-in-frames convention, and the
  `registerMethod('post', …)` integration with p5's draw loop are
  directly inspired by p5.capture. If you want a fully UI-driven
  capture experience for p5.js, use *that*.
- **[p5.record.js](https://github.com/limzykenneth/p5.record.js)** —
  Lim Zi Yang. The original reminder that MediaRecorder alone is not
  enough for dense p5 imagery.

## Why a from-scratch implementation

- Per-frame PNG streaming straight to File System Access (no zip,
  no memory ceiling for long masters).
- Modern H.264 via WebCodecs + Mediabunny (hardware-accelerated,
  no 25 MB ffmpeg.wasm blob).
- Plugin-ready standalone `p5export()` function without hidden
  singletons.

Any improvement that goes beyond these three points should eventually
find its way back through honest attribution, issues, or pull
requests to the original projects.
