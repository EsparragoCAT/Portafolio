/* CAT Stream: cliente compartido de los overlays.
   - Chat de Twitch por IRC anónimo (no hace falta login): mensajes, subs, regalos, bits y raids.
   - Follows por EventSub, solo si la URL trae ?cid= (Client ID) y ?token= (se consiguen en el panel).
   - Pruebas: ?demo=1 repite eventos de ejemplo; el panel manda pruebas por postMessage;
     en tu propio chat, "!test" o "!test sub|gift|giftbomb|bits|raid|follow" dispara una alerta (solo vos o mods). */
window.CAT = (function () {
  const q = new URLSearchParams(location.search);
  const opt = (k, d) => (q.has(k) && q.get(k) !== '' ? q.get(k) : d);
  const subs = {};
  const on = (type, fn) => { (subs[type] = subs[type] || []).push(fn); };
  const emit = (type, ev) => { (subs[type] || []).forEach((f) => f(ev)); (subs['*'] || []).forEach((f) => f(type, ev)); };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- IRC ---------- */
  function parseTags(raw) {
    const t = {};
    for (const part of raw.split(';')) {
      const i = part.indexOf('=');
      const k = i < 0 ? part : part.slice(0, i);
      const v = i < 0 ? '' : part.slice(i + 1).replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\').replace(/\\r/g, '').replace(/\\n/g, '');
      t[k] = v;
    }
    return t;
  }
  function parseLine(line) {
    let rest = line, tags = {}, prefix = '';
    if (rest[0] === '@') { const i = rest.indexOf(' '); tags = parseTags(rest.slice(1, i)); rest = rest.slice(i + 1); }
    if (rest[0] === ':') { const i = rest.indexOf(' '); prefix = rest.slice(1, i); rest = rest.slice(i + 1); }
    const ti = rest.indexOf(' :');
    const trailing = ti >= 0 ? rest.slice(ti + 2) : '';
    const parts = (ti >= 0 ? rest.slice(0, ti) : rest).split(' ');
    return { tags, prefix, command: parts[0], params: parts.slice(1), trailing };
  }
  const badgesOf = (t) => (t.badges || '').split(',').filter(Boolean).map((b) => b.split('/')[0]);
  const nameOf = (m) => m.tags['display-name'] || (m.prefix.split('!')[0]) || 'alguien';

  function handle(m) {
    const t = m.tags;
    if (m.command === 'PRIVMSG') {
      let text = m.trailing;
      let action = false;
      if (text.startsWith('\u0001ACTION ') && text.endsWith('\u0001')) { text = text.slice(8, -1); action = true; }
      const badges = badgesOf(t);
      const msg = { id: t.id, userId: t['user-id'], name: nameOf(m), color: t.color, badges, emotes: t.emotes || '', text, action, bits: +t.bits || 0 };
      // comandos de prueba: solo el dueño del canal o mods
      const boss = badges.includes('broadcaster') || badges.includes('moderator');
      const cmd = text.trim().toLowerCase().match(/^!test(?:\s+(\w+))?$/);
      if (boss && cmd) { emit('alert', demo(cmd[1] || 'sub')); return; }
      emit('chat', msg);
      if (msg.bits) emit('alert', { type: 'bits', name: msg.name, amount: msg.bits, text: text.replace(/\b[a-z]+\d+\b/gi, '').trim() });
      return;
    }
    if (m.command === 'USERNOTICE') {
      const id = t['msg-id'], name = nameOf(m);
      const months = +t['msg-param-cumulative-months'] || 1, plan = t['msg-param-sub-plan'] || '1000';
      const tier = plan === 'Prime' ? 'Prime' : plan === '3000' ? 'Nivel 3' : plan === '2000' ? 'Nivel 2' : 'Nivel 1';
      if (id === 'sub' || id === 'resub') emit('alert', { type: 'sub', name, months, tier, text: m.trailing });
      else if (id === 'subgift' || id === 'anonsubgift') emit('alert', { type: 'gift', name: id === 'anonsubgift' ? 'Anónimo' : name, to: t['msg-param-recipient-display-name'] || 'alguien', tier });
      else if (id === 'submysterygift' || id === 'anonsubmysterygift') emit('alert', { type: 'giftbomb', name: id.startsWith('anon') ? 'Anónimo' : name, count: +t['msg-param-mass-gift-count'] || 1, tier });
      else if (id === 'raid') emit('alert', { type: 'raid', name: t['msg-param-displayName'] || name, viewers: +t['msg-param-viewerCount'] || 0 });
      if (m.trailing) emit('chat', { id: t.id, name, color: t.color, badges: badgesOf(t), emotes: t.emotes || '', text: m.trailing, system: true });
      return;
    }
    if (m.command === 'CLEARMSG') emit('clear', { id: t['target-msg-id'] });
    else if (m.command === 'CLEARCHAT') emit('clear', { userId: t['target-user-id'] || null });
  }

  let ws = null, retry = 1000;
  function connectChat(channel) {
    channel = String(channel || '').toLowerCase().replace(/^#/, '').trim();
    if (!channel) { emit('status', 'sin canal'); return; }
    ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443');
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      ws.send('PASS SCHMOOPIIE');
      ws.send('NICK justinfan' + Math.floor(10000 + Math.random() * 80000));
      ws.send('JOIN #' + channel);
    };
    ws.onmessage = (e) => {
      for (const line of String(e.data).split('\r\n')) {
        if (!line) continue;
        if (line.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv'); continue; }
        const m = parseLine(line);
        if (m.command === 'JOIN') { retry = 1000; emit('status', 'conectado a #' + channel); }
        handle(m);
      }
    };
    ws.onclose = () => { emit('status', 'reconectando…'); setTimeout(() => connectChat(channel), retry); retry = Math.min(retry * 2, 30000); };
  }

  /* ---------- follows (EventSub) ---------- */
  async function connectFollows(cid, token) {
    const H = { 'Client-Id': cid, Authorization: 'Bearer ' + token };
    let uid;
    try {
      const r = await fetch('https://api.twitch.tv/helix/users', { headers: H });
      if (!r.ok) throw new Error(r.status);
      uid = (await r.json()).data[0].id;
    } catch (e) { emit('status', 'follows: token inválido o vencido'); return; }
    const open = (url) => {
      const es = new WebSocket(url);
      es.onmessage = async (e) => {
        const m = JSON.parse(e.data), kind = m.metadata && m.metadata.message_type;
        if (kind === 'session_welcome') {
          if (url !== 'wss://eventsub.wss.twitch.tv/ws') return; // reconexión: las suscripciones siguen
          await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
            method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'channel.follow', version: '2', condition: { broadcaster_user_id: uid, moderator_user_id: uid }, transport: { method: 'websocket', session_id: m.payload.session.id } })
          });
          emit('status', 'follows conectados');
        } else if (kind === 'notification' && m.payload.subscription.type === 'channel.follow') {
          emit('alert', { type: 'follow', name: m.payload.event.user_name });
        } else if (kind === 'session_reconnect') {
          open(m.payload.session.reconnect_url);
          setTimeout(() => es.close(), 1000);
        }
      };
      es.onclose = (e) => { if (e.code !== 1000) setTimeout(() => open('wss://eventsub.wss.twitch.tv/ws'), 5000); };
    };
    open('wss://eventsub.wss.twitch.tv/ws');
  }

  /* ---------- pruebas ---------- */
  const NAMES = ['NuevoGato', 'PixelFeliz', 'Orion_42', 'MiauMaster', 'Lucecita', 'ByteNegro'];
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function demo(type) {
    const n = pick(NAMES);
    switch (type) {
      case 'follow': return { type: 'follow', name: n };
      case 'gift': return { type: 'gift', name: n, to: pick(NAMES), tier: 'Nivel 1' };
      case 'giftbomb': return { type: 'giftbomb', name: n, count: 5, tier: 'Nivel 1' };
      case 'bits': return { type: 'bits', name: n, amount: 500, text: '¡Arriba CAT!' };
      case 'raid': return { type: 'raid', name: n, viewers: 37 };
      default: return { type: 'sub', name: n, months: 6, tier: 'Nivel 1', text: 'Seis meses con el gato' };
    }
  }
  const DEMO_CHAT = [
    'Hola gente, llegué justo', 'ese mod está buenísimo', 'CAT CAT CAT', '¿Qué versión de Minecraft es?',
    'jajaja no puede ser', 'el diseño del overlay 🔥', 'GG', '¿Cuándo sale CATStage?'
  ];
  function demoChat() {
    const badges = [[], ['subscriber'], ['moderator'], ['vip'], ['subscriber'], []][Math.floor(Math.random() * 6)];
    return { id: 'd' + Date.now() + Math.random(), name: pick(NAMES), color: pick(['#0CEE00', '#9dff8a', '#ffd166', '#7ad7ff', '#ff8ab3', '']), badges, emotes: '', text: pick(DEMO_CHAT) };
  }
  // el panel de control manda pruebas a las vistas previas
  window.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.cat === 'alert') emit('alert', demo(d.kind));
    else if (d.cat === 'chat') emit('chat', demoChat());
  });

  /* ---------- texto con emotes ---------- */
  function renderText(text, emotes) {
    const chars = Array.from(text);
    const ranges = [];
    for (const part of (emotes || '').split('/').filter(Boolean)) {
      const [id, pos] = part.split(':');
      for (const r of (pos || '').split(',')) { const [a, b] = r.split('-').map(Number); ranges.push([a, b, id]); }
    }
    ranges.sort((x, y) => x[0] - y[0]);
    let out = '', i = 0;
    for (const [a, b, id] of ranges) {
      out += esc(chars.slice(i, a).join(''));
      out += `<img class="emote" alt="${esc(chars.slice(a, b + 1).join(''))}" src="https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0">`;
      i = b + 1;
    }
    return out + esc(chars.slice(i).join(''));
  }

  /* ---------- sonidos sintetizados (sin archivos) ---------- */
  let ac = null;
  function blip(notes, wave = 'square', vol = 0.12) {
    if (opt('sonido', '1') === '0') return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ac.currentTime + 0.02;
      notes.forEach(([f, at, dur]) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = wave; o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + at); g.gain.linearRampToValueAtTime(vol * (+opt('volumen', 100) / 100), t0 + at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
        o.connect(g); g.connect(ac.destination); o.start(t0 + at); o.stop(t0 + at + dur + 0.02);
      });
    } catch (e) {}
  }

  /* ---------- sonidos de las alertas (assets/sonidos/<tipo>.ogg) ----------
     ?sonido=0 los apaga · ?volumen=80 · ?snd_sub=https://... reemplaza el de un tipo por otro archivo */
  const cache = {};
  function play(name, gain = 1, fallback) {
    if (opt('sonido', '1') === '0') return;
    const src = opt('snd_' + name, 'assets/sonidos/' + name + '.ogg');
    let a = cache[src];
    if (!a) { a = cache[src] = new Audio(src); a.preload = 'auto'; }
    const node = a.paused ? a : a.cloneNode();
    node.volume = Math.max(0, Math.min(1, gain * (+opt('volumen', 100) / 100)));
    const p = node.play();
    if (p && p.catch) p.catch(() => { if (fallback) blip(fallback); });
  }
  function preload(names) { if (opt('sonido', '1') !== '0') names.forEach((n) => { const s = opt('snd_' + n, 'assets/sonidos/' + n + '.ogg'); if (!cache[s]) { cache[s] = new Audio(s); cache[s].preload = 'auto'; } }); }

  function start({ chat = true } = {}) {
    if (opt('demo')) {
      const every = +opt('cada', 7) * 1000;
      const kinds = ['follow', 'sub', 'bits', 'gift', 'raid', 'giftbomb'];
      let k = 0;
      if (subs.alert) setInterval(() => emit('alert', demo(kinds[k++ % kinds.length])), every);
      if (subs.chat) setInterval(() => emit('chat', demoChat()), 1600);
      emit('status', 'modo demo');
      return;
    }
    if (chat) connectChat(opt('canal'));
    if (opt('cid') && opt('token')) connectFollows(opt('cid'), opt('token'));
  }

  return { opt, on, emit, esc, start, demo, demoChat, renderText, blip, play, preload, _parse: (l) => { handle(parseLine(l)); } };
})();
