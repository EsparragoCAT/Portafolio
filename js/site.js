(function () {
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const seg = $('#crt-select');
  const current = () => (root.className.match(/crt-(off|scan|full)/) || [, 'scan'])[1];
  function setCRT(mode) {
    root.classList.remove('crt-off', 'crt-scan', 'crt-full');
    root.classList.add('crt-' + mode);
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', b.dataset.mode === mode));
    try { localStorage.setItem('crt', mode); } catch (e) {}
  }
  setCRT(current());
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.mode === current()) return;
    setCRT(b.dataset.mode);
    if (b.dataset.mode === 'full' && !reduceMotion) {
      root.classList.add('crt-power');
      setTimeout(() => root.classList.remove('crt-power'), 520);
    }
  });

  if ('IntersectionObserver' in window && !reduceMotion) {
    root.classList.add('reveal-on');
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  }

  const USER = 'EsparragoCAT', CACHE = 'gh-repos', TTL = 30 * 60 * 1000;
  const LANG_COLORS = { Java: '#b07219', Rust: '#dea584', JavaScript: '#f1e05a', TypeScript: '#3178c6', CSS: '#663399', HTML: '#e34c26', Kotlin: '#a97bff', Python: '#3572a5', 'C#': '#178600', Svelte: '#ff3e00' };
  const list = $('#repos');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function ago(iso) {
    const days = Math.floor((Date.now() - new Date(iso)) / 864e5);
    if (days < 1) return 'hoy';
    if (days === 1) return 'ayer';
    if (days < 30) return `hace ${days} días`;
    const months = Math.floor(days / 30);
    if (months < 12) return months === 1 ? 'hace un mes' : `hace ${months} meses`;
    return 'hace más de un año';
  }

  function render(repos) {
    repos = repos.filter((r) => !r.fork).slice(0, 6);
    if (!repos.length) { list.innerHTML = '<li class="note">Todavía no hay repos públicos.</li>'; return; }
    list.innerHTML = repos.map((r) => `
      <li><a class="repo inset" href="${esc(r.html_url)}">
        <span class="repo-name">${esc(r.name)}</span>
        <p>${r.description ? esc(r.description) : '<span class="note">Sin descripción todavía.</span>'}</p>
        <span class="repo-meta">
          ${r.language ? `<span class="lang" style="--c:${LANG_COLORS[r.language] || 'var(--phos)'}">${esc(r.language)}</span>` : ''}
          <span>actualizado ${ago(r.pushed_at)}</span>
          ${r.stargazers_count ? `<span>★ ${r.stargazers_count}</span>` : ''}
        </span>
      </a></li>`).join('');
  }

  function fail() {
    list.innerHTML = `<li class="note">No pude cargar los repos ahora. Están en <a href="https://github.com/${USER}">github.com/${USER}</a>.</li>`;
  }

  let cached = null;
  try { cached = JSON.parse(sessionStorage.getItem(CACHE)); } catch (e) {}
  if (cached && Date.now() - cached.t < TTL) render(cached.data);
  else fetch(`https://api.github.com/users/${USER}/repos?sort=pushed&per_page=12`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((data) => {
      render(data);
      try { sessionStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), data })); } catch (e) {}
    })
    .catch(fail);

  const params = [
    { id: 'dmg', label: 'Daño por bala', min: 5, max: 120, step: 1, value: 32 },
    { id: 'rof', label: 'Balas por segundo', min: 1, max: 20, step: 0.5, value: 8 },
    { id: 'acc', label: 'Precisión', min: 20, max: 100, step: 1, value: 75, unit: '%' },
    { id: 'hp', label: 'Vida del enemigo', min: 50, max: 1000, step: 10, value: 200 },
    { id: 'arm', label: 'Armadura', min: 0, max: 300, step: 5, value: 50 },
  ];
  const ctl = $('#ttk-ctl'), v = {};
  for (const p of params) {
    v[p.id] = p.value;
    const l = document.createElement('label');
    l.className = 'ctl';
    l.innerHTML = `<span>${p.label}</span><output></output>` +
      `<input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.value}">`;
    const out = l.querySelector('output'), inp = l.querySelector('input');
    const show = () => { out.textContent = inp.value + (p.unit || ''); };
    inp.addEventListener('input', () => { v[p.id] = +inp.value; show(); calc(); });
    show();
    ctl.append(l);
  }

  function calc() {
    const perHit = v.dmg * 100 / (100 + v.arm);
    const hits = Math.ceil(v.hp / perHit);
    const shots = hits / (v.acc / 100);
    const ttk = Math.max(0, (shots - 1) / v.rof);
    $('#ttk-val').textContent = ttk.toFixed(2);
    $('#ttk-hits').textContent = `${hits} impactos · ${perHit.toFixed(1)} de daño real por bala`;
    $('#ttk-verdict').textContent =
      ttk < 0.3 ? 'Muere al instante. No da tiempo a reaccionar.' :
      ttk < 0.9 ? 'Rápido, estilo arcade.' :
      ttk <= 1.8 ? 'Zona cómoda: da tiempo a moverse y decidir.' :
      ttk <= 3.5 ? 'Se empieza a sentir esponja.' :
      'Demasiado tanque. Nadie se divierte acá.';
  }
  calc();
})();
