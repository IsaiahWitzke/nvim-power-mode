(function () {
  const vscode = acquireVsCodeApi();

  const els = {
    explosions: document.getElementById("explosions"),
    blips: document.getElementById("blips"),
    chars: document.getElementById("chars"),
    shake: document.getElementById("shake"),
    sound: document.getElementById("sound"),
    fireworks: document.getElementById("fireworks"),
    reducedEffects: document.getElementById("reducedEffects"),
    explosionVolume: document.getElementById("explosionVolume"),
    explosionVolumeValue: document.getElementById("explosionVolumeValue"),
    levelLabel: document.getElementById("levelLabel"),
    xpLabel: document.getElementById("xpLabel"),
    barInner: document.getElementById("barInner"),
    resetBtn: document.getElementById("resetBtn"),
    testFireworks: document.getElementById("testFireworks"),
    fwCanvas: document.getElementById("fwCanvas")
  };

  // Track current explosion volume
  let explosionVolume = 0.3;

  // WebAudio engine using decoded WAV buffers
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let actx = null;
  const buffers = { blip: null, boom: null, fireworks: null };
  let audioUnlocked = false;
  async function fetchArrayBuffer(url) {
    const res = await fetch(url);
    return await res.arrayBuffer();
  }
  async function preloadSounds(uris) {
    try {
      console.log('[panel.js] preloadSounds called with:', uris);
      actx = actx || new AudioCtx();
      const entries = Object.entries(uris);
      for (const [k, u] of entries) {
        console.log(`[panel.js] Fetching ${k} from ${u}`);
        const ab = await fetchArrayBuffer(u);
        buffers[k] = await actx.decodeAudioData(ab);
        console.log(`[panel.js] ${k} loaded successfully`);
      }
      console.log('[panel.js] All sounds preloaded');
    } catch (err) {
      console.error('[panel.js] Error preloading sounds:', err);
    }
  }
  async function unlockAudio() {
    if (audioUnlocked) {
      console.log('[panel.js] Audio already unlocked');
      return;
    }
    try {
      console.log('[panel.js] Unlocking audio...');
      actx = actx || new AudioCtx();
      console.log('[panel.js] AudioContext state:', actx.state);
      if (actx.state === 'suspended') await actx.resume();
      audioUnlocked = true;
      console.log('[panel.js] Audio unlocked successfully');
      const n = document.getElementById('soundNotice');
      if (n) n.remove();
    } catch (err) {
      console.error('[panel.js] Error unlocking audio:', err);
    }
  }
  function playWav(kind, opts = {}) {
    try {
      console.log(`[panel.js] playWav called: kind=${kind}, audioUnlocked=${audioUnlocked}, bufferExists=${!!buffers[kind]}`);
      if (!audioUnlocked) {
        console.log('[panel.js] Audio not unlocked, skipping playback');
        return;
      }
      if (!buffers[kind]) {
        console.log(`[panel.js] Buffer for ${kind} not loaded, skipping playback`);
        return;
      }
      if (actx && actx.state === 'suspended') {
        console.log('[panel.js] Resuming suspended AudioContext');
        actx.resume().catch(() => {});
      }
      const src = actx.createBufferSource();
      src.buffer = buffers[kind];
      if (opts.playbackRate && typeof opts.playbackRate === 'number') {
        src.playbackRate.value = Math.max(0.5, Math.min(3.0, opts.playbackRate));
      }
      const gain = actx.createGain();
      // Apply custom volume for boom (explosion) sounds
      if (kind === 'boom') {
        gain.gain.value = explosionVolume;
      } else {
        gain.gain.value = 0.5;
      }
      src.connect(gain).connect(actx.destination);
      src.start();
      console.log(`[panel.js] Playing ${kind} with playbackRate=${opts.playbackRate || 1.0}, volume=${gain.gain.value}`);
    } catch (err) {
      console.error('[panel.js] Error playing sound:', err);
    }
  }

  // Fireworks particles on canvas
  const fw = {
    running: false,
    particles: [],
    start() {
      const canvas = els.fwCanvas;
      canvas.classList.remove("hidden");
      canvas.width = canvas.clientWidth * window.devicePixelRatio;
      canvas.height = canvas.clientHeight * window.devicePixelRatio;
      this.particles = [];
      for (let i = 0; i < 80; i++) {
        this.particles.push({
          x: canvas.width / 2,
          y: canvas.height - 10,
          vx: (Math.random() - 0.5) * 6,
          vy: -Math.random() * 8 - 4,
          life: 60 + Math.random() * 30,
          color: `hsl(${Math.random() * 360}, 90%, 60%)`
        });
      }
      this.running = true;
      this.loop();
      setTimeout(() => this.stop(), 1500);
    },
    stop() {
      this.running = false;
      els.fwCanvas.classList.add("hidden");
    },
    loop() {
      if (!this.running) return;
      const ctx = els.fwCanvas.getContext("2d");
      ctx.clearRect(0, 0, els.fwCanvas.width, els.fwCanvas.height);
      this.particles.forEach(p => {
        p.vy += 0.15;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 1;
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, 3, 3);
      });
      this.particles = this.particles.filter(p => p.life > 0 && p.y < els.fwCanvas.height);
      requestAnimationFrame(() => this.loop());
    }
  };

  // Wire toggles
  ["explosions", "blips", "chars", "shake", "sound", "fireworks", "reducedEffects"].forEach(key => {
    els[key].addEventListener("change", () => {
      vscode.postMessage({ type: "toggle", key, value: els[key].checked });
    });
  });

  // Wire volume slider
  els.explosionVolume.addEventListener("input", () => {
    const value = parseInt(els.explosionVolume.value) / 100;
    explosionVolume = value;
    els.explosionVolumeValue.textContent = `${els.explosionVolume.value}%`;
    vscode.postMessage({ type: "volumeChange", key: "explosionVolume", value });
  });

  els.resetBtn.addEventListener("click", () => vscode.postMessage({ type: "resetXp" }));
  els.testFireworks.addEventListener("click", () => {
    // Play sound if enabled (same as real fireworks)
    if (els.sound.checked) playBeep(0.5);
    fw.start();
  });

  function setState({ xp, level, xpNext, xpLevelStart = 0 }) {
    const current = xp - xpLevelStart;
    const max = xpNext - xpLevelStart;
    els.levelLabel.textContent = `Level: ${level}`;
    els.xpLabel.textContent = `XP: ${xp} / ${xpNext}`;
    const pct = Math.max(0, Math.min(100, (current / Math.max(1, max)) * 100));
    els.barInner.style.width = `${pct}%`;
  }

  window.addEventListener("message", e => {
    const msg = e.data;
    console.log('[panel.js] Received message:', msg.type, msg);
    switch (msg.type) {
      case "init":
        console.log('[panel.js] Initializing panel with settings:', msg.settings);
        // Settings
        els.explosions.checked = msg.settings.explosions;
        els.blips.checked = msg.settings.blips;
        els.chars.checked = msg.settings.chars;
        els.shake.checked = msg.settings.shake;
        els.sound.checked = msg.settings.sound;
        els.fireworks.checked = msg.settings.fireworks;
        els.reducedEffects.checked = msg.settings.reducedEffects;
        // Volume
        explosionVolume = msg.settings.explosionVolume;
        els.explosionVolume.value = Math.round(explosionVolume * 100);
        els.explosionVolumeValue.textContent = `${els.explosionVolume.value}%`;
  preloadSounds({ blip: msg.soundUris.blip, boom: msg.soundUris.boom, fireworks: msg.soundUris.fireworks });
  // Unlock audio on first interaction
  document.addEventListener('click', unlockAudio, { once: true });
  document.addEventListener('keydown', unlockAudio, { once: true });
        setState(msg);
        break;
      case "state":
        setState(msg);
        break;
      case "blip":
        // console.log('[panel.js] Blip message received, enabled:', msg.enabled, 'pitch:', msg.pitch);
        if (msg.enabled) playWav('blip', { playbackRate: msg.pitch ?? 1.0 });
        break;
      case "boom":
        console.log('[panel.js] Boom message received, enabled:', msg.enabled);
        if (msg.enabled) playWav('boom');
        break;
      case "fireworks":
        console.log('[panel.js] Fireworks message received, enabled:', msg.enabled);
        if (msg.enabled) playWav('fireworks');
        fw.start();
        break;
    }
  });

  // Wait for DOM to be ready before sending ready message
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      vscode.postMessage({ type: "ready" });
    });
  } else {
    vscode.postMessage({ type: "ready" });
  }
})();