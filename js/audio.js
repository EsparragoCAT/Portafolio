/* Música adaptativa de Project: Firefly.
   Cada tema son tres stems del mismo largo (base, ritmo, lead) que suenan juntos en loop sin corte.
   Igual que MusicDirector en el mod: no se cambia de pista, se sube y baja cada capa. */
(function () {
  const $ = (s) => document.querySelector(s);
  // Textos en [inglés, español]; L() devuelve el del idioma actual.
  const L = (pair) => (Array.isArray(pair) ? I18N.t(pair[0], pair[1]) : pair);

  const THEMES = [
    { id: 'lobby', name: 'Lobby', moment: ['Waiting and countdown', 'Espera y cuenta regresiva'], style: ['Tense ambient', 'Ambient tenso'], bpm: 61 },
    { id: 'todos', name: ['Free for all', 'Todos contra todos'], moment: ['Free mode', 'Modo libre'], style: 'Darksynth', bpm: 123 },
    { id: 'pvp', name: 'PVP', moment: ['Pure PVP', 'PVP puro'], style: 'Industrial', bpm: 127 },
    { id: 'pve', name: ['Waves', 'Oleadas'], moment: ['PVE against drones', 'PVE contra drones'], style: ['Dark drum and bass', 'Drum and bass oscuro'], bpm: 174 },
    { id: 'hardpoint', name: 'Hardpoint', moment: ['Zone control', 'Control de zona'], style: 'Midtempo cyber', bpm: 121 },
    { id: 'bandera', name: ['Flag', 'Bandera'], moment: ['Capture the flag', 'Captura de bandera'], style: ['80s synth', 'Synth 80'], bpm: 110 },
    { id: 'boss', name: ['Boss', 'Jefe'], moment: ['Boss fight', 'Pelea contra el jefe'], style: ['Epic with choir', 'Épico con coro'], bpm: 108 },
    { id: 'results', name: ['Winners', 'Ganadores'], moment: ['Results screen', 'Pantalla de resultados'], style: ['Hybrid cinematic', 'Cine híbrido'], bpm: 114 },
    // Pillar Pummel Reloaded: un solo archivo con la mezcla entera (sin capas), hecho en CATStudio.
    { id: 'pp_lobby', pp: true, name: 'Lobby', moment: ['Lobby and waiting', 'Lobby y espera'], style: 'Vaporwave', bpm: 69 },
    { id: 'pp_match', pp: true, name: ['Match', 'Partida'], moment: ['Mid-match', 'En plena partida'], style: 'Vaporwave', bpm: 108 },
    { id: 'pp_final', pp: true, name: ['Last minute', 'Último minuto'], moment: ['Double points, last minute', 'Último minuto, puntos dobles'], style: 'Vaporwave', bpm: 114 },
  ];
  const PROJECT = (t) => (t.pp ? 'Pillar Pummel' : 'Firefly');
  const LAYERS = [
    { id: 'base', name: 'Base', what: ['Chords and arpeggio', 'Acordes y arpegio'] },
    { id: 'rhythm', name: ['Rhythm', 'Ritmo'], what: ['Drums and bass', 'Batería y bajo'] },
    { id: 'lead', name: 'Lead', what: ['Melody', 'Melodía'] },
  ];
  // Los mismos niveles que usa MusicDirector (base, ritmo, lead).
  const SCENES = [
    { id: 'calma', name: ['Calm', 'Calma'], levels: [0.9, 0.6, 0.3] },
    { id: 'pelea', name: ['Fight', 'Pelea'], levels: [0.9, 1, 0.9] },
    { id: 'caido', name: ['Down', 'Caído'], levels: [0.45, 0.3, 0.15] },
    { id: 'todo', name: ['All', 'Todo'], levels: [1, 1, 1] },
  ];
  const STATES = {
    playing: ['playing', 'sonando'], paused: ['paused', 'en pausa'],
    loading: ['loading', 'cargando'], error: ["couldn't load", 'no se pudo cargar'],
  };

  const FORMAT = (() => {
    const a = document.createElement('audio');
    return a.canPlayType('audio/ogg; codecs="vorbis"') ? 'ogg' : 'm4a';
  })();

  let ctx = null, master = null, analyser = null, fullGain = null, layerGains = [], layerMeters = [];
  let themeIdx = 0, playing = false, current = null; // current = { idx, sources: [] }
  const levels = SCENES[0].levels.slice();
  const muted = [false, false, false];
  const buffers = new Map();

  /* ---------- UI ---------- */
  const temasEl = $('#ost-temas'), ppEl = $('#pp-temas'), escenasEl = $('#ost-escenas'), capasEl = $('#ost-capas');
  const playBtn = $('#ost-play'), miniBtn = $('#mini-play'), miniTitle = $('#mini-title');
  const tag = $('#ost-tag'), consola = $('.consola');

  const temaBtns = THEMES.map((t, i) => {
    const n = t.pp ? THEMES.filter((x, j) => x.pp && j <= i).length : i + 1;
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" class="tema" aria-pressed="${i === 0}">
        <span class="tema-n">${String(n).padStart(2, '0')}</span>
        <span class="tema-txt"><b></b><small></small></span>
        <span class="tema-bpm">${t.bpm}</span>
      </button>`;
    const b = li.querySelector('button');
    b.addEventListener('click', () => select(i, true));
    (t.pp ? ppEl : temasEl).append(li);
    return b;
  });

  SCENES.forEach((sc, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.i = i;
    b.setAttribute('aria-checked', String(i === 0));
    b.addEventListener('click', () => applyScene(i));
    escenasEl.append(b);
  });

  const faders = LAYERS.map((ly, i) => {
    const row = document.createElement('div');
    row.className = 'capa';
    row.innerHTML = `
      <button type="button" class="capa-mute" aria-pressed="true"></button>
      <div class="capa-ctl">
        <label class="nota" for="capa-${ly.id}"></label>
        <input type="range" id="capa-${ly.id}" min="0" max="100" step="1" value="${Math.round(levels[i] * 100)}">
        <span class="capa-meter" aria-hidden="true"><i></i></span>
      </div>
      <output class="capa-val">${Math.round(levels[i] * 100)}</output>`;
    const input = row.querySelector('input'), out = row.querySelector('output'), mute = row.querySelector('.capa-mute');
    input.addEventListener('input', () => { levels[i] = input.value / 100; out.textContent = input.value; clearScene(); updateGains(); });
    mute.addEventListener('click', () => {
      muted[i] = !muted[i];
      mute.setAttribute('aria-pressed', String(!muted[i]));
      row.classList.toggle('apagada', muted[i]);
      updateGains();
    });
    capasEl.append(row);
    return { input, out, mute, label: row.querySelector('label'), meter: row.querySelector('.capa-meter i') };
  });

  // Pone los nombres en el idioma actual (al arrancar y cada vez que se cambia).
  function labels() {
    temaBtns.forEach((b, i) => {
      b.querySelector('b').textContent = L(THEMES[i].name);
      b.querySelector('small').textContent = L(THEMES[i].style);
    });
    escenasEl.querySelectorAll('button').forEach((b, i) => { b.textContent = L(SCENES[i].name); });
    faders.forEach((f, i) => {
      const name = L(LAYERS[i].name);
      f.mute.textContent = name;
      f.mute.setAttribute('aria-label', I18N.t(`Mute ${name}`, `Silenciar ${name}`));
      f.label.textContent = L(LAYERS[i].what);
    });
  }
  labels();
  let lastState;
  document.addEventListener('langchange', () => { labels(); emit(lastState); });

  const vol = $('#ost-vol'), volOut = vol.parentElement.querySelector('output');
  const showVol = () => { volOut.textContent = vol.value + '%'; };
  vol.addEventListener('input', () => { showVol(); if (master) master.gain.setTargetAtTime(vol.value / 100, ctx.currentTime, 0.05); });
  showVol();

  function applyScene(i) {
    SCENES[i].levels.forEach((v, j) => { levels[j] = v; faders[j].input.value = Math.round(v * 100); faders[j].out.textContent = Math.round(v * 100); });
    escenasEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.i === i)));
    updateGains();
  }
  function clearScene() {
    const match = SCENES.findIndex((sc) => sc.levels.every((v, j) => Math.abs(v - levels[j]) < 0.005));
    escenasEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(+b.dataset.i === match)));
  }

  function emit(state) {
    const t = THEMES[themeIdx];
    lastState = state;
    const name = L(t.name);
    $('#ost-title').textContent = name;
    $('#ost-momento').textContent = L(t.moment);
    $('#ost-meta').textContent = `${L(t.style)} · ${t.bpm} BPM · ${t.pp ? I18N.t('full mix, no layers', 'mezcla completa, sin capas') : I18N.t('3 looping layers', '3 capas en loop')}`;
    temaBtns.forEach((b, j) => b.setAttribute('aria-pressed', String(j === themeIdx)));
    // Los temas de Pillar Pummel no vienen en capas: escenas y faders quedan apagados.
    consola.classList.toggle('sin-capas', !!t.pp);
    consola.querySelectorAll('.escenas button, .capas button, .capas input').forEach((el) => { el.disabled = !!t.pp; });
    tag.textContent = L(STATES[state || (playing ? 'playing' : 'paused')]);
    playBtn.textContent = playing ? I18N.t('❚❚ Pause', '❚❚ Pausa') : '▶ Play';
    miniBtn.textContent = playing ? '❚❚' : '▶';
    miniTitle.textContent = playing ? `${PROJECT(t)} · ${name}` : I18N.t('Not playing', 'Sin reproducir');
  }

  /* ---------- audio ---------- */
  function ensureCtx() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = vol.value / 100;
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.82;
    master.connect(analyser); analyser.connect(ctx.destination);
    layerGains = LAYERS.map(() => { const g = ctx.createGain(); g.gain.value = 0; g.connect(master); return g; });
    layerMeters = LAYERS.map((_, i) => { const a = ctx.createAnalyser(); a.fftSize = 512; layerGains[i].connect(a); return a; });
    fullGain = ctx.createGain(); fullGain.gain.value = 0.8; fullGain.connect(master);
  }

  async function load(idx) {
    const t = THEMES[idx], id = t.id;
    if (buffers.has(id)) return buffers.get(id);
    const files = t.pp ? [id] : LAYERS.map((ly) => `${id}_${ly.id}`);
    const job = Promise.all(files.map(async (file) => {
      const tryFmt = async (fmt) => {
        const res = await fetch(`assets/music/${file}.${fmt}`);
        if (!res.ok) throw new Error(res.status);
        const data = await res.arrayBuffer();
        return await new Promise((ok, bad) => ctx.decodeAudioData(data, ok, bad));
      };
      try { return await tryFmt(FORMAT); } catch (e) { return await tryFmt(FORMAT === 'ogg' ? 'm4a' : 'ogg'); }
    }));
    buffers.set(id, job);
    job.catch(() => buffers.delete(id));
    return job;
  }

  function target(i) { return muted[i] ? 0 : levels[i] * 0.8; } // 0.8 = MIX del mod
  function updateGains() {
    if (!ctx || !current) return;
    layerGains.forEach((g, i) => g.gain.setTargetAtTime(target(i), ctx.currentTime, 0.25));
  }

  async function start(idx) {
    emit('loading');
    let bufs;
    try { bufs = await load(idx); } catch (e) { playing = false; emit('error'); return; }
    if (!playing || idx !== themeIdx) return; // cambiaron de idea mientras cargaba
    const old = current;
    const when = ctx.currentTime + 0.06;
    const sources = bufs.map((buf, i) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const fade = ctx.createGain();
      fade.gain.setValueAtTime(0, when); fade.gain.linearRampToValueAtTime(1, when + 0.6);
      src.connect(fade); fade.connect(THEMES[idx].pp ? fullGain : layerGains[i]);
      src.start(when);
      return { src, fade };
    });
    current = { idx, sources };
    updateGains();
    if (old) {
      old.sources.forEach(({ src, fade }) => {
        fade.gain.cancelScheduledValues(ctx.currentTime);
        fade.gain.setValueAtTime(fade.gain.value, ctx.currentTime);
        fade.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
        src.stop(ctx.currentTime + 0.65);
      });
    }
    emit();
    // precarga el siguiente tema para que el cambio sea instantáneo
    load((idx + 1) % THEMES.length).catch(() => {});
  }

  async function play() {
    ensureCtx();
    playing = true;
    if (ctx.state === 'suspended') await ctx.resume();
    if (!current || current.idx !== themeIdx) await start(themeIdx);
    else emit();
    draw();
  }
  async function pause() {
    playing = false;
    if (ctx) await ctx.suspend();
    emit();
  }
  function toggle() { playing ? pause() : play(); }

  function select(i, autoplay) {
    themeIdx = i;
    emit(playing ? 'loading' : undefined);
    if (playing) start(i);
    else if (autoplay) play();
  }

  playBtn.addEventListener('click', toggle);
  miniBtn.addEventListener('click', toggle);

  /* ---------- visualizador ---------- */
  const viz = $('#ost-viz'), vctx = viz.getContext('2d');
  let vizVisible = true, freq = null, wave = null;
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { vizVisible = e.isIntersecting; }).observe(viz);

  function idle() {
    const w = viz.width, h = viz.height;
    vctx.clearRect(0, 0, w, h);
    vctx.fillStyle = 'rgba(12,238,0,.18)';
    for (let x = 0; x < w; x += 10) vctx.fillRect(x, h - 3, 6, 2);
  }
  idle();

  let raf = 0;
  function draw() {
    cancelAnimationFrame(raf);
    const loop = () => {
      if (!playing) { idle(); faders.forEach((f) => { f.meter.style.transform = 'scaleX(0)'; }); return; }
      raf = requestAnimationFrame(loop);
      if (!vizVisible) return;
      const w = viz.width, h = viz.height;
      freq = freq || new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freq);
      vctx.clearRect(0, 0, w, h);
      const bars = 72, bw = w / bars;
      for (let b = 0; b < bars; b++) {
        // escala logarítmica: más barras para graves y medios
        const lo = Math.floor(Math.pow(b / bars, 2) * freq.length * 0.7);
        const hi = Math.max(lo + 1, Math.floor(Math.pow((b + 1) / bars, 2) * freq.length * 0.7));
        let m = 0; for (let k = lo; k < hi; k++) m = Math.max(m, freq[k]);
        const v = m / 255, bh = Math.max(2, v * (h - 8));
        vctx.fillStyle = v > 0.82 ? '#eaf4e6' : '#0cee00';
        vctx.globalAlpha = 0.35 + v * 0.65;
        vctx.fillRect(b * bw + 1, h - bh, bw - 3, bh);
      }
      vctx.globalAlpha = 1;
      wave = wave || new Uint8Array(layerMeters[0].fftSize);
      layerMeters.forEach((a, i) => {
        a.getByteTimeDomainData(wave);
        let peak = 0; for (let k = 0; k < wave.length; k++) peak = Math.max(peak, Math.abs(wave[k] - 128));
        faders[i].meter.style.transform = `scaleX(${Math.min(1, peak / 70).toFixed(3)})`;
      });
    };
    loop();
  }

  emit();
})();
