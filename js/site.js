(function () {
  const $ = (s) => document.querySelector(s);
  const root = document.documentElement;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---- modos de pantalla: OFF / SCAN / FULL ---- */
  const seg = $('#crt-select');
  const current = () => (root.className.match(/crt-(off|scan|full)/) || [, 'scan'])[1];
  function setCRT(mode) {
    root.classList.remove('crt-off', 'crt-scan', 'crt-full');
    root.classList.add('crt-' + mode);
    seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
    try { localStorage.setItem('crt', mode); } catch (e) {}
  }
  setCRT(current());
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.dataset.mode === current()) return;
    setCRT(b.dataset.mode);
    if (b.dataset.mode === 'full' && !reduceMotion) {
      root.classList.add('crt-power');
      setTimeout(() => root.classList.remove('crt-power'), 480);
    }
  });

  /* ---- aparición de bloques ---- */
  if ('IntersectionObserver' in window && !reduceMotion) {
    root.classList.add('reveal-on');
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
    }, { rootMargin: '0px 0px -8% 0px' });
    document.querySelectorAll('.reveal').forEach((el) => io.observe(el));
  }

  /* ---- GitHub ---- */
  const USER = 'EsparragoCAT', CACHE = 'gh-repos', TTL = 30 * 60 * 1000;
  const LANG_COLORS = { Java: '#b07219', Rust: '#dea584', JavaScript: '#f1e05a', TypeScript: '#3178c6', CSS: '#663399', HTML: '#e34c26', Kotlin: '#a97bff', Python: '#3572a5', 'C#': '#178600', Svelte: '#ff3e00' };
  const list = $('#repos'), count = $('#repo-count');
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
    const own = repos.filter((r) => !r.fork);
    count.textContent = String(own.length).padStart(2, '0');
    const shown = own.slice(0, 6);
    if (!shown.length) { list.innerHTML = '<li class="nota">Todavía no hay repos públicos.</li>'; return; }
    list.innerHTML = shown.map((r) => `
      <li><a class="repo" href="${esc(r.html_url)}">
        <span class="repo-name">${esc(r.name)}</span>
        <p>${r.description ? esc(r.description) : 'Sin descripción todavía.'}</p>
        <span class="repo-meta">
          ${r.language ? `<span class="lang" style="--c:${LANG_COLORS[r.language] || 'var(--verde)'}">${esc(r.language)}</span>` : ''}
          <span>${ago(r.pushed_at)}</span>
          ${r.stargazers_count ? `<span>★ ${r.stargazers_count}</span>` : ''}
        </span>
      </a></li>`).join('');
  }

  function fail() {
    count.textContent = '—';
    list.innerHTML = `<li class="nota">No pude cargar los repos ahora. Están en <a href="https://github.com/${USER}">github.com/${USER}</a>.</li>`;
  }

  let cached = null;
  try { cached = JSON.parse(sessionStorage.getItem(CACHE)); } catch (e) {}
  if (cached && Date.now() - cached.t < TTL) render(cached.data);
  else fetch(`https://api.github.com/users/${USER}/repos?sort=pushed&per_page=100`)
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((data) => {
      render(data);
      try { sessionStorage.setItem(CACHE, JSON.stringify({ t: Date.now(), data })); } catch (e) {}
    })
    .catch(fail);
})();
