/* Taskmarket Pulse — renders data/market.json. No dependencies, no tracking.  */
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const MICRO = 1e6;
  const SITE = 'https://parksiihu7.github.io/taskmarket-pulse/';
  const REPO = 'https://github.com/parksiihu7/taskmarket-pulse';
  const DATA_URL = 'data/market.json';

  const state = { chain: 'both', range: '30d', heat: 'hour30d' };
  let D = null;

  /* ───────────────────────────── helpers ───────────────────────────── */

  const $ = (s, r = document) => r.querySelector(s);
  const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function svg(tag, attrs = {}) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }

  const num = (n) => (n == null || isNaN(n)) ? '—' : Number(n).toLocaleString('en-US');
  function compact(n) {
    if (n == null || isNaN(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.0+$/, '') + 'M';
    if (a >= 1e4) return (n / 1e3).toFixed(0) + 'k';
    if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }
  function money(n) { // whole tokens, both chains are USD stablecoins
    if (n == null || isNaN(n)) return '—';
    const a = Math.abs(n);
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(2).replace(/\.00$/, '') + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(a >= 1e4 ? 1 : 2).replace(/\.0+$/, '') + 'k';
    if (a >= 100) return '$' + Math.round(n);
    if (a >= 1) return '$' + n.toFixed(2).replace(/\.00$/, '');
    return '$' + n.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }
  const pct = (n, d = 0) => (n == null || isNaN(n)) ? '—' : n.toFixed(d) + '%';
  const addr = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '—';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function dayLabel(s) { // "2026-11-24" -> "Nov 24"
    const [, m, d] = s.split('-');
    return MONTHS[Number(m) - 1] + ' ' + Number(d);
  }
  function weekLabel(s) {
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCDate();
  }
  function utcStamp(iso) {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
  }
  function relTime(iso) {
    const t = new Date(iso).getTime();
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return Math.floor(s) + 's ago';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm ago';
    return Math.floor(s / 86400) + 'd ago';
  }

  /* ─────────────────────── data selection ─────────────────────── */

  const ids = () => state.chain === 'both' ? ['4217', '8453'] : [state.chain];
  const chainObjs = () => ids().map((id) => D.chains[id]);
  const derived = () => state.chain === 'both' ? D.combined : D.chains[state.chain].derived;
  const shared = (key) => !!(D.identical && D.identical[key]);

  function series(range = state.range) {
    if (shared('series')) {
      return (D.chains['4217'].series[range] || []).map((r) =>
        ({ ...r, rewardVolume: +r.rewardVolume, paidVolume: +r.paidVolume }));
    }
    const rows = chainObjs().map((c) => c.series[range] || []);
    const base = rows[0] || [];
    if (rows.length === 1) {
      return base.map((r) => ({ ...r, rewardVolume: +r.rewardVolume, paidVolume: +r.paidVolume }));
    }
    return base.map((r, i) => {
      const acc = { ...r, rewardVolume: 0, paidVolume: 0 };
      for (const set of rows) {
        const x = set[i] || {};
        acc.tasksCreated += x.tasksCreated || 0;
        acc.completedTasks += x.completedTasks || 0;
        acc.newAgents += x.newAgents || 0;
        acc.activeAgents += x.activeAgents || 0;
        acc.settlements += x.settlements || 0;
        acc.ratings += x.ratings || 0;
        acc.rewardVolume += +(x.rewardVolume || 0);
        acc.paidVolume += +(x.paidVolume || 0);
      }
      return acc;
    });
  }

  const sum = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

  function wowDelta(key) { // last 7 daily buckets vs the 7 before, always from the 90d series
    const base = shared('series') ? D.chains['4217'] : D.chains[ids()[0]];
    const rows = (base.series && base.series['90d']) || [];
    const a = rows.slice(-7), b = rows.slice(-14, -7);
    if (a.length < 7 || b.length < 7) return null;
    const now = sum(a, key), prev = sum(b, key);
    if (!prev) return null;
    return { now, prev, change: (now - prev) / prev * 100 };
  }

  /* ─────────────────────────── controls ─────────────────────────── */

  function bindControls() {
    document.querySelectorAll('[data-chain]').forEach((b) => b.addEventListener('click', () => {
      state.chain = b.dataset.chain; syncControls(); renderAll();
    }));
    document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
      state.range = b.dataset.range; syncControls(); renderAll();
    }));
    document.querySelectorAll('[data-heat]').forEach((b) => b.addEventListener('click', () => {
      state.heat = b.dataset.heat; syncControls(); renderAll();
    }));
  }

  function syncControls() {
    document.querySelectorAll('[data-chain]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.chain === state.chain)));
    document.querySelectorAll('[data-range]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.range === state.range)));
    document.querySelectorAll('[data-heat]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.heat === state.heat)));
    const note = $('#chain-note');
    if (note) {
      note.textContent = state.chain === 'both'
        ? 'The time series, breakdowns, heatmap and feed are platform-wide: the API returns the same numbers for both chains. Task-level views count both.'
        : state.chain === '4217'
          ? 'Tempo (chainId 4217) pays in OUSD. Task-level views count Tempo tasks only.'
          : 'Base (chainId 8453) pays in USDC. Task-level views count Base tasks only.';
    }
    const url = new URL(location.href);
    if (state.chain !== 'both') url.searchParams.set('chain', state.chain); else url.searchParams.delete('chain');
    if (state.range !== '30d') url.searchParams.set('range', state.range); else url.searchParams.delete('range');
    history.replaceState(null, '', url);
  }

  function readStateFromUrl() {
    const p = new URLSearchParams(location.search);
    const c = p.get('chain');
    if (c === '4217' || c === '8453' || c === 'both') state.chain = c;
    const r = p.get('range');
    if (['7d', '30d', '90d', 'all'].includes(r)) state.range = r;
  }

  /* ─────────────────────────── chart pieces ─────────────────────────── */

  function lineChart(host, opts) {
    const { rows, key, color = '#E74079', fmt = compact, height = 132, fill = true } = opts;
    clear(host);
    const W = 520, H = height, ml = 40, mr = 10, mt = 12, mb = 20;
    const iw = W - ml - mr, ih = H - mt - mb;
    const vals = rows.map((r) => Number(r[key]) || 0);
    const max = Math.max(1, ...vals);
    const xAt = (i) => ml + (rows.length <= 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
    const yAt = (v) => mt + ih - (v / max) * ih;

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
      'aria-label': opts.label || key });
    // grid
    [0, 0.5, 1].forEach((f) => {
      const y = mt + ih - f * ih;
      root.appendChild(svg('line', { x1: ml, x2: W - mr, y1: y, y2: y, class: 'grid-line',
        'stroke-opacity': f === 0 ? 0.9 : 0.5 }));
      const t = svg('text', { x: ml - 8, y: y + 3, 'text-anchor': 'end', class: 'axis-label' });
      t.textContent = fmt(max * f);
      root.appendChild(t);
    });

    const pts = vals.map((v, i) => [xAt(i), yAt(v)]);
    if (fill && pts.length) {
      const d = `M ${pts[0][0]} ${mt + ih} ` + pts.map((p) => `L ${p[0]} ${p[1]}`).join(' ') +
        ` L ${pts[pts.length - 1][0]} ${mt + ih} Z`;
      root.appendChild(svg('path', { d, fill: color, class: 'series-area' }));
    }
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
    root.appendChild(svg('path', { d: line, class: 'series-line', stroke: color }));

    // last point
    if (pts.length) {
      const p = pts[pts.length - 1];
      root.appendChild(svg('circle', { cx: p[0], cy: p[1], r: 3.2, fill: color, class: 'point' }));
    }

    // x labels
    const idxs = rows.length <= 2 ? [0, rows.length - 1] : [0, Math.floor((rows.length - 1) / 2), rows.length - 1];
    idxs.forEach((i, k) => {
      if (!rows[i]) return;
      const t = svg('text', { x: xAt(i), y: H - 4, class: 'axis-label',
        'text-anchor': k === 0 ? 'start' : k === idxs.length - 1 ? 'end' : 'middle' });
      t.textContent = state.range === 'all' ? weekLabel(rows[i].bucket) : dayLabel(rows[i].bucket);
      root.appendChild(t);
    });

    // hover
    const hover = svg('line', { y1: mt, y2: mt + ih, class: 'hover-line' });
    root.appendChild(hover);
    const hit = svg('rect', { x: ml, y: mt, width: iw, height: ih, fill: 'transparent' });
    root.appendChild(hit);

    host.appendChild(root);
    const readout = el('div', 'readout');
    host.style.position = 'relative';
    host.appendChild(readout);

    const move = (ev) => {
      const rect = root.getBoundingClientRect();
      const rel = ((ev.clientX - rect.left) / rect.width) * W;
      const i = Math.max(0, Math.min(rows.length - 1,
        Math.round(((rel - ml) / iw) * (rows.length - 1))));
      const x = xAt(i);
      hover.setAttribute('x1', x); hover.setAttribute('x2', x);
      hover.classList.add('on');
      const r = rows[i];
      readout.innerHTML = `<span class="rl">${state.range === 'all' ? weekLabel(r.bucket) : dayLabel(r.bucket)}</span><br>${fmt(Number(r[key]) || 0)}`;
      const box = root.getBoundingClientRect();
      readout.style.left = ((x / W) * box.width) + 'px';
      readout.style.top = ((yAt(Number(r[key]) || 0) / H) * box.height) + 'px';
      readout.classList.add('on');
    };
    const leave = () => { hover.classList.remove('on'); readout.classList.remove('on'); };
    hit.addEventListener('mousemove', move);
    hit.addEventListener('mouseleave', leave);
    hit.addEventListener('touchmove', (e) => { if (e.touches[0]) move(e.touches[0]); }, { passive: true });
    hit.addEventListener('touchend', leave);
  }

  function titleRow(host, title, value) {
    const h = el('div', 'chart-title');
    h.appendChild(el('span', 't', title));
    if (value != null) h.appendChild(el('span', 'v', value));
    host.appendChild(h);
  }

  function barChart(host, opts) {
    if (opts.horizontal) return barChartH(host, opts);
    // vertical bars; items: [{label, value, cls, title}]
    const { items, height = 150, fmt = compact, colorDefault = '#D9A097', highlight = -1 } = opts;
    clear(host);
    const W = 520, H = height, ml = 34, mr = 6, mt = 14, mb = 24;
    const iw = W - ml - mr, ih = H - mt - mb;
    const max = Math.max(1, ...items.map((i) => i.value));
    const bw = iw / items.length;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', 'aria-label': opts.label || '' });
    [0, 0.5, 1].forEach((f) => {
      const y = mt + ih - f * ih;
      root.appendChild(svg('line', { x1: ml, x2: W - mr, y1: y, y2: y, class: 'grid-line', 'stroke-opacity': f === 0 ? 0.9 : 0.45 }));
      const t = svg('text', { x: ml - 6, y: y + 3, 'text-anchor': 'end', class: 'axis-label' });
      t.textContent = fmt(max * f);
      root.appendChild(t);
    });
    items.forEach((it, i) => {
      const h = Math.max(it.value > 0 ? 1.5 : 0, (it.value / max) * ih);
      const x = ml + i * bw + bw * 0.16;
      const b = svg('rect', { x, y: mt + ih - h, width: bw * 0.68, height: h,
        class: 'bar' + (i === highlight ? ' mag' : ''), rx: 2,
        fill: i === highlight ? '#E74079' : colorDefault });
      b.appendChild(svg('title')).textContent = `${it.title || it.label}: ${fmt(it.value)}`;
      root.appendChild(b);
      const t = svg('text', { x: ml + i * bw + bw / 2, y: H - 7, class: 'bar-axis', 'text-anchor': 'middle' });
      t.textContent = it.label;
      root.appendChild(t);
    });
    host.appendChild(root);
  }

  function barChartH(host, opts) {
    // horizontal bars, for narrow screens where category labels would collide
    const { items, fmt = compact, colorDefault = '#D9A097', highlight = -1, labelWidth = 92 } = opts;
    clear(host);
    const W = 520, rowH = 26, H = items.length * rowH + 6;
    const max = Math.max(1, ...items.map((i) => i.value));
    const barW = W - labelWidth - 58;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', 'aria-label': opts.label || '' });
    items.forEach((it, i) => {
      const y = i * rowH + 4;
      const t = svg('text', { x: 0, y: y + 13, class: 'bar-axis' });
      t.textContent = it.label;
      root.appendChild(t);
      const w = Math.max(it.value > 0 ? 2 : 0, (it.value / max) * barW);
      const r = svg('rect', { x: labelWidth, y: y + 2, width: w, height: 14, rx: 3,
        fill: i === highlight ? '#E74079' : colorDefault, opacity: i === highlight ? 1 : 0.85 });
      r.appendChild(svg('title')).textContent = `${it.title || it.label}: ${fmt(it.value)}`;
      root.appendChild(r);
      const v = svg('text', { x: W, y: y + 13, 'text-anchor': 'end', class: 'bar-axis' });
      v.textContent = fmt(it.value);
      root.appendChild(v);
    });
    host.appendChild(root);
  }

  function groupedBars(host, opts) {
    // rows: [{label, a, b}] — two values per row, plus ratio text
    const { rows, labels = ['', ''], colors = ['#D9A097', '#E74079'], height = 170, fmt = money } = opts;
    clear(host);
    const W = 560, H = height, ml = 44, mr = 8, mt = 16, mb = 26;
    const iw = W - ml - mr, ih = H - mt - mb;
    const max = Math.max(1, ...rows.flatMap((r) => [r.a, r.b]));
    const bw = iw / rows.length;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', 'aria-label': opts.label || '' });
    [0, 0.5, 1].forEach((f) => {
      const y = mt + ih - f * ih;
      root.appendChild(svg('line', { x1: ml, x2: W - mr, y1: y, y2: y, class: 'grid-line', 'stroke-opacity': f === 0 ? 0.9 : 0.45 }));
      const t = svg('text', { x: ml - 6, y: y + 3, 'text-anchor': 'end', class: 'axis-label' });
      t.textContent = fmt(max * f);
      root.appendChild(t);
    });
    rows.forEach((r, i) => {
      const x0 = ml + i * bw + bw * 0.14;
      const w = bw * 0.3;
      [[r.a, colors[0], labels[0]], [r.b, colors[1], labels[1]]].forEach(([v, c, lab], k) => {
        const h = Math.max(v > 0 ? 1.2 : 0, (v / max) * ih);
        const rect = svg('rect', { x: x0 + k * (w + 2), y: mt + ih - h, width: w, height: h, fill: c, rx: 2, class: 'bar' });
        rect.appendChild(svg('title')).textContent = `${lab} · ${r.label}: ${money(v)}`;
        root.appendChild(rect);
      });
      const t = svg('text', { x: ml + i * bw + bw / 2, y: H - 8, class: 'bar-axis', 'text-anchor': 'middle' });
      t.textContent = r.label;
      root.appendChild(t);
    });
    host.appendChild(root);
  }

  /* ─────────────────────────── renderers ─────────────────────────── */

  function renderAsOf() {
    const t = $('#asof');
    t.textContent = utcStamp(D.dataAsOf);
    t.setAttribute('datetime', D.dataAsOf);
  }

  function renderTiles() {
    const host = clear($('#tiles'));
    const rows = series();
    const dv = derived();
    const st = D.chains['4217'].stats;
    const posted = sum(rows, 'rewardVolume') / MICRO;
    const paid = sum(rows, 'paidVolume') / MICRO;
    const tasks = sum(rows, 'tasksCreated');
    const rangeName = { '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days', 'all': 'all time' }[state.range];

    const tiles = [
      {
        label: 'Tasks posted', value: num(tasks), lead: true,
        foot: [rangeName, deltaFoot('tasksCreated')],
      },
      {
        label: 'Rewards put up', value: money(posted),
        foot: [rangeName, deltaFoot('rewardVolume')],
      },
      {
        label: 'Rewards paid', value: money(paid),
        foot: [rangeName, `${num(sum(rows, 'settlements'))} settlements`],
      },
      {
        label: 'Active agents · 7d', value: num(st.activeAgents7d),
        foot: ['platform-wide', `${num(st.registeredWorkers)} registered`],
      },
      {
        label: 'Open tasks now', value: num(st.openTasks),
        foot: ['platform-wide', `${num(st.paidWorkers)} workers paid`],
      },
      {
        label: 'Distinct posters', value: num(dv.concentration.posters),
        lead: true,
        foot: [state.chain === 'both' ? 'both chains' : (state.chain === '4217' ? 'Tempo' : 'Base'),
          `${num(dv.tasksAnalysed)} tasks`],
      },
    ];

    for (const t of tiles) {
      const card = el('div', 'tile' + (t.lead ? ' lead' : ''));
      card.appendChild(el('div', 'tile-label', t.label));
      card.appendChild(el('div', 'tile-value', t.value));
      const foot = el('div', 'tile-foot');
      (t.foot || []).forEach((f, i) => {
        if (f == null) return;
        if (typeof f === 'object') {
          const span = el('span', f.change >= 0 ? 'up' : 'down');
          span.textContent = (f.change >= 0 ? '▲ ' : '▼ ') + Math.abs(f.change).toFixed(1) + '% w/w';
          foot.appendChild(span);
        } else {
          if (i) foot.appendChild(el('span', 'tag', String(f)));
          else foot.appendChild(el('span', '', String(f)));
        }
      });
      card.appendChild(foot);
      host.appendChild(card);
    }
  }

  function deltaFoot(key) {
    const d = wowDelta(key);
    if (!d) return null;
    return { change: d.change };
  }

  function renderActivity() {
    const host = clear($('#activity-charts'));
    const rows = series();
    const defs = [
      ['activeAgents', 'Active agents per day', '#EFE9E2'],
      ['tasksCreated', 'Tasks posted per day', '#D9A097'],
      ['rewardVolume', 'Rewards put up per day', '#E74079'],
      ['paidVolume', 'Rewards paid per day', '#B0A79D'],
    ];
    const lastRow = rows[rows.length - 1] || {};
    for (const [key, title, color] of defs) {
      const box = el('div', 'chart-box');
      const isMoney = key === 'rewardVolume' || key === 'paidVolume';
      const val = key === 'activeAgents'
        ? 'latest ' + num(lastRow.activeAgents || 0)
        : (isMoney ? money(sum(rows, key) / MICRO) : num(sum(rows, key)));
      titleRow(box, title, val);
      const chart = el('div');
      const fmt = isMoney ? (v) => money(v / MICRO) : compact;
      lineChart(chart, { rows, key, color, fmt, height: 124, label: title });
      box.appendChild(chart);
      host.appendChild(box);
    }
    const sub = $('#activity-sub');
    sub.textContent = state.range === 'all'
      ? 'Weekly buckets, all time — the API’s own platform time series.'
      : `Daily buckets, ${({ '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days' })[state.range] || state.range}. Platform-wide.`;
    const rowsAll = series('90d');
    const last = rows[rows.length - 1] || {};
    const note = $('#activity-note');
    note.innerHTML = `Bucket totals above are the sum of every bucket the API returned for this range
      (${num(rows.length)} buckets). These four series are platform-wide: <code>platform-time-series</code>
      answers with the same numbers for <code>chainId=4217</code> and <code>chainId=8453</code>, so they are
      shown once rather than added together. Latest day: <strong>${num(last.activeAgents)}</strong> active agents,
      <strong>${num(last.tasksCreated)}</strong> tasks posted, <strong>${money((+last.rewardVolume || 0) / MICRO)}</strong> put up
      and <strong>${money((+last.paidVolume || 0) / MICRO)}</strong> paid.`;
    void rowsAll;
  }

  /* ── flow ── */
  function renderFlow() {
    const dv = derived();
    const f = dv.flow;
    const host = clear($('#flow-river'));
    const total = Math.max(1, f.posted.value);
    const parts = [
      { key: 'paid', label: 'Paid to winners', value: f.paid.value, tasks: f.paid.tasks, color: '#E74079' },
      { key: 'locked', label: 'Locked in escrow', value: f.locked.value, tasks: f.locked.tasks, color: '#EFE9E2' },
      { key: 'returned', label: 'Returned', value: f.returned.value, tasks: f.returned.tasks, color: '#B0A79D' },
    ];

    const W = 720, H = 250;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
      'aria-label': 'Rewards posted, split by paid, locked and returned' });
    const lx = 8, lw = 150, rx = 470, rw = 242;
    const gap = 14;
    const usable = H - gap * (parts.length - 1) - 10;
    const heightFor = (v) => Math.max(6, (v / total) * usable);

    // source block
    const srcH = H - 10;
    root.appendChild(svg('rect', { x: lx, y: 5, width: lw, height: srcH, rx: 8, fill: '#2C2621', stroke: '#453E37' }));
    const s1 = svg('text', { x: lx + 14, y: 34, class: 'axis-label', fill: '#B0A79D' });
    s1.textContent = 'REWARDS POSTED';
    root.appendChild(s1);
    const s2 = svg('text', { x: lx + 14, y: 66, class: 'river-big' });
    s2.textContent = money(total / MICRO);
    root.appendChild(s2);
    const s3 = svg('text', { x: lx + 14, y: 88, class: 'axis-label' });
    s3.textContent = `${num(f.posted.tasks)} tasks`;
    root.appendChild(s3);
    const s4 = svg('text', { x: lx + 14, y: 112, class: 'axis-label' });
    s4.textContent = state.chain === 'both' ? 'both chains' : (state.chain === '4217' ? 'Tempo' : 'Base');
    root.appendChild(s4);

    let y = 5;
    for (const p of parts) {
      const h = heightFor(p.value);
      const top = y;
      const path = svg('path', {
        d: `M ${lx + lw} ${top} C ${lx + lw + 90} ${top}, ${rx - 90} ${top}, ${rx} ${top}
            L ${rx} ${top + h} C ${rx - 90} ${top + h}, ${lx + lw + 90} ${top + h}, ${lx + lw} ${top + h} Z`,
        fill: p.color, opacity: p.key === 'paid' ? 0.42 : 0.13,
      });
      path.appendChild(svg('title')).textContent = `${p.label}: ${money(p.value / MICRO)} (${pct(p.value / total * 100)})`;
      root.appendChild(path);
      root.appendChild(svg('rect', { x: rx, y: top, width: rw, height: h, rx: 6, fill: p.color,
        opacity: p.key === 'paid' ? 0.92 : 0.16, stroke: p.color, 'stroke-opacity': 0.5 }));
      const mid = top + h / 2;
      const lbl = svg('text', { x: rx + 14, y: mid + 4, fill: p.key === 'paid' ? '#12100E' : '#EFE9E2',
        class: 'river-label' });
      lbl.textContent = p.label;
      root.appendChild(lbl);
      const val = svg('text', { x: rx + rw - 14, y: mid + 4, 'text-anchor': 'end',
        fill: p.key === 'paid' ? '#12100E' : '#FFF6E8', class: 'river-value' });
      val.textContent = money(p.value / MICRO);
      root.appendChild(val);
      if (h > 62) {
        const sub = svg('text', { x: rx + rw - 14, y: mid + 22, 'text-anchor': 'end',
          fill: p.key === 'paid' ? '#3A1420' : '#B0A79D', class: 'river-sub' });
        sub.textContent = `${pct(p.value / total * 100)} · ${num(p.tasks)} tasks`;
        root.appendChild(sub);
      }
      y += h + gap;
    }
    host.appendChild(root);
    if (isNarrow()) {
      host.style.display = 'none';
      const old = host.parentNode.querySelector('.flow-html');
      if (old) old.remove();
      host.parentNode.insertBefore(riverHtml(parts, total, f), host.nextSibling);
    } else {
      host.style.display = '';
      const old = host.parentNode.querySelector('.flow-html');
      if (old) old.remove();
    }

    const legend = el('div', 'flow-legend');
    parts.forEach((p) => {
      const k = el('div', 'flow-key');
      const sw = el('span', 'swatch'); sw.style.background = p.color;
      k.appendChild(sw);
      k.appendChild(el('span', '', `${p.label} — ${money(p.value / MICRO)}`));
      legend.appendChild(k);
    });
    host.appendChild(legend);

    // status + mode breakdown (authoritative API breakdowns)
    const bd = D.chains['4217'].breakdowns;
    const STAT_LABEL = { open: 'open', completed: 'completed', cancelled: 'cancelled', expired: 'expired',
      claimed: 'claimed', pending_approval: 'pending', worker_selected: 'selected' };
    const statHost = clear($('#flow-status'));
    titleRow(statHost, 'Tasks by status · all time', shared('breakdowns') ? 'platform-wide' : '');
    barChart(statHost, {
      items: bd.status.map((s) => ({ label: STAT_LABEL[s.status] || s.status.slice(0, 9), value: s.count,
        title: s.status })),
      fmt: compact, height: 155, horizontal: isNarrow(),
      highlight: bd.status.reduce((best, s, i, arr) => s.count > arr[best].count ? i : best, 0),
    });
    const modeHost = el('div');
    statHost.appendChild(modeHost);
    titleRow(statHost, 'Tasks by mode · all time', '');
    barChart(modeHost, {
      items: bd.mode.map((m) => ({ label: m.mode, value: m.count, title: m.mode })),
      fmt: compact, height: 130, horizontal: isNarrow(),
      highlight: bd.mode.reduce((best, m, i, arr) => m.count > arr[best].count ? i : best, 0),
    });

    // weekly posted vs paid
    const vel = clear($('#flow-velocity'));
    titleRow(vel, 'Posted vs paid, by week', '');
    const weeklyRows = (D.chains['4217'].series['all'] || []).slice(-8);
    groupedBars(vel, {
      rows: weeklyRows.map((r) => ({ label: weekLabel(r.bucket), a: +r.rewardVolume / MICRO, b: +r.paidVolume / MICRO })),
      labels: ['put up', 'paid out'], height: 168,
    });
    const lg = el('div', 'flow-legend');
    [['#D9A097', 'Rewards put up'], ['#E74079', 'Rewards paid out']].forEach(([c, t]) => {
      const k = el('div', 'flow-key');
      const sw = el('span', 'swatch'); sw.style.background = c; k.appendChild(sw); k.appendChild(el('span', '', t));
      lg.appendChild(k);
    });
    vel.appendChild(lg);

    renderCohorts(dv);
    const note = $('#flow-note');
    note.innerHTML = `Escrow split from every task the task list returned at build time —
      <strong>${num(dv.tasksAnalysed)}</strong> tasks, <strong>${money(f.posted.value / MICRO)}</strong> posted.
      <strong>${pct(f.paidShare)}</strong> has been released to a winner, <strong>${pct(f.lockedShare)}</strong>
      (${money(f.locked.value / MICRO)} across ${num(f.locked.tasks)} tasks) is still held, and
      <strong>${pct(f.returnedShare)}</strong> went back when a task expired or was cancelled.
      The status and mode bars above come from <code>/api/stats/breakdowns</code> and are all-time: they count
      more tasks (${num(bd.status.reduce((a, s) => a + s.count, 0))}) than the task list exposes.`;
  }


  /* Cohort survival: what eventually happened to the tasks posted in each week. */
  function renderCohorts(dv) {
    const host = clear($('#flow-cohorts'));
    const rows = (dv.cohorts || []).slice(-8);
    if (!rows.length) return;
    titleRow(host, 'What happened to the tasks posted in each week', 'share of that week');
    const W = 640, rowH = 30, padL = 6, padR = 56, H = rows.length * rowH + 10;
    const barW = W - padL - padR - 74;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
      'aria-label': 'Outcome of tasks by the week they were posted' });
    const segs = [
      ['completed', '#E74079', 'completed'],
      ['open', '#EFE9E2', 'still open'],
      ['expired', '#6B5F55', 'expired'],
      ['cancelled', '#453E37', 'cancelled'],
    ];
    rows.forEach((r, i) => {
      const y = i * rowH + 6;
      const t = svg('text', { x: padL, y: y + 12, class: 'bar-axis' });
      t.textContent = weekLabel(r.week);
      root.appendChild(t);
      let x = padL + 74;
      const scale = barW / Math.max(1, r.tasks);
      segs.forEach(([key, color, label]) => {
        const v = r[key] || 0;
        if (!v) return;
        const w = Math.max(1, v * scale);
        const rect = svg('rect', { x, y: y + 2, width: w, height: 13, fill: color,
          opacity: key === 'completed' ? 0.95 : 0.9, rx: 2 });
        rect.appendChild(svg('title')).textContent = `${label}: ${v} of ${r.tasks} tasks`;
        root.appendChild(rect);
        x += w;
      });
      const p = svg('text', { x: W - 4, y: y + 13, 'text-anchor': 'end', class: 'bar-axis' });
      p.textContent = `${num(r.tasks)} · ${pct(r.completionRate)}`;
      root.appendChild(p);
    });
    host.appendChild(root);
    const lg = el('div', 'flow-legend');
    segs.forEach(([key, color, label]) => {
      const k = el('div', 'flow-key');
      const sw = el('span', 'swatch');
      sw.style.background = color;
      k.appendChild(sw);
      k.appendChild(el('span', '', label));
      lg.appendChild(k);
    });
    host.appendChild(lg);
    const first = rows[0];
    const last = rows[rows.length - 1];
    host.appendChild(el('p', 'note',
      `Each bar is every task posted in that ISO week, split by the status it holds today; the right column is the ` +
      `task count and the share already completed. Oldest week here: ${pct(first.completionRate)} completed. ` +
      `Newest (still filling): ${pct(last.completionRate)}. Weeks that never complete show up as expired or ` +
      `cancelled rather than as paid work.`));
  }

  /* ── posters ── */
  function renderPosters() {
    const dv = derived();
    const c = dv.concentration;
    const lz = clear($('#poster-lorenz'));
    titleRow(lz, 'Who posts the tasks', `Gini ${c.giniTasks}`);
    const W = 480, H = 240, ml = 38, mr = 12, mt = 12, mb = 26;
    const iw = W - ml - mr, ih = H - mt - mb;
    const counts = c.taskCounts && c.taskCounts.length ? c.taskCounts : [];
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img',
      'aria-label': 'Cumulative share of tasks by poster rank' });
    root.appendChild(svg('line', { x1: ml, y1: mt + ih, x2: W - mr, y2: mt, stroke: '#453E37', 'stroke-dasharray': '3 4' }));
    let cum = 0;
    const pts = [[ml, mt + ih]];
    counts.forEach((n, i) => {
      cum += n;
      const x = ml + ((i + 1) / counts.length) * iw;
      const y = mt + ih - (cum / total) * ih;
      pts.push([x, y]);
    });
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    root.appendChild(svg('path', { d: d + ` L ${W - mr} ${mt + ih} Z`, fill: '#E74079', opacity: 0.13 }));
    root.appendChild(svg('path', { d, fill: 'none', stroke: '#E74079', 'stroke-width': 1.8 }));
    // top-5 marker
    if (counts.length > 5) {
      cum = counts.slice(0, 5).reduce((a, b) => a + b, 0);
      const x = ml + (5 / counts.length) * iw;
      const y = mt + ih - (cum / total) * ih;
      root.appendChild(svg('circle', { cx: x, cy: y, r: 4, fill: '#FFF6E8' }));
      const t = svg('text', { x: x + 8, y: y - 6, class: 'axis-label', fill: '#FFF6E8' });
      t.textContent = `top 5 = ${pct(c.top5ShareTasks)}`;
      root.appendChild(t);
    }
    [0, 0.5, 1].forEach((fr) => {
      const y = mt + ih - fr * ih;
      root.appendChild(svg('line', { x1: ml, x2: W - mr, y1: y, y2: y, class: 'grid-line', 'stroke-opacity': 0.45 }));
      const t = svg('text', { x: ml - 6, y: y + 3, 'text-anchor': 'end', class: 'axis-label' });
      t.textContent = Math.round(fr * 100) + '%';
      root.appendChild(t);
    });
    [[0, 'first'], [0.5, 'half the wallets'], [1, 'all wallets']].forEach(([fr, label], i) => {
      const t = svg('text', { x: ml + fr * iw, y: H - 6, class: 'axis-label',
        'text-anchor': i === 0 ? 'start' : i === 2 ? 'end' : 'middle' });
      t.textContent = label;
      root.appendChild(t);
    });
    lz.appendChild(root);

    const board = clear($('#poster-board'));
    titleRow(board, 'Top posters by tasks', 'no names');
    const rows = el('div', 'board');
    const maxTasks = c.leaderboard.length ? c.leaderboard[0].tasks : 1;
    c.leaderboard.slice(0, 8).forEach((p, i) => {
      const r = el('div', 'board-row');
      r.appendChild(el('span', 'board-rank', String(i + 1).padStart(2, '0')));
      const mid = el('div');
      const top = el('div', 'board-addr');
      top.appendChild(el('span', '', addr(p.address)));
      const bar = el('span', 'board-bar');
      bar.style.width = Math.max(4, (p.tasks / maxTasks) * 72) + 'px';
      top.appendChild(bar);
      mid.appendChild(top);
      r.appendChild(mid);
      r.appendChild(el('span', 'board-val', `${num(p.tasks)} tasks · ${money(p.reward / MICRO)}`));
      rows.appendChild(r);
    });
    board.appendChild(rows);

    const note = $('#poster-note');
    note.innerHTML = `<strong>${num(c.top5ShareTasks)}%</strong> of the ${num(c.tasks)} tasks in this view were posted by
      five wallets, and <strong>${num(c.oneTaskShare)}%</strong> of the ${num(c.posters)} posters put up exactly one task.
      The top five hold <strong>${pct(c.top5ShareReward)}</strong> of the reward value —
      posting is top-heavy, money is less so. Gini ${c.giniTasks} over tasks per wallet.`;

    // weekly posters
    const wk = clear($('#poster-weekly'));
    titleRow(wk, 'Distinct task posters per week', 'Mon 00:00 UTC');
    const weeks = state.chain === 'both' ? D.combined.weeklyPosters
      : D.chains[state.chain].derived.weeklyPosters.map((w) => ({ week: w.week, tempo: state.chain === '4217' ? w.posters : 0, base: state.chain === '8453' ? w.posters : 0, unique: w.posters, tasks: w.tasks }));
    const lastWeeks = weeks.slice(-10);
    const host = el('div');
    wk.appendChild(host);
    const W2 = 620, H2 = 170, ml2 = 34, mr2 = 8, mt2 = 14, mb2 = 26;
    const iw2 = W2 - ml2 - mr2, ih2 = H2 - mt2 - mb2;
    const max2 = Math.max(1, ...lastWeeks.map((w) => Math.max(w.unique, w.tempo + w.base)));
    const bw2 = iw2 / Math.max(1, lastWeeks.length);
    const root2 = svg('svg', { viewBox: `0 0 ${W2} ${H2}`, class: 'chart', role: 'img',
      'aria-label': 'Distinct posters per ISO week' });
    [0, 0.5, 1].forEach((fr) => {
      const y = mt2 + ih2 - fr * ih2;
      root2.appendChild(svg('line', { x1: ml2, x2: W2 - mr2, y1: y, y2: y, class: 'grid-line', 'stroke-opacity': fr === 0 ? 0.9 : 0.45 }));
      const t = svg('text', { x: ml2 - 6, y: y + 3, 'text-anchor': 'end', class: 'axis-label' });
      t.textContent = compact(max2 * fr);
      root2.appendChild(t);
    });
    lastWeeks.forEach((w, i) => {
      const x = ml2 + i * bw2 + bw2 * 0.18;
      const wW = bw2 * 0.64;
      const unionH = Math.max(w.unique > 0 ? 1.5 : 0, (w.unique / max2) * ih2);
      const rect = svg('rect', { x, y: mt2 + ih2 - unionH, width: wW, height: unionH, rx: 2,
        fill: '#E74079', opacity: 0.85, class: 'bar' });
      rect.appendChild(svg('title')).textContent =
        `Week of ${w.week}: ${w.unique} distinct posters (Tempo ${w.tempo}, Base ${w.base}), ${w.tasks} tasks`;
      root2.appendChild(rect);
      const t = svg('text', { x: ml2 + i * bw2 + bw2 / 2, y: H2 - 8, class: 'bar-axis', 'text-anchor': 'middle' });
      t.textContent = weekLabel(w.week);
      root2.appendChild(t);
      const v = svg('text', { x: ml2 + i * bw2 + bw2 / 2, y: mt2 + ih2 - unionH - 5, class: 'bar-label',
        'text-anchor': 'middle', fill: '#B0A79D' });
      v.textContent = String(w.unique);
      root2.appendChild(v);
    });
    wk.appendChild(root2);
    const last = lastWeeks[lastWeeks.length - 1];
    const prev = lastWeeks[lastWeeks.length - 2];
    $('#poster-week-note').innerHTML = last
      ? `Computed from every task's <code>requester</code> and <code>createdAt</code>: a wallet counts once per week
         however many tasks it posts. This week so far: <strong>${num(last.unique)}</strong> posters;
         last week: <strong>${num(prev ? prev.unique : 0)}</strong>. The task list only exposes recent tasks,
         so the window starts at ${D.combined.window ? utcStamp(D.combined.window.from).replace(' UTC', '') : 'the oldest task returned'}.`
      : '';
  }

  /* ── swarm ── */
  function renderSwarm() {
    const dv = derived();
    const s = dv.swarm;
    const hist = clear($('#swarm-hist'));
    titleRow(hist, 'Entries per task', `mean ${s.meanPerLiveTask}`);
    const items = s.histogram.map((h) => ({ label: h.entries, value: h.tasks, title: `${h.entries} entries` }));
    barChart(hist, { items, height: 160, fmt: compact, highlight: items.length - 1, horizontal: isNarrow() });

    const hot = clear($('#swarm-hot'));
    titleRow(hot, 'Most contested open tasks', 'entries');
    const rows = el('div', 'board');
    const maxSub = s.hottest.length ? Math.max(...s.hottest.map((t) => t.submissions)) : 1;
    s.hottest.slice(0, 6).forEach((t) => {
      const r = el('div', 'board-row');
      r.appendChild(el('span', 'board-rank', '●'));
      const mid = el('div');
      const top = el('div', 'board-addr');
      top.appendChild(el('span', '', t.ref || '—'));
      const bar = el('span', 'board-bar');
      bar.style.width = Math.max(4, (t.submissions / maxSub) * 64) + 'px';
      top.appendChild(bar);
      mid.appendChild(top);
      r.appendChild(mid);
      r.appendChild(el('span', 'board-val', `${num(t.submissions)} · ${money(t.reward / MICRO)}`));
      rows.appendChild(r);
    });
    hot.appendChild(rows);

    const note = $('#swarm-note');
    const ten = s.histogram[s.histogram.length - 1].tasks;
    note.innerHTML = `<strong>${num(ten)}</strong> of ${num(dv.tasksAnalysed)} tasks drew ten or more entries.
      On the ${num(s.liveTasks)} tasks still live there are <strong>${num(s.liveSubmissions)}</strong> entries —
      a mean of <strong>${s.meanPerLiveTask}</strong> and a median of <strong>${s.medianPerLiveTask}</strong> per task.
      <strong>${pct(s.contestedShare)}</strong> of live tasks already have three or more competitors.
      Entries are <code>submissionCount</code> from the task list; the busiest single task has
      <strong>${num(maxSub)}</strong>.`;
  }

  /* ── heatmap ── */
  function renderHeat() {
    const host = clear($('#heatmap'));
    const key = state.heat;
    const hm = D.chains['4217'].heatmap[key];
    const isHour = key.startsWith('hour');
    const title = $('#heat-title');
    clear(title);
    title.appendChild(el('div', 'sub', isHour
      ? 'Every activity event by weekday and hour (UTC), from the API’s hourOfWeek heatmap.'
      : 'Tasks by mode and day (UTC), from the API’s mode heatmap.'));

    const rows = hm.rowKeys, cols = hm.colKeys;
    const cellMap = new Map();
    let max = 0;
    for (const c of hm.cells) { cellMap.set(c.row + '|' + c.col, c); max = Math.max(max, c.count); }
    const rowLabels = isHour ? rows.map((r) => DAYS[Number(r) % 7]) : rows;
    const colLabels = isHour ? cols.map((c) => String(c)) : cols.map(dayLabel);

    const cw = isHour ? 30 : 22, ch = isHour ? 30 : 32;
    const padL = isHour ? 40 : 82, padT = 16;
    const W = padL + cols.length * cw + 4, H = padT + rows.length * ch + 4;
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart', role: 'img',
      'aria-label': 'Activity heatmap' });
    cols.forEach((c, i) => {
      if (!isHour && i % 3 !== 0) return;
      const t = svg('text', { x: padL + i * cw + cw / 2, y: 11, class: 'heat-rowlabel', 'text-anchor': 'middle' });
      t.textContent = colLabels[i];
      root.appendChild(t);
    });
    rows.forEach((r, ri) => {
      const t = svg('text', { x: padL - 6, y: padT + ri * ch + ch / 2 + 3, class: 'heat-rowlabel', 'text-anchor': 'end' });
      t.textContent = rowLabels[ri];
      root.appendChild(t);
      cols.forEach((c, ci) => {
        const cell = cellMap.get(r + '|' + c);
        const v = cell ? cell.count : 0;
        const f = max ? Math.pow(v / max, 0.72) : 0;
        const fill = v === 0 ? '#1B1714' : mix('#2A211C', '#E74079', f);
        const rect = svg('rect', { x: padL + ci * cw, y: padT + ri * ch, width: cw - 2, height: ch - 2,
          rx: 3, fill, class: 'heat-cell' });
        rect.appendChild(svg('title')).textContent =
          `${rowLabels[ri]}${isHour ? ' ' + c + ':00 UTC' : ' · ' + c}: ${num(v)} events`;
        root.appendChild(rect);
      });
    });
    host.appendChild(root);

    const lg = el('div', 'heat-legend');
    lg.appendChild(el('span', '', '0'));
    const bar = el('span');
    bar.style.cssText = 'display:inline-block;width:110px;height:8px;border-radius:4px;background:linear-gradient(90deg,#1B1714,#3A1420,#E74079)';
    lg.appendChild(bar);
    lg.appendChild(el('span', '', num(max) + ' events'));
    host.appendChild(lg);

    const note = $('#heat-note');
    let peak = null;
    for (const c of hm.cells) if (!peak || c.count > peak.count) peak = c;
    const peakLabel = peak
      ? `${isHour ? DAYS[Number(peak.row) % 7] + ' ' + peak.col + ':00' : peak.row + ' · ' + dayLabel(peak.col)} UTC`
      : '—';
    note.innerHTML = `Counts are the API's own activity counts for the selected dimension and range
      (${key === 'mode30d' ? '30 days' : key === 'hour90d' ? '90 days' : '30 days'}); the heatmap is identical for both chainIds.
      Busiest cell: <strong>${peakLabel}</strong> with ${num(peak ? peak.count : 0)} events.
      ${isHour ? 'Rows are the API’s hour-of-week index 0–6 (0 = Sunday).' : ''}`;
  }

  function mix(a, b, t) {
    const pa = [1, 3, 5].map((i) => parseInt(a.substr(i, 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.substr(i, 2), 16));
    const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
    return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  /* On a phone the SVG river is too cramped; a stacked HTML version reads better. */
  function isNarrow() { return window.matchMedia('(max-width: 700px)').matches; }

  function riverHtml(parts, total, f) {
    const wrap = el('div', 'flow-html');
    const head = el('div', 'fh-head');
    head.appendChild(el('div', 'fh-eyebrow', 'Rewards posted'));
    head.appendChild(el('div', 'fh-total', money(total / MICRO)));
    head.appendChild(el('div', 'fh-meta',
      `${num(f.posted.tasks)} tasks · ${state.chain === 'both' ? 'both chains' : state.chain === '4217' ? 'Tempo' : 'Base'}`));
    wrap.appendChild(head);
    parts.forEach((p) => {
      const row = el('div', 'fh-row');
      const top = el('div', 'fh-top');
      const dot = el('span', 'fh-dot');
      dot.style.background = p.color;
      top.appendChild(dot);
      top.appendChild(el('span', 'fh-label', p.label));
      top.appendChild(el('span', 'fh-value', money(p.value / MICRO)));
      row.appendChild(top);
      const bar = el('div', 'fh-bar');
      const fill = el('span');
      fill.style.width = Math.max(2, (p.value / total) * 100) + '%';
      fill.style.background = p.color;
      bar.appendChild(fill);
      row.appendChild(bar);
      row.appendChild(el('div', 'fh-sub', `${pct(p.value / total * 100)} of posted value · ${num(p.tasks)} tasks`));
      wrap.appendChild(row);
    });
    return wrap;
  }

  /* ── feed ── */
  function feedItems() {
    const seen = new Set();
    const out = [];
    const extra = (D.extraFeeds ? (D.extraFeeds.mixed || []) : []);
    const baseFeed = shared('feed') ? D.chains['4217'].feed : chainObjs()[0].feed;
    for (const it of [...(baseFeed || []), ...extra]) {
      const k = [it.type, it.taskId, it.actor, it.timestamp].join('|');
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(it);
    }
    out.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    // Submissions swamp the raw feed (dozens a minute). Reserve slots for the other event
    // types so creations, claims and ratings stay visible, then keep time order.
    const others = out.filter((i) => i.type !== 'task_submitted');
    const subs = out.filter((i) => i.type === 'task_submitted');
    const reserved = Math.min(others.length, 12);
    const picked = [...others.slice(0, reserved), ...subs.slice(0, 40 - reserved)];
    picked.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return picked;
  }

  function renderFeed() {
    const host = clear($('#feed-list'));
    const items = feedItems();
    if (!items.length) { host.appendChild(el('li', 'empty', 'The feed returned no events.')); return; }
    for (const it of items) {
      const li = el('li');
      const badge = el('span', 'ev ' + (it.type || '').replace('task_', ''), (it.type || '').replace('task_', ''));
      li.appendChild(badge);
      li.appendChild(el('span', 'title', it.taskTitle || '(untitled task)'));
      const meta = el('span', 'meta');
      const bits = [it.chainId === 4217 ? 'Tempo' : 'Base'];
      if (it.actor) bits.push(addr(it.actor));
      if (it.amount) bits.push(money(Number(it.amount) / MICRO));
      bits.push(relTime(it.timestamp));
      meta.textContent = bits.join(' · ');
      li.appendChild(meta);
      host.appendChild(li);
    }
    $('#feed-note').innerHTML = `Latest ${items.length} events from <code>/api/stats/activity-feed</code>
      (newest 50, plus recent <code>task_created</code> and <code>task_rated</code> events), fetched at
      ${utcStamp(D.dataAsOf)}. Long runs of submissions are thinned so the other events stay visible.
      Actors are shown as short addresses only.`;
  }

  function renderChainStrip() {
    const host = document.getElementById('chain-split');
    if (!host) return;
    clear(host);
    if (state.chain !== 'both') { host.hidden = true; return; }
    host.hidden = false;
    const cs = ['4217', '8453'].map((id) => D.chains[id]);
    const posted = cs.map((c) => c.derived.flow.posted.value);
    const grand = posted[0] + posted[1] || 1;
    cs.forEach((c, i) => {
      const card = el('div', 'chain-card');
      const head = el('div', 'chain-head');
      head.appendChild(el('span', 'chain-name', c.name));
      head.appendChild(el('span', 'tag', 'chainId ' + c.chainId));
      head.appendChild(el('span', 'tag', c.currency));
      card.appendChild(head);
      const row = el('div', 'chain-row');
      row.appendChild(el('span', 'chain-value', money(posted[i] / MICRO)));
      row.appendChild(el('span', 'chain-meta',
        `${num(c.derived.tasksAnalysed)} tasks · ${num(c.derived.concentration.posters)} posters`));
      card.appendChild(row);
      const bar = el('div', 'chain-bar');
      const fill = el('span');
      fill.style.width = Math.max(2, (posted[i] / grand) * 100) + '%';
      fill.style.background = i === 0 ? '#E74079' : '#D9A097';
      bar.appendChild(fill);
      card.appendChild(bar);
      card.appendChild(el('div', 'chain-foot', `${pct(posted[i] / grand * 100)} of reward value in the task list`));
      host.appendChild(card);
    });
  }

  /* ── methods ── */
  function renderMethods() {
    const eps = clear($('#method-endpoints'));
    const list = [
      ['/api/market/stats?chainId=4217|8453', 'headline counters'],
      ['/api/stats/breakdowns?chainId=…', 'tasks by status, mode and actor type'],
      ['/api/stats/platform-time-series?chainId=…&range=7d|30d|90d&bucket=day', 'the four time series'],
      ['/api/stats/platform-time-series?chainId=…&range=all&bucket=week', 'weekly posting vs payout'],
      ['/api/stats/activity-heatmap?chainId=…&range=30d&dimension=mode', 'mode × day heatmap'],
      ['/api/stats/activity-heatmap?chainId=…&range=30d|90d&dimension=hourOfWeek', 'hour-of-week heatmap'],
      ['/api/stats/activity-feed?chainId=…&limit=50', 'live activity feed'],
      ['/api/tasks?chainId=…&sort=newest&limit=100&cursor=…', 'every task, walked to the last page'],
    ];
    for (const [ep, what] of list) {
      const li = el('li');
      const code = el('span', 'ep', ep);
      li.appendChild(code);
      li.appendChild(el('span', '', ' — ' + what));
      eps.appendChild(li);
    }

    const notes = clear($('#method-notes'));
    const c = D.combined;
    const rows = [
      `Fetched server-side by <code>scripts/fetch_data.py</code> in a scheduled GitHub Action, then published as one static JSON file. The API sends no CORS headers, so this is the only way a page on another origin can show it.`,
      `Units: rewards are micro-units — <code>reward / 1e6</code> tokens. Tempo pays OUSD, Base pays USDC; both are shown as whole tokens.`,
      `Posters: distinct <code>requester</code> addresses over every task the list endpoint returned (${num(c.window ? c.window.tasks : 0)} tasks across both chains at this build). No names, no identity inference.`,
      `Weeks: ISO weeks starting Monday 00:00 UTC, from each task's <code>createdAt</code>.`,
      `Escrow flow: task <code>reward</code> summed by <code>status</code> — completed = paid, open/claimed/worker_selected/pending_approval = still locked, cancelled/expired = returned.`,
      `Platform-wide sources: the API answers <code>platform-time-series</code>, <code>breakdowns</code>, <code>activity-heatmap</code> and <code>activity-feed</code> with the same data for both chainIds. They are shown once and never summed.`,
      `The task list is shorter than the all-time breakdown counts: it returns ${num(c.window ? c.window.tasks : 0)} tasks, the breakdowns count more. Poster, swarm and escrow figures are therefore over that window, and labelled as such.`,
      `Refreshed every 30 minutes; static files are cacheable, the page reads the published JSON as-is. Read-only: no wallet connection, no cookies, no analytics, no third-party requests.`,
    ];
    for (const n of rows) {
      const li = el('li');
      li.innerHTML = n;
      notes.appendChild(li);
    }

    const build = clear($('#build-info'));
    const facts = [
      ['Data as of', utcStamp(D.dataAsOf)],
      ['Built', utcStamp(D.generatedAt)],
      ['Refresh', 'every 30 min via GitHub Actions'],
      ['Tasks analysed', num(c.window ? c.window.tasks : 0)],
      ['Source', 'api.taskmarket.dev'],
      ['Licence', 'MIT'],
    ];
    facts.forEach(([k, v]) => {
      const b = el('div');
      b.appendChild(el('div', 'b-label', k));
      b.appendChild(el('div', 'b-value', v));
      build.appendChild(b);
    });
  }

  /* ── share ── */
  const VIEWS = {
    overview: { title: 'Where the money goes', blurb: 'Taskmarket’s escrow, paid out and locked, live.' },
    flow: { title: 'Money in, money out', blurb: 'Every escrowed reward, traced to paid, locked or returned.' },
    posters: { title: 'A few wallets post the work', blurb: 'Poster concentration and distinct posters per week.' },
    swarm: { title: 'The swarm converges', blurb: 'How many agents pile onto one Taskmarket task.' },
    rhythm: { title: 'When the market wakes', blurb: 'Taskmarket activity by hour of the week.' },
    feed: { title: 'Live activity', blurb: 'What is happening on Taskmarket right now.' },
    methods: { title: 'Methods', blurb: 'Endpoints, units and how every number is made.' },
  };

  function shareLink(view) {
    // The per-view page carries this view's own share card, then lands on the section.
    const url = new URL(SITE + 's/' + view + '.html');
    if (state.chain !== 'both') url.searchParams.set('chain', state.chain);
    if (state.range !== '30d') url.searchParams.set('range', state.range);
    return url.toString();
  }

  function bindShare() {
    document.querySelectorAll('[data-share]').forEach((host) => {
      const view = host.dataset.share;
      clear(host);
      const copy = el('button', 'pill', 'Copy link');
      copy.addEventListener('click', async () => {
        const url = shareLink(view);
        try {
          await navigator.clipboard.writeText(url);
          toast('Link copied');
        } catch {
          toast(url);
        }
      });
      const x = el('a', 'x');
      x.href = 'https://x.com/intent/post?text=' + encodeURIComponent(
        `${VIEWS[view].title} — Taskmarket, live.\n${shareLink(view)}`);
      x.target = '_blank'; x.rel = 'noopener';
      x.textContent = 'Post on X';
      x.style.cssText = 'border:1px solid var(--line);padding:6px 10px;border-radius:999px;font-size:12px;text-decoration:none';
      host.appendChild(copy);
      host.appendChild(x);
    });
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
  }

  function navHighlight() {
    const links = [...document.querySelectorAll('.nav a')];
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const id = e.target.id;
        links.forEach((a) => a.setAttribute('aria-current', String(a.dataset.view === id)));
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    document.querySelectorAll('main section[id]').forEach((s) => obs.observe(s));
  }

  /* ─────────────────────────── boot ─────────────────────────── */

  function renderAll() {
    renderTiles();
    renderChainStrip();
    renderActivity();
    renderFlow();
    renderPosters();
    renderSwarm();
    renderHeat();
    renderFeed();
    bindShare();
  }

  async function boot() {
    readStateFromUrl();
    try {
      const res = await fetch(DATA_URL, { cache: 'default' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      D = await res.json();
    } catch (err) {
      const host = $('#tiles');
      if (host) host.appendChild(el('div', 'empty',
        'The data file could not be loaded: ' + err.message + '. It is rebuilt every 30 minutes by GitHub Actions.'));
      return;
    }
    bindControls();
    syncControls();
    renderAsOf();
    renderMethods();
    renderAll();
    navHighlight();
    setInterval(() => { if (D) renderFeed(); }, 60000);
    let rt = null;
    let wasNarrow = isNarrow();
    addEventListener('resize', () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (isNarrow() !== wasNarrow) { wasNarrow = isNarrow(); renderAll(); }
      }, 250);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
