// p5export — lossless animation capture driven by external frame ticks.
//
// Hands a canvas (from anywhere — including an iframe) to Mediabunny for MP4
// encoding, or to `canvas.toBlob()` for PNG streaming. The caller drives the
// capture by calling `tick()` whenever a new frame has rendered. No p5
// integration here — that lives in runner.js, which bridges iframe post-draw
// events to this module's `tick()`.
//
// Cross-realm note: a canvas from an iframe is not `instanceof` the parent's
// `HTMLCanvasElement`, which Mediabunny (and some browsers) check. We mirror
// such canvases into a parent-realm canvas via drawImage on every tick so
// encoders and toBlob() always get a native canvas.
//
// API and three-profile shape (social/master/edit) inspired by
// p5.capture (MIT, © tapioca24). See CREDITS.md.

(function (root) {
  // The `+esm` suffix asks jsdelivr for a pre-bundled ESM build.
  const MEDIABUNNY_URL = 'https://cdn.jsdelivr.net/npm/mediabunny@1/+esm';

  let _mbPromise = null;
  function loadMediabunny() {
    if (!_mbPromise) _mbPromise = import(MEDIABUNNY_URL);
    return _mbPromise;
  }

  // renderFps (wall-clock capture rate) is decoupled from playbackFps.
  // When unset, the sketch runs as fast as p5+encoder can sustain —
  // WebCodecs backpressure is the throttle, so correctness is preserved.
  // Only `master` keeps an explicit renderFps cap so heavy sketches get
  // room per frame; the deterministic-time patch in the bridge keeps
  // motion accurate regardless.
  const PROFILES = {
    social: { format: 'mp4', playbackFps: 60, bitrateMbps: 3.5 },
    edit:   { format: 'mp4', playbackFps: 60, bitrateMbps: 20 },
    master: { format: 'png', playbackFps: 60, renderFps: 2 },
  };

  const DEFAULTS = {
    frames: 1200,
    playbackFps: 60,
    format: 'mp4',
    filename: 'p5export',
    bitrateMbps: 20,
  };

  function resolve(opts) {
    const profile = opts.profile ? PROFILES[opts.profile] : {};
    return { ...DEFAULTS, ...profile, ...opts };
  }

  function fire(name, detail) {
    root.dispatchEvent(new CustomEvent(`p5export:${name}`, { detail }));
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // A canvas from another realm (iframe) is not `instanceof` our
  // HTMLCanvasElement. Wrap it with a parent-realm mirror that we redraw
  // into on every frame.
  function wrapCanvas(srcCanvas) {
    const sameRealm = srcCanvas instanceof HTMLCanvasElement;
    if (sameRealm) {
      return {
        canvas: srcCanvas,
        sync: () => {},
        width: () => srcCanvas.width,
        height: () => srcCanvas.height,
      };
    }
    const mirror = document.createElement('canvas');
    mirror.width = srcCanvas.width;
    mirror.height = srcCanvas.height;
    const ctx = mirror.getContext('2d', { willReadFrequently: true });
    return {
      canvas: mirror,
      sync: () => {
        if (mirror.width !== srcCanvas.width) mirror.width = srcCanvas.width;
        if (mirror.height !== srcCanvas.height) mirror.height = srcCanvas.height;
        ctx.drawImage(srcCanvas, 0, 0);
      },
      width: () => mirror.width,
      height: () => mirror.height,
    };
  }

  async function createMp4Sink(wrapped, cfg) {
    const { Output, Mp4OutputFormat, BufferTarget, CanvasSource } =
      await loadMediabunny();

    const video = new CanvasSource(wrapped.canvas, {
      codec: 'avc',
      bitrate: cfg.bitrateMbps * 1e6,
    });

    const output = new Output({
      // fastStart: 'in-memory' rewrites the moov atom to the start of the
      // file so uploaders (Instagram, X, Vimeo…) can begin indexing the
      // stream immediately instead of needing the whole file first.
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target: new BufferTarget(),
    });
    output.addVideoTrack(video, { frameRate: cfg.playbackFps });
    await output.start();

    const dt = 1 / cfg.playbackFps;
    let i = 0;

    // Force a keyframe every second of output so downstream services
    // (Instagram, X, any HLS packager) can seek / chunk / thumbnail.
    // Without this, WebCodecs may emit only the first frame as IDR and
    // IG's final transcode rejects the file ("preview OK, upload fails").
    const keyframeInterval = Math.max(1, Math.round(cfg.playbackFps));

    return {
      async onFrame() {
        wrapped.sync();
        // Await so encoder backpressure is respected — otherwise the queue
        // grows unbounded and finalize() can stall at the end of a capture.
        await video.add(i * dt, dt, { keyFrame: i % keyframeInterval === 0 });
        i++;
      },
      async finalize() {
        await output.finalize();
        // Mediabunny writes the ftyp with major brand 'isom'. Instagram and
        // several mobile clients prefer 'mp42' as the major brand. Patch it
        // in place — only the 4-byte brand + 4-byte minor version change,
        // no stream bytes touched.
        const buf = new Uint8Array(output.target.buffer);
        if (
          buf.length > 16 &&
          buf[4] === 0x66 && buf[5] === 0x74 &&
          buf[6] === 0x79 && buf[7] === 0x70
        ) {
          buf[8]  = 0x6d; buf[9]  = 0x70;
          buf[10] = 0x34; buf[11] = 0x32; // 'mp42'
          buf[12] = 0; buf[13] = 0; buf[14] = 0; buf[15] = 0;
        }
        return new Blob([buf], { type: 'video/mp4' });
      },
      async abort() {
        try { await (output.cancel ? output.cancel() : Promise.resolve()); } catch (_) {}
      },
    };
  }

  function createPngSink(wrapped, cfg) {
    if (typeof cfg.onFrame !== 'function') {
      throw new Error(
        'PNG sequence requires an onFrame callback (e.g. a chosen output folder).',
      );
    }
    const pending = [];
    let i = 0;
    return {
      async onFrame() {
        wrapped.sync();
        const idx = i++;
        const blob = await new Promise((r) =>
          wrapped.canvas.toBlob(r, 'image/png'),
        );
        const name = `frame_${String(idx + 1).padStart(5, '0')}.png`;
        pending.push(
          Promise.resolve(
            cfg.onFrame(blob, { index: idx, total: cfg.frames, filename: name }),
          ),
        );
      },
      async finalize() {
        await Promise.all(pending);
        return null;
      },
      async abort() {
        await Promise.allSettled(pending);
      },
    };
  }

  async function startCapture(opts) {
    const cfg = resolve(opts);
    const canvas = opts.canvas;

    if (!canvas) {
      console.error('[p5export] canvas is required');
      return null;
    }

    const wrapped = wrapCanvas(canvas);

    let sink;
    try {
      sink =
        cfg.format === 'mp4'
          ? await createMp4Sink(wrapped, cfg)
          : createPngSink(wrapped, cfg);
    } catch (err) {
      console.error('[p5export] init failed:', err);
      fire('error', { error: err });
      return null;
    }

    let frameIdx = 0;
    let done = false;
    const startedAt = performance.now();
    const token = Symbol('p5export');

    function detach() {
      if (root._p5exportActive && root._p5exportActive.__token === token) {
        delete root._p5exportActive;
      }
    }

    async function finish() {
      if (done) return;
      done = true;
      detach();
      fire('encoding', { cfg: { ...cfg, frames: frameIdx } });

      const encodeStart = performance.now();
      const pulse = setInterval(() => {
        fire('encoding-progress', {
          elapsed: (performance.now() - encodeStart) / 1000,
        });
      }, 500);

      try {
        const blob = await sink.finalize();
        const ext = cfg.format === 'mp4' ? '.mp4' : '';
        const fname = `${cfg.filename}${ext}`;
        fire('done', { cfg, blob, filename: fname, frames: frameIdx });
        if (cfg.onDone) {
          await cfg.onDone(blob, { ...cfg, filename: fname, frames: frameIdx });
        } else if (blob) {
          downloadBlob(blob, fname);
        }
      } catch (err) {
        console.error('[p5export] finalize failed:', err);
        fire('error', { error: err });
      } finally {
        clearInterval(pulse);
      }
    }

    async function abort() {
      if (done) return;
      done = true;
      detach();
      try { await sink.abort(); } catch (_) {}
      fire('aborted', { cfg });
    }

    // tick() gets called once per iframe post-draw event. We chain them onto
    // a single promise so concurrent messages don't race sink.onFrame() —
    // Mediabunny backpressure requires serialized add() calls.
    let tickChain = Promise.resolve();
    function tick() {
      tickChain = tickChain.then(async () => {
        if (done) return;
        try {
          await sink.onFrame();
          frameIdx++;
          fire('progress', {
            frame: frameIdx,
            total: cfg.frames,
            elapsed: (performance.now() - startedAt) / 1000,
          });
          if (frameIdx >= cfg.frames) await finish();
        } catch (err) {
          console.error('[p5export] frame capture failed:', err);
          fire('error', { error: err });
          await abort();
        }
      });
      return tickChain;
    }

    const controller = {
      __token: token,
      tick,
      stop: finish,
      abort,
      config: cfg,
      get frame() { return frameIdx; },
      get done() { return done; },
    };
    root._p5exportActive = controller;

    fire('start', cfg);
    return controller;
  }

  root.p5export = { startCapture, PROFILES };
  root.P5EXPORT_PROFILES = PROFILES;
})(window);
