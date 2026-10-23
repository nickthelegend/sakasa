(() => {
  const data = window.SAKASA_DATA || {};
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Gravity compass: the needle points to each section's "down".
  const ANGLE = { down: 0, left: 90, up: 180, right: -90 };
  const compass = document.querySelector('.compass');
  const sections = [...document.querySelectorAll('[data-down]')];
  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.remove('pending');
          const a = ANGLE[e.target.dataset.down] ?? 0;
          compass?.style.setProperty('--angle', `${a}deg`);
        }
      }
    },
    { rootMargin: '-35% 0px -35% 0px' },
  );
  for (const s of sections) {
    if (!reduce && s.classList.contains('axis')) s.classList.add('pending');
    seen.observe(s);
  }

  // Hero video: honour reduced motion (show the poster, let people press play).
  const video = document.getElementById('hero-video');
  if (video && reduce) {
    video.removeAttribute('autoplay');
    video.pause();
    video.setAttribute('controls', '');
  }

  // Room plans of generated puzzles (data from scripts/build-data.mjs).
  const plans = document.getElementById('plans');
  if (plans) {
    const list = data.plans || [];
    if (list.length === 0) {
      plans.innerHTML = '<p class="plans-empty">Room plans appear here after <code>npm run data</code> builds them from the emulator room captures.</p>';
    }
    for (const p of list) {
      const pad = 0.15;
      const w = p.size[0];
      const d = p.size[1];
      const sx = (x) => ((x - p.min[0] + pad) / (w + 2 * pad)) * 300;
      const sz = (z) => ((z - p.min[1] + pad) / (d + 2 * pad)) * 300 * ((d + 2 * pad) / (w + 2 * pad));
      const h = 300 * ((d + 2 * pad) / (w + 2 * pad));
      const rect = (b, cls) =>
        `<rect class="${cls}" x="${sx(b.min[0]).toFixed(1)}" y="${sz(b.min[1]).toFixed(1)}" width="${(sx(b.max[0]) - sx(b.min[0])).toFixed(1)}" height="${(sz(b.max[1]) - sz(b.min[1])).toFixed(1)}" />`;
      const svg = `
        <svg viewBox="0 0 300 ${h.toFixed(1)}" role="img" aria-label="Plan of ${p.env}: ${p.solids.length} pieces of furniture, ${p.blocks.length} paper blocks, par ${p.par}">
          <style>
            .room{fill:none;stroke:var(--paper);stroke-width:2}
            .solid{fill:color-mix(in srgb,var(--mute) 25%,transparent);stroke:var(--mute);stroke-width:1}
            .block{fill:var(--paper);stroke:var(--ink);stroke-width:1}
            .path{fill:none;stroke:var(--flip);stroke-width:2;stroke-dasharray:4 4}
          </style>
          <rect class="room" x="${sx(p.min[0])}" y="${sz(p.min[1])}" width="${sx(p.min[0] + w) - sx(p.min[0])}" height="${sz(p.min[1] + d) - sz(p.min[1])}" />
          ${p.solids.map((b) => rect(b, 'solid')).join('')}
          ${p.blocks.map((b) => rect(b, 'block')).join('')}
          <polyline class="path" points="${p.path.map((q) => `${sx(q[0]).toFixed(1)},${sz(q[1]).toFixed(1)}`).join(' ')}" />
          <circle cx="${sx(p.start[0])}" cy="${sz(p.start[1])}" r="6" fill="var(--flip)" />
          <circle cx="${sx(p.goal[0])}" cy="${sz(p.goal[1])}" r="9" fill="none" stroke="var(--flip)" stroke-width="3" />
          <circle cx="${sx(p.head[0])}" cy="${sz(p.head[1])}" r="4" fill="var(--paper)" />
        </svg>`;
      const el = document.createElement('article');
      el.className = 'plan';
      el.innerHTML = `${svg}<h3>${p.label}</h3><p class="mono small">${p.size[0].toFixed(1)} x ${p.size[1].toFixed(1)} m / PAR ${p.par} / ${p.solution}</p>`;
      plans.appendChild(el);
    }
  }

  // Metrics from the test reports.
  const metrics = document.getElementById('metrics');
  if (metrics) {
    const m = data.metrics;
    if (!m) {
      metrics.innerHTML = '<div><dt>STATUS</dt><dd><small>Run the e2e suite to fill these in.</small></dd></div>';
    } else {
      metrics.innerHTML = m
        .map((x) => `<div><dt>${x.label}</dt><dd>${x.value}${x.unit ? ` <small>${x.unit}</small>` : ''}</dd></div>`)
        .join('');
    }
  }
})();
