// runner.js — iframe-based project runner.
//
// Given a list of `File` objects from a directory picker (and the one the user
// wants to run as the main sketch), this builds a stand-alone HTML document
// from the project's index.html with every relative <script>/<link>/<img> src
// rewritten to a blob URL, and loads it in an iframe. The sketch runs in its
// real environment — same global scope, same load order, same auto-start path
// for p5 global mode — so addons that capture references at load time (like
// p5.waves) behave exactly as they do standalone.
//
// A small bridge script is injected first so the parent can:
//   - set the sketch frameRate via postMessage,
//   - stop the draw loop via postMessage,
//   - get a postMessage back for every p5 post-draw tick.

(function (root) {
  const BRIDGE_SRC = `
    (function () {
      var pendingFps = null;
      var readySent = false;
      var mode = null;               // 'p5' | 'raf' | 'stopped'
      var playbackFps = 60;
      var deterministicTime = false;
      var timePatchInstalled = false;
      var origMillis = null;

      // Swap p5's wall-clock time source for a frame-deterministic one while
      // recording, so sketches that use t = millis() / 1000 advance in lockstep
      // with the captured MP4 regardless of renderFps. Reverts to real time
      // once deterministicTime is turned off (stop / no config).
      function patchTime() {
        if (timePatchInstalled) return;
        if (typeof p5 === 'undefined' || !p5.prototype) return;
        timePatchInstalled = true;
        origMillis = p5.prototype.millis;
        p5.prototype.millis = function () {
          if (deterministicTime) {
            return (this.frameCount || 0) * (1000 / playbackFps);
          }
          return origMillis.call(this);
        };
        if (typeof p5.prototype.registerMethod === 'function') {
          p5.prototype.registerMethod('pre', function () {
            if (deterministicTime) {
              this.deltaTime = 1000 / playbackFps;
            }
          });
        }
      }

      window.addEventListener('message', function (e) {
        if (!e.data || typeof e.data !== 'object') return;
        if (e.data.type === 'p5export:config') {
          pendingFps = e.data.renderFps;
          if (e.data.playbackFps) playbackFps = e.data.playbackFps;
          deterministicTime = true;
          patchTime();
          // Only cap draw() rate when caller explicitly asked for it
          // (e.g. the master profile). Without a cap, p5 runs as fast as
          // it can and WebCodecs backpressure throttles capture.
          if (pendingFps != null && typeof frameRate === 'function') {
            frameRate(pendingFps);
            pendingFps = null;
          }
        } else if (e.data.type === 'p5export:noLoop') {
          deterministicTime = false;
          if (typeof noLoop === 'function') noLoop();
          mode = 'stopped';
        }
      });

      function sendReady() {
        if (readySent) return true;
        var c = document.querySelector('canvas');
        if (!c) return false;
        readySent = true;
        parent.postMessage({
          type: 'p5export:ready',
          width: c.width,
          height: c.height,
        }, '*');
        return true;
      }

      // Primary path: hook into p5's post-draw so we get one signal per
      // sketch frame (respecting frameRate() if capped).
      var p5Poll = setInterval(function () {
        if (mode) { clearInterval(p5Poll); return; }
        if (typeof p5 === 'undefined' ||
            !p5.prototype ||
            !p5.prototype.registerMethod) return;
        clearInterval(p5Poll);
        mode = 'p5';
        patchTime();
        var hook = function () {
          if (pendingFps != null && typeof frameRate === 'function') {
            frameRate(pendingFps);
            pendingFps = null;
          }
          sendReady();
          parent.postMessage({ type: 'p5export:postdraw' }, '*');
        };
        p5.prototype.registerMethod('post', hook);
        // p5 auto-instance snapshots _registeredMethods at construction;
        // if it already ran before we got here (common in global mode),
        // our prototype push misses it — patch the live instance too.
        function attachToInstance() {
          var inst = p5.instance;
          if (!inst) return false;
          if (!inst._registeredMethods) inst._registeredMethods = {};
          if (!inst._registeredMethods.post) inst._registeredMethods.post = [];
          if (inst._registeredMethods.post.indexOf(hook) === -1) {
            inst._registeredMethods.post.push(hook);
          }
          return true;
        }
        if (!attachToInstance()) {
          var instPoll = setInterval(function () {
            if (attachToInstance()) clearInterval(instPoll);
          }, 10);
          setTimeout(function () { clearInterval(instPoll); }, 3000);
        }
      }, 10);

      // Fallback: if p5 never surfaces (raw canvas / three.js / late load),
      // drive capture from a requestAnimationFrame loop. Kicks in after ~1.2s.
      setTimeout(function () {
        if (mode) return;
        mode = 'raf';
        clearInterval(p5Poll);
        var loop = function () {
          if (mode !== 'raf') return;
          sendReady();
          if (readySent) parent.postMessage({ type: 'p5export:postdraw' }, '*');
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }, 1200);

      window.addEventListener('error', function (e) {
        parent.postMessage({
          type: 'p5export:error',
          message: e.message || String(e),
        }, '*');
      });
    })();
  `;

  function isAbsoluteURL(src) {
    return (
      /^(https?:)?\/\//i.test(src) ||
      src.startsWith('data:') ||
      src.startsWith('blob:') ||
      src.startsWith('#') ||
      src.startsWith('about:')
    );
  }

  async function buildDocument(files, mainFile) {
    const pathToURL = new Map();
    for (const file of files) {
      pathToURL.set(file.webkitRelativePath, URL.createObjectURL(file));
    }

    const indexFile = files.find((f) =>
      /(?:^|\/)index\.html?$/i.test(f.webkitRelativePath),
    );

    let doc;
    if (indexFile) {
      const html = await indexFile.text();
      doc = new DOMParser().parseFromString(html, 'text/html');
      const base = new URL('./' + indexFile.webkitRelativePath, 'http://local/');
      const rules = {
        'script[src]': 'src',
        'link[href]': 'href',
        'img[src]': 'src',
        'audio[src]': 'src',
        'video[src]': 'src',
        'source[src]': 'src',
      };
      for (const [selector, attr] of Object.entries(rules)) {
        for (const el of doc.querySelectorAll(selector)) {
          const val = el.getAttribute(attr);
          if (!val || isAbsoluteURL(val)) continue;
          let resolvedPath;
          try {
            const resolved = new URL(val, base);
            resolvedPath = decodeURIComponent(resolved.pathname.slice(1));
          } catch (_) { continue; }
          const url = pathToURL.get(resolvedPath);
          if (url) el.setAttribute(attr, url);
        }
      }
    } else {
      // No index.html — synthesize a minimal one around the chosen sketch.
      doc = document.implementation.createHTMLDocument('p5 sketch');
      const p5s = doc.createElement('script');
      p5s.src = 'https://cdn.jsdelivr.net/npm/p5@1.11.0/lib/p5.min.js';
      doc.head.appendChild(p5s);
      const main = doc.createElement('script');
      main.src = pathToURL.get(mainFile.webkitRelativePath);
      doc.body.appendChild(main);
    }

    const bridge = doc.createElement('script');
    bridge.textContent = BRIDGE_SRC;
    if (doc.head.firstChild) {
      doc.head.insertBefore(bridge, doc.head.firstChild);
    } else {
      doc.head.appendChild(bridge);
    }

    return {
      html: '<!doctype html>\n' + doc.documentElement.outerHTML,
      blobURLs: pathToURL,
    };
  }

  async function runProject(options) {
    const {
      files,
      mainFile,
      renderFps,
      playbackFps = 60,
      holderId = 'canvas-holder',
    } = options;
    const holder = document.getElementById(holderId);
    if (!holder) throw new Error(`holder "${holderId}" not found`);
    holder.innerHTML = '';

    const { html, blobURLs } = await buildDocument(files, mainFile);
    const docBlob = new Blob([html], { type: 'text/html' });
    const docURL = URL.createObjectURL(docBlob);

    const iframe = document.createElement('iframe');
    iframe.src = docURL;
    iframe.className = 'sketch-iframe';
    holder.appendChild(iframe);

    const listeners = {};
    function on(event, cb) {
      (listeners[event] = listeners[event] || []).push(cb);
    }
    function emit(event, data) {
      (listeners[event] || []).forEach((cb) => {
        try { cb(data); } catch (err) { console.error(err); }
      });
    }

    const onMessage = (e) => {
      if (e.source !== iframe.contentWindow) return;
      if (!e.data || typeof e.data !== 'object') return;
      switch (e.data.type) {
        case 'p5export:ready':
          emit('ready', {
            canvas: iframe.contentDocument.querySelector('canvas'),
            width: e.data.width,
            height: e.data.height,
          });
          break;
        case 'p5export:postdraw':
          emit('postdraw');
          break;
        case 'p5export:error':
          emit('error', new Error(e.data.message));
          break;
      }
    };
    window.addEventListener('message', onMessage);

    iframe.addEventListener('load', () => {
      iframe.contentWindow.postMessage(
        { type: 'p5export:config', renderFps, playbackFps },
        '*',
      );
    });

    function stop() {
      try {
        iframe.contentWindow?.postMessage({ type: 'p5export:noLoop' }, '*');
      } catch (_) {}
    }

    function cleanup() {
      window.removeEventListener('message', onMessage);
      blobURLs.forEach((url) => URL.revokeObjectURL(url));
      URL.revokeObjectURL(docURL);
    }

    return { iframe, on, stop, cleanup };
  }

  let active = null;

  async function run(options) {
    if (active) {
      try { active.runner.stop(); active.runner.cleanup(); } catch (_) {}
      active = null;
    }
    const runner = await runProject(options);
    active = { runner };
    return runner;
  }

  function stopActive() {
    if (!active) return;
    try { active.runner.stop(); } catch (_) {}
  }

  function cleanupActive() {
    if (!active) return;
    try { active.runner.cleanup(); } catch (_) {}
    active = null;
  }

  root.P5ExportRunner = { run, stop: stopActive, cleanup: cleanupActive };
})(window);
