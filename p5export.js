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
// The same mirror also normalises the frame size (see `planSize`): H.264
// refuses odd dimensions, and a Retina canvas is twice the size of the same
// sketch on a 1x display. Both are decided once, at capture start, and then
// held fixed for the whole recording.
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
    // Longest edge of the encoded video, in pixels. 0 disables the cap, and it
    // never applies to a PNG sequence.
    // A Retina display (devicePixelRatio 2) doubles the canvas, so the encoder
    // gets four times the pixels per frame and the same bitrate has to stretch
    // over all of them. This bounds what the encoder ever sees.
    //
    // It is a ceiling, not a normaliser: below the cap each machine still
    // exports at its own canvas size, so a Retina Mac and a 1x PC do not
    // produce identical files. The render cost inside p5 is untouched too —
    // the sketch still draws at full device resolution either way. See
    // `planSize` for why the cap only ever divides by a whole number.
    maxSize: 1920,
  };

  function resolve(opts) {
    const profile = opts.profile ? PROFILES[opts.profile] : {};
    return { ...DEFAULTS, ...profile, ...opts };
  }

  function fire(name, detail) {
    root.dispatchEvent(new CustomEvent(`p5export:${name}`, { detail }));
  }

  // Every failure path carries a sentence the UI can show as-is. A bare
  // "Failed" is unactionable, and the reasons that actually bite here
  // (missing WebCodecs, a refused resolution) are all fixable by the user.
  function errorText(err) {
    if (!err) return 'Unknown error.';
    return err.message || String(err);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Safari can still be writing a multi-megabyte blob to disk long after the
    // click returns; revoking too early truncates or cancels the download.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // Encoded dimensions, decided once at capture start and then frozen.
  //
  //  - H.264 rejects odd width or height outright, and the canvas size is
  //    whatever the layout happened to produce times pixelDensity — so on a
  //    1x display it is an odd number about half the time.
  //  - `maxSize` caps the longest edge so a Retina canvas doesn't silently
  //    export at double resolution.
  //
  // Freezing matters: an encoder locks its frame size on the first frame, so a
  // mid-capture window resize must not change what we hand it.
  function planSize(srcW, srcH, cfg) {
    let w = Math.max(1, srcW || 1);
    let h = Math.max(1, srcH || 1);

    // Both rules exist for the video encoder, so a PNG sequence — the lossless
    // master — is always written at full canvas resolution.
    if (cfg.format !== 'mp4') return { width: w, height: h };

    // Downscale only by whole divisors. An arbitrary fraction (2200 -> 1920)
    // resamples 1px strokes and grid lines into grey mush; dividing by exactly
    // 2 folds four device pixels into one, which is supersampling — a Retina
    // canvas halved is sharper than the same size rendered at 1x. The cost is
    // a step in output size rather than a smooth ramp.
    if (cfg.maxSize > 0) {
      let divisor = 1;
      while (Math.max(w, h) / divisor > cfg.maxSize) divisor++;
      w = Math.round(w / divisor);
      h = Math.round(h / divisor);
    }
    w = Math.max(2, w - (w % 2));
    h = Math.max(2, h - (h % 2));
    return { width: w, height: h };
  }

  // A canvas from another realm (iframe) is not `instanceof` our
  // HTMLCanvasElement, and a canvas whose size we had to correct can't be
  // encoded directly either. Both cases get a parent-realm mirror at the
  // planned size that we redraw into on every frame.
  function wrapCanvas(srcCanvas, cfg) {
    const plan = planSize(srcCanvas.width, srcCanvas.height, cfg);
    const sameRealm = srcCanvas instanceof HTMLCanvasElement;
    const exactSize =
      plan.width === srcCanvas.width && plan.height === srcCanvas.height;

    if (sameRealm && exactSize) {
      return {
        canvas: srcCanvas,
        sync: () => {},
        width: () => srcCanvas.width,
        height: () => srcCanvas.height,
        rescaled: false,
      };
    }

    const mirror = document.createElement('canvas');
    mirror.width = plan.width;
    mirror.height = plan.height;
    // willReadFrequently pins the canvas to a CPU backing store, which is what
    // the PNG sink wants (it calls toBlob on every frame) but the opposite of
    // what the video encoder wants — there the mirror is only ever a drawImage
    // target, and forcing it off the GPU makes each blit ~12x slower.
    const ctx = mirror.getContext('2d', {
      willReadFrequently: cfg.format !== 'mp4',
    });
    // The mirror only ever shrinks the source, and the whole point of the
    // whole-divisor rule is to make that shrink clean.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    return {
      canvas: mirror,
      sync: () => {
        const sw = srcCanvas.width;
        const sh = srcCanvas.height;
        if (!sw || !sh) return;
        // Fit the source inside the frozen frame. Normally the aspect ratios
        // match and this fills it exactly; after a mid-capture resize it
        // letterboxes instead of distorting the sketch.
        const scale = Math.min(mirror.width / sw, mirror.height / sh);
        const dw = sw * scale;
        const dh = sh * scale;
        const dx = (mirror.width - dw) / 2;
        const dy = (mirror.height - dh) / 2;
        if (dw < mirror.width || dh < mirror.height) {
          ctx.clearRect(0, 0, mirror.width, mirror.height);
        }
        ctx.drawImage(srcCanvas, 0, 0, sw, sh, dx, dy, dw, dh);
      },
      width: () => mirror.width,
      height: () => mirror.height,
      rescaled: !exactSize,
    };
  }

  // Fail loudly and specifically *before* recording starts. Without this the
  // first encoded frame throws deep inside the encoder and the user sees a
  // bare "Failed" with the real reason buried in the console.
  async function assertMp4Support(wrapped, cfg) {
    const w = wrapped.width();
    const h = wrapped.height();

    if (typeof VideoEncoder === 'undefined') {
      throw new Error(
        'This browser cannot encode MP4: the WebCodecs VideoEncoder API is missing. ' +
          'MP4 export needs Chrome/Edge 94+ or Safari 16.4+' +
          (root.isSecureContext === false
            ? ', and this page is not a secure context — open it over https or localhost, not file://.'
            : '.'),
      );
    }

    const { canEncodeVideo } = await loadMediabunny();
    if (typeof canEncodeVideo !== 'function') return;

    const ok = await canEncodeVideo('avc', {
      width: w,
      height: h,
      bitrate: cfg.bitrateMbps * 1e6,
    });
    if (!ok) {
      throw new Error(
        `This browser refused to encode H.264 at ${w}×${h}. ` +
          'Try a smaller window, or record in another browser.',
      );
    }
  }

  async function createMp4Sink(wrapped, cfg) {
    await assertMp4Support(wrapped, cfg);

    const { Output, Mp4OutputFormat, BufferTarget, CanvasSource } =
      await loadMediabunny();

    // The mirror only holds the previous frame until sync() runs, and
    // CanvasSource locks its frame size off the canvas it is handed — so make
    // sure it sees the planned size with real content in it from the start.
    wrapped.sync();

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
      const err = new Error('No canvas to record.');
      console.error('[p5export]', err.message);
      fire('error', { error: err, message: errorText(err), phase: 'init' });
      return null;
    }

    const wrapped = wrapCanvas(canvas, cfg);
    cfg.width = wrapped.width();
    cfg.height = wrapped.height();

    let sink;
    try {
      sink =
        cfg.format === 'mp4'
          ? await createMp4Sink(wrapped, cfg)
          : createPngSink(wrapped, cfg);
    } catch (err) {
      console.error('[p5export] init failed:', err);
      fire('error', { error: err, message: errorText(err), phase: 'init' });
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
        fire('error', { error: err, message: errorText(err), phase: 'finalize' });
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
          fire('error', { error: err, message: errorText(err), phase: 'frame' });
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
