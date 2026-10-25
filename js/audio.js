(function () {
  const $ = (s) => document.querySelector(s);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const TRACKS = [
    {
      title: 'Subnivel 7', sub: 'ambient · La menor', bpm: 70,
      roots: [33, 29, 36, 31], chords: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]],
      arp: [0, -1, 1, -1, 2, -1, 1, -1, 0, -1, 2, -1, 1, -1, 2, 1], arpWave: 'triangle', arpOct: 12, bass: 'sine',
      pad: true, kick: [], snare: [], hat: [2, 6, 10, 14], hatVol: 0.05,
    },
    {
      title: 'Equilibrio // Jefe', sub: 'combate · Re menor', bpm: 140,
      roots: [38, 34, 41, 36], chords: [[62, 65, 69], [58, 62, 65], [60, 65, 69], [60, 64, 67]],
      arp: [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 2, 1, 0, 1], arpWave: 'square', arpOct: 12, bass: 'sawtooth', bassEighths: true,
      pad: false, kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], hatVol: 0.07,
    },
    {
      title: 'Terminal Idle', sub: 'chiptune · Mi menor', bpm: 100,
      roots: [40, 36, 43, 38], chords: [[64, 67, 71], [60, 64, 67], [62, 67, 71], [62, 66, 69]],
      arp: [0, 2, 1, 2, 0, 2, 1, 2, 2, 1, 0, 1, 2, 1, 0, 1], arpWave: 'square', arpOct: 12, bass: 'triangle',
      pad: false, kick: [0, 8], snare: [12], hat: Array.from({ length: 16 }, (_, i) => i), hatVol: 0.03,
    },
  ];

  const EQ_FREQS = [60, 250, 1000, 4000, 12000];
  const EQ_TYPES = ['lowshelf', 'peaking', 'peaking', 'peaking', 'highshelf'];
  const EQ_LABELS = ['60', '250', '1k', '4k', '12k'];
  const PRESETS = { Flat: [0, 0, 0, 0, 0], 'Bass+': [8, 4, 0, -1, -2], 'Lo-fi': [3, 4, 2, -5, -10], Bright: [-2, -1, 1, 5, 8], Voces: [-4, 1, 5, 3, 0] };

  let ctx = null, bus, eq = [], master, analyser, noiseBuf;
  let trackIdx = 0, step = 0, nextT = 0, timer = null, playing = false;
  const gains = [0, 0, 0, 0, 0];

  const tracksEl = $('#ost-tracks');
  TRACKS.forEach((t, i) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(i === 0));
    b.textContent = 'T' + (i + 1); b.title = t.title;
    b.addEventListener('click', () => select(i));
    tracksEl.append(b);
  });

  const sliders = EQ_FREQS.map((f, i) => {
    const d = document.createElement('div');
    d.className = 'eq-band';
    d.innerHTML = `<output>0</output><input class="eq-slider" type="range" min="-12" max="12" step="1" value="0" aria-label="${EQ_LABELS[i]} Hz"><span>${EQ_LABELS[i]}</span>`;
    const inp = d.querySelector('input'), out = d.querySelector('output');
    inp.addEventListener('input', () => setBand(i, +inp.value));
    $('#eq-bands').append(d);
    return { inp, out };
  });

  Object.entries(PRESETS).forEach(([name, vals]) => {
    const b = document.createElement('button');
    b.className = 'btn sm'; b.textContent = name;
    b.addEventListener('click', () => vals.forEach((v, i) => { sliders[i].inp.value = v; setBand(i, v); }));
    $('#eq-presets').append(b);
  });

  function setBand(i, db) {
    gains[i] = db;
    sliders[i].out.textContent = (db > 0 ? '+' : '') + db;
    if (eq[i]) eq[i].gain.setTargetAtTime(db, ctx.currentTime, 0.02);
    drawCurve();
  }

  const vol = $('#ost-vol'), volOut = vol.parentElement.querySelector('output');
  try { vol.value = localStorage.getItem('vol') || 70; } catch (e) {}
  vol.addEventListener('input', () => { applyVol(); try { localStorage.setItem('vol', vol.value); } catch (e) {} });
  function applyVol() {
    volOut.textContent = vol.value + '%';
    if (master) master.gain.setTargetAtTime((vol.value / 100) * 0.9, ctx.currentTime, 0.02);
  }
  applyVol();

  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    bus = ctx.createGain(); bus.gain.value = 0.8;
    eq = EQ_FREQS.map((f, i) => {
      const n = ctx.createBiquadFilter();
      n.type = EQ_TYPES[i]; n.frequency.value = f; n.Q.value = 1.0; n.gain.value = gains[i];
      return n;
    });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.15;
    master = ctx.createGain();
    analyser = ctx.createAnalyser(); analyser.fftSize = 512; analyser.smoothingTimeConstant = 0.8;
    let prev = bus;
    eq.forEach((n) => { prev.connect(n); prev = n; });
    prev.connect(comp); comp.connect(master); master.connect(analyser); analyser.connect(ctx.destination);
    applyVol();

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  function tone(freq, t, dur, type, v, opts = {}) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    let node = o;
    if (opts.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = opts.lp; o.connect(f); node = f; }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + (opts.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(t, dur, v, hp) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp;
    const g = ctx.createGain();
    g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.25);
  }

  function playStep(tr, s, t) {
    const bar = Math.floor(s / 16) % 4, k = s % 16;
    const sd = 60 / tr.bpm / 4;
    const chord = tr.chords[bar];
    if (k === 0 && tr.pad) chord.forEach((n, i) => tone(mtof(n - 12 + (i === 2 ? 12 : 0)), t, sd * 16, 'sawtooth', 0.025, { lp: 700, attack: 0.5 }));
    if (tr.bassEighths) { if (k % 2 === 0) tone(mtof(tr.roots[bar]), t, sd * 1.8, tr.bass, 0.16, { lp: 600 }); }
    else if (k % 8 === 0) tone(mtof(tr.roots[bar]), t, sd * 7.5, tr.bass, 0.22, tr.bass === 'sine' ? {} : { lp: 500 });
    const a = tr.arp[k];
    if (a >= 0) tone(mtof(chord[a] + tr.arpOct), t, sd * 1.6, tr.arpWave, tr.arpWave === 'square' ? 0.045 : 0.08, { lp: 3500 });
    if (tr.kick.includes(k)) kick(t);
    if (tr.snare.includes(k)) noise(t, 0.14, 0.22, 1800);
    if (tr.hat.includes(k)) noise(t, 0.04, tr.hatVol, 7000);
  }

  function scheduler() {
    const tr = TRACKS[trackIdx], sd = 60 / tr.bpm / 4;
    while (nextT < ctx.currentTime + 0.14) { playStep(tr, step, nextT); nextT += sd; step++; }
  }

  function emit() {
    const tr = TRACKS[trackIdx];
    $('#ost-play').textContent = playing ? '❚❚ Pausa' : '▶ Play';
    $('#ost-tag').textContent = playing ? 'sonando' : 'en pausa';
    $('#ost-title').textContent = tr.title;
    $('#ost-meta').textContent = `${tr.sub} · ${tr.bpm} BPM`;
    $('#mini-play').textContent = playing ? '❚❚' : '▶';
    $('#mini-title').textContent = playing ? tr.title : 'Sin reproducir';
  }

  async function play() {
    if (!ctx) init();
    if (ctx.state === 'suspended') await ctx.resume();
    if (playing) return;
    playing = true;
    nextT = ctx.currentTime + 0.06;
    timer = setInterval(scheduler, 25);
    emit(); loop();
  }
  function pause() {
    if (!playing) return;
    playing = false; clearInterval(timer);
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    setTimeout(() => { if (!playing) ctx.suspend(); master.gain.cancelScheduledValues(ctx.currentTime); applyVol(); }, 200);
    emit();
  }
  const toggle = () => {
    try { localStorage.setItem('music', playing ? 'off' : 'on'); } catch (e) {}
    playing ? pause() : play();
  };

  let musicOff = false;
  try { musicOff = localStorage.getItem('music') === 'off'; } catch (e) {}
  if (!musicOff) {
    const kick = (e) => {
      ['pointerdown', 'keydown'].forEach((t) => removeEventListener(t, kick, true));
      if (e.target.closest && e.target.closest('#ost-play, #mini-play')) return;
      play();
    };
    ['pointerdown', 'keydown'].forEach((t) => addEventListener(t, kick, true));
  }
  function select(i) {
    trackIdx = clamp(i, 0, TRACKS.length - 1); step = 0;
    if (ctx) nextT = ctx.currentTime + 0.06;
    tracksEl.querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-checked', String(j === trackIdx)));
    emit();
  }
  $('#ost-play').addEventListener('click', toggle);
  $('#mini-play').addEventListener('click', toggle);

  const viz = $('#ost-viz'), vctx = viz.getContext('2d');
  const eqc = $('#eq-curve'), ectx = eqc.getContext('2d');
  let vizVisible = true, data = null;
  if ('IntersectionObserver' in window) new IntersectionObserver(([e]) => { vizVisible = e.isIntersecting; }).observe(viz);

  function loop() {
    if (!playing) { drawBars(false); return; }
    if (vizVisible) drawBars(true);
    requestAnimationFrame(loop);
  }
  function drawBars(live) {
    const W = viz.width, H = viz.height, N = 48, bw = W / N;
    vctx.clearRect(0, 0, W, H);
    if (live && analyser) { data = data || new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data); }
    vctx.fillStyle = '#4ce228';
    vctx.globalAlpha = live ? 0.9 : 0.35;
    for (let i = 0; i < N; i++) {
      const v = live && data ? data[Math.floor(Math.pow(i / N, 2) * data.length * 0.75)] / 255 : 0;
      const h = Math.max(2, v * (H - 8));
      vctx.fillRect(i * bw + 1, H - h, bw - 3, h);
    }
    vctx.globalAlpha = 1;
  }

  let offline = null;
  function drawCurve() {
    const W = eqc.width, H = eqc.height, N = 160;
    ectx.clearRect(0, 0, W, H);
    ectx.strokeStyle = 'rgba(76,226,40,.12)'; ectx.lineWidth = 1;
    [-12, -6, 0, 6, 12].forEach((db) => { const y = H / 2 - (db / 12) * (H / 2 - 8); ectx.beginPath(); ectx.moveTo(0, y); ectx.lineTo(W, y); ectx.stroke(); });
    const freqs = new Float32Array(N);
    for (let i = 0; i < N; i++) freqs[i] = 20 * Math.pow(1000, i / (N - 1));
    const total = new Float32Array(N).fill(1);
    const src = ctx || (offline = offline || new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 44100));
    EQ_FREQS.forEach((f, i) => {
      const n = src.createBiquadFilter();
      n.type = EQ_TYPES[i]; n.frequency.value = f; n.Q.value = 1.0; n.gain.value = gains[i];
      const mag = new Float32Array(N);
      n.getFrequencyResponse(freqs, mag, new Float32Array(N));
      for (let k = 0; k < N; k++) total[k] *= mag[k];
    });
    ectx.beginPath();
    for (let k = 0; k < N; k++) {
      const db = clamp(20 * Math.log10(total[k]), -14, 14);
      const x = (k / (N - 1)) * W, y = H / 2 - (db / 12) * (H / 2 - 8);
      k ? ectx.lineTo(x, y) : ectx.moveTo(x, y);
    }
    ectx.strokeStyle = '#4ce228'; ectx.lineWidth = 2; ectx.stroke();
  }

  emit(); drawBars(false); drawCurve();
})();
