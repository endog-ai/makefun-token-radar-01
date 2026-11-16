/* MERIDIAN radar console. Reads window.RADAR (written beside dashboard/ by main.ts)
   and renders the ranked pre-token board, the set-aside live-token table, a per-row
   detail drawer with the model breakdown and farm plan, and a research note built
   from the data file's own model / backtest / counts fields. No network calls. */
(function () {
  'use strict';
  var DATA = window.RADAR;
  var app = document.getElementById('app');
  var drawer = document.getElementById('drawer');
  var mastMeta = document.getElementById('mast-meta');
  if (!DATA || !DATA.rows) {
    app.textContent = 'No radar data loaded. The page expects window.RADAR from data.js next to dashboard/.';
    if (mastMeta) mastMeta.textContent = 'NO DATA';
    return;
  }
  var MODEL = DATA.model || {};
  var COUNTS = DATA.counts || {};
  var BACK = DATA.backtest || {};
  var ROWS = DATA.rows.slice();
  var LIVE = (DATA.live || []).slice();
  var WATCH = {};
  (DATA.watchlist || []).forEach(function (s) { WATCH[s] = true; });
  ROWS.forEach(function (r) { if (r.watchlist) WATCH[r.slug] = true; });
  var state = { q: '', cat: 'all', chain: 'all', wl: false, sort: 'implied', tab: 'pre' };

  /* ---------- formatting ---------- */
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + n.toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function fmtDur(min) {
    if (min === null || min === undefined || !isFinite(min)) return 'n/a';
    if (min >= 1440) return Math.round(min / 1440) + 'd';
    if (min >= 60) return Math.floor(min / 60) + 'h ' + Math.round(min % 60) + 'm';
    return Math.round(min) + 'm';
  }
  function esc(s) { return String(s === null || s === undefined ? '' : s); }

  /* ---------- model: recompute one row from the row + model constants ---------- */
  function fits() {
    var c = MODEL.curves || MODEL;
    var by = c.byCategory || c.by_category || MODEL.byCategory || MODEL.by_category || {};
    var g = c.global || MODEL.global || null;
    return { by: by, global: g };
  }
  function fitFor(row) {
    var f = fits();
    var curve = row.curve || '';
    if (curve && f.by[curve]) return { fit: f.by[curve], name: curve };
    if (row.category && f.by[row.category]) return { fit: f.by[row.category], name: row.category };
    if (f.global) return { fit: f.global, name: 'global' };
    return { fit: null, name: curve || 'global' };
  }
  function num(x, fb) { return (typeof x === 'number' && isFinite(x)) ? x : fb; }
  function impliedOf(row) {
    var gw = num(MODEL.growth_weight, 0.5);
    var gf = num(MODEL.growth_floor, -60), gc = num(MODEL.growth_cap, 120);
    var mf = num(MODEL.maturity_floor, 0.6), mr = num(MODEL.maturity_range, 0.4);
    var md = num(MODEL.maturity_days, 1095), ua = num(MODEL.unknown_age_days, 365);
    var growth = Math.min(gc, Math.max(gf, num(row.change_7d, 0)));
    var growthMult = 1 + (growth / 100) * gw;
    var age = (row.age_days === null || row.age_days === undefined) ? ua : row.age_days;
    var maturity = mf + (Math.min(Math.max(age, 0), md) / md) * mr;
    var base, curveName;
    if (typeof row.base_value_usd === 'number' && row.base_value_usd > 0 && (row.curve || '').indexOf('ratio') >= 0) {
      base = row.base_value_usd; curveName = row.curve;
    } else {
      var got = fitFor(row); curveName = got.name;
      var fit = got.fit;
      if (fit && typeof fit.a === 'number' && typeof fit.b === 'number' && row.tvl_usd > 0) {
        base = Math.pow(10, fit.a + fit.b * Math.log10(row.tvl_usd));
        if ((row.curve || '').indexOf('ratio') >= 0) {
          var ratios = MODEL.median_ratios || MODEL.category_ratios || null;
          var r = ratios ? num(ratios[row.category], null) : null;
          if (r !== null) base = base * r;
          else if (typeof row.base_value_usd === 'number' && row.base_value_usd > 0) base = row.base_value_usd;
        }
      } else if (MODEL.base_multiple) {
        base = row.tvl_usd * MODEL.base_multiple; curveName = 'global x multiple';
      } else {
        base = row.implied_value_usd / Math.max(0.01, growthMult * maturity);
      }
    }
    var value = Math.max(1, Math.round(base * growthMult * maturity));
    return { value: value, base: Math.round(base), growthMult: growthMult, maturityMult: maturity, curve: curveName, age: age };
  }
  function median(nums) {
    if (!nums.length) return null;
    var s = nums.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /* ---------- DOM helpers ---------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function opt(value, label) {
    var o = document.createElement('option');
    o.value = value; o.textContent = label;
    return o;
  }

  /* ---------- filtering / sorting ---------- */
  function isWl(r) { return !!WATCH[r.slug]; }
  function matchRow(r) {
    if (state.wl && !isWl(r)) return false;
    if (state.cat !== 'all' && (r.category || 'Other') !== state.cat) return false;
    if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
    if (state.q) {
      var q = state.q.toLowerCase();
      var hay = ((r.name || '') + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
      if (hay.indexOf(q) < 0) return false;
    }
    return true;
  }
  function sortRows(list) {
    var k = state.sort;
    var sorted = list.slice();
    function cmp(a, b) {
      if (k === 'implied') return b.implied_value_usd - a.implied_value_usd;
      if (k === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (k === 'growth') return num(b.change_7d, -1e9) - num(a.change_7d, -1e9);
      if (k === 'age') return num(b.age_days, -1) - num(a.age_days, -1);
      if (k === 'farm') return num(a.farm_total_usd, 1e9) - num(b.farm_total_usd, 1e9);
      return b.implied_value_usd - a.implied_value_usd;
    }
    sorted.sort(cmp);
    return sorted;
  }

  /* ---------- static shell: stats, controls, note ---------- */
  var tableHost, countNode, noteHost;
  function buildShell() {
    var med = median(ROWS.map(function (r) { return r.implied_value_usd; }));
    var wlCount = ROWS.filter(isWl).length;
    var stats = el('section', 'stats');
    var defs = [
      ['Watchlist', (COUNTS.watchlist !== undefined ? COUNTS.watchlist : wlCount) + '/' + (COUNTS.watchlist !== undefined ? COUNTS.watchlist : wlCount)],
      ['Board rows', String(COUNTS.rows !== undefined ? COUNTS.rows : ROWS.length)],
      ['Early rows', String(COUNTS.early !== undefined ? COUNTS.early : ROWS.length - wlCount)],
      ['Live tokens', String(COUNTS.live !== undefined ? COUNTS.live : LIVE.length)],
      ['Median implied', med === null ? 'n/a' : fmtUsd(med)],
      ['LOO error', BACK.loo_median_abs_log10_err !== undefined ? Number(BACK.loo_median_abs_log10_err).toFixed(3) + ' log10' : 'n/a']
    ];
    defs.forEach(function (d) {
      var s = el('div', 'stat');
      s.appendChild(el('span', null, d[0]));
      var b = el('b', null, d[1]);
      s.appendChild(b);
      stats.appendChild(s);
    });
    app.appendChild(stats);

    var ctrls = el('div', 'controls');
    var f1 = el('div', 'field');
    f1.appendChild(el('label', null, 'Search'));
    var q = document.createElement('input');
    q.type = 'search'; q.placeholder = 'Name, slug or category'; q.setAttribute('aria-label', 'Search protocols');
    q.addEventListener('input', function () { state.q = q.value; renderTable(); });
    f1.appendChild(q); ctrls.appendChild(f1);

    var cats = Array.from(new Set(ROWS.map(function (r) { return r.category || 'Other'; }))).sort();
    var f2 = el('div', 'field');
    f2.appendChild(el('label', null, 'Category'));
    var cs = document.createElement('select');
    cs.setAttribute('aria-label', 'Category');
    cs.appendChild(opt('all', 'All categories'));
    cats.forEach(function (c) { cs.appendChild(opt(c, c)); });
    cs.addEventListener('change', function () { state.cat = cs.value; renderTable(); });
    f2.appendChild(cs); ctrls.appendChild(f2);

    var chains = Array.from(new Set(ROWS.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var f3 = el('div', 'field');
    f3.appendChild(el('label', null, 'Chain'));
    var hs = document.createElement('select');
    hs.setAttribute('aria-label', 'Chain');
    hs.appendChild(opt('all', 'All chains'));
    chains.forEach(function (c) { hs.appendChild(opt(c, c)); });
    hs.addEventListener('change', function () { state.chain = hs.value; renderTable(); });
    f3.appendChild(hs); ctrls.appendChild(f3);

    var f4 = el('div', 'field');
    f4.appendChild(el('label', null, 'Sort by'));
    var ss = document.createElement('select');
    ss.setAttribute('aria-label', 'Sort by');
    [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d change'], ['age', 'Age'], ['farm', 'Farm cost (low first)']].forEach(function (p) { ss.appendChild(opt(p[0], p[1])); });
    ss.addEventListener('change', function () { state.sort = ss.value; renderTable(); });
    f4.appendChild(ss); ctrls.appendChild(f4);

    var tg = el('label', 'toggle');
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.addEventListener('change', function () { state.wl = cb.checked; renderTable(); });
    tg.appendChild(cb);
    tg.appendChild(document.createTextNode('Watchlist only'));
    ctrls.appendChild(tg);

    var tabs = el('div', 'tabs');
    var bPre = el('button', null, 'Pre-token');
    bPre.type = 'button'; bPre.setAttribute('aria-pressed', 'true');
    var bLive = el('button', null, 'Live tokens (' + LIVE.length + ')');
    bLive.type = 'button'; bLive.setAttribute('aria-pressed', 'false');
    bPre.addEventListener('click', function () { state.tab = 'pre'; bPre.setAttribute('aria-pressed', 'true'); bLive.setAttribute('aria-pressed', 'false'); renderTable(); });
    bLive.addEventListener('click', function () { state.tab = 'live'; bLive.setAttribute('aria-pressed', 'true'); bPre.setAttribute('aria-pressed', 'false'); renderTable(); });
    tabs.appendChild(bPre); tabs.appendChild(bLive);
    ctrls.appendChild(tabs);

    countNode = el('span', 'count');
    ctrls.appendChild(countNode);
    app.appendChild(ctrls);

    tableHost = el('div');
    app.appendChild(tableHost);
    noteHost = el('div');
    app.appendChild(noteHost);
    renderNote();
  }

  /* ---------- tables ---------- */
  function sortHead(label, key) {
    var th = el('th');
    var b = el('button', null, label + (state.sort === key ? ' v' : ''));
    b.type = 'button';
    b.addEventListener('click', function () { state.sort = key; renderTable(); });
    th.appendChild(b);
    return th;
  }
  function renderTable() {
    tableHost.textContent = '';
    if (state.tab === 'live') { renderLive(); return; }
    var list = sortRows(ROWS.filter(matchRow));
    countNode.textContent = list.length + ' of ' + ROWS.length + ' rows';
    if (!list.length) {
      var empty = el('div', 'panel');
      var e = el('div', 'empty');
      e.appendChild(el('h2', null, 'No protocol matches that filter'));
      e.appendChild(el('p', null, 'Clear the search or pick another category to see the board again.'));
      var clr = el('button', null, 'Clear filters');
      clr.type = 'button';
      clr.addEventListener('click', function () { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.wl = false; buildShellReset(); });
      e.appendChild(clr); empty.appendChild(e); tableHost.appendChild(empty);
      return;
    }
    var max = list[0].implied_value_usd || 1;
    var panel = el('div', 'panel');
    var wrap = el('div', 'wrap');
    var t = document.createElement('table');
    var cap = el('caption', null, 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.');
    t.appendChild(cap);
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    hr.appendChild(sortHead('Rank', 'implied'));
    hr.appendChild(el('th', null, 'Protocol'));
    hr.appendChild(sortHead('TVL', 'tvl'));
    hr.appendChild(sortHead('7d', 'growth'));
    hr.appendChild(sortHead('Age', 'age'));
    hr.appendChild(sortHead('Implied value', 'implied'));
    hr.appendChild(sortHead('Farm cost', 'farm'));
    hr.appendChild(el('th', null, 'Token'));
    thead.appendChild(hr); t.appendChild(thead);
    var tb = document.createElement('tbody');
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      if (state.sel === r.slug) tr.className = 'sel';
      tr.tabIndex = 0;
      tr.addEventListener('click', function () { openDetail(r.slug); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } });
      var td0 = el('td', 'num'); td0.appendChild(el('span', 'rank', String(r.rank))); tr.appendChild(td0);
      var td1 = el('td');
      var nm = el('div', 'pname');
      nm.appendChild(el('b', null, r.name));
      nm.appendChild(el('span', null, (r.category || 'Other') + ' on ' + ((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain')));
      td1.appendChild(nm); tr.appendChild(td1);
      tr.appendChild(el('td', 'num', fmtUsd(r.tvl_usd)));
      var g = el('td', 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), fmtPct(r.change_7d));
      tr.appendChild(g);
      tr.appendChild(el('td', 'num', fmtAge(r.age_days)));
      var td5 = el('td');
      var imp = el('div');
      imp.appendChild(el('span', 'num', fmtUsd(r.implied_value_usd)));
      var bar = el('div', 'bar'); var bi = el('i');
      bi.style.width = Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%';
      bar.appendChild(bi); imp.appendChild(bar);
      td5.appendChild(imp); tr.appendChild(td5);
      tr.appendChild(el('td', 'num', r.farm_total_usd === undefined ? 'n/a' : fmtMoney(r.farm_total_usd)));
      var td7 = el('td');
      td7.appendChild(el('span', 'tag' + (isWl(r) ? ' wl' : ''), isWl(r) ? 'WATCHLIST' : 'no token'));
      tr.appendChild(td7);
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); panel.appendChild(wrap); tableHost.appendChild(panel);
  }
  function renderLive() {
    var list = LIVE.filter(function (r) {
      if (state.cat !== 'all' && (r.category || 'Other') !== state.cat) return false;
      if (state.chain !== 'all' && !(r.chains || []).includes(state.chain)) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (((r.name || '') + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    countNode.textContent = list.length + ' live tokens (set aside, not ranked)';
    var panel = el('div', 'panel');
    var wrap = el('div', 'wrap');
    var t = document.createElement('table');
    t.appendChild(el('caption', null, 'Token live: these protocols already trade, so market cap is a fact, not a model. They are set aside from the pre-token ranking.'));
    var thead = document.createElement('thead');
    var hr = document.createElement('tr');
    ['Protocol', 'TVL', '7d', 'Market cap', 'Token'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr); t.appendChild(thead);
    var tb = document.createElement('tbody');
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      var td1 = el('td');
      var nm = el('div', 'pname');
      nm.appendChild(el('b', null, r.name));
      nm.appendChild(el('span', null, (r.category || 'Other') + ' on ' + ((r.chains || []).slice(0, 2).join(', ') || 'an unnamed chain')));
      td1.appendChild(nm); tr.appendChild(td1);
      tr.appendChild(el('td', 'num', fmtUsd(r.tvl_usd)));
      tr.appendChild(el('td', 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), fmtPct(r.change_7d)));
      tr.appendChild(el('td', 'num', fmtUsd(r.mcap_usd)));
      var td5 = el('td'); td5.appendChild(el('span', 'tag', 'already trades')); tr.appendChild(td5);
      tb.appendChild(tr);
    });
    t.appendChild(tb); wrap.appendChild(t); panel.appendChild(wrap); tableHost.appendChild(panel);
  }
  function buildShellReset() {
    var inputs = app.querySelectorAll('input, select');
    inputs.forEach(function (n) { if (n.type === 'checkbox') n.checked = false; else if (n.tagName === 'SELECT') n.selectedIndex = 0; else n.value = ''; });
    renderTable();
  }

  /* ---------- research note (numbers read from data.js, never hardcoded) ---------- */
  function renderNote() {
    var sec = el('section', 'note');
    sec.appendChild(el('h2', null, 'Research note — how to read this radar'));
    var p1 = el('p');
    var curveCount = Object.keys(fits().by).length;
    p1.appendChild(document.createTextNode('The model fits a separate log-log curve (log market cap against log TVL) for each category with enough traded protocols — ' + curveCount + ' category curves in this sweep — and falls back to the global curve, rescaled by the category median market-cap/TVL ratio, where a category is thin. A protocol is scored from its TVL through its category curve, then adjusted for 7-day growth (weight ' + num(MODEL.growth_weight, 0.5) + ', clamped ' + num(MODEL.growth_floor, -60) + '% to ' + num(MODEL.growth_cap, 120) + '%) and for maturity (older protocols with no token yet score closer to full value). No protocol name is special-cased.'));
    sec.appendChild(p1);
    var p2 = el('p');
    var looLog = BACK.loo_median_abs_log10_err !== undefined ? Number(BACK.loo_median_abs_log10_err).toFixed(3) : 'n/a';
    var looPct = BACK.loo_median_abs_pct_err !== undefined ? Number(BACK.loo_median_abs_pct_err).toFixed(1) + '%' : 'n/a';
    var holdPct = BACK.holdout_median_abs_pct_err !== undefined ? Number(BACK.holdout_median_abs_pct_err).toFixed(1) + '%' : 'n/a';
    var ncomp = BACK.n_comps !== undefined ? BACK.n_comps : 'n/a';
    p2.appendChild(document.createTextNode('Backtest on ' + ncomp + ' traded protocols: leave-one-out median error ' + looLog + ' in log10 (median absolute error ' + looPct + '); deterministic 80/20 holdout median error ' + holdPct + '. The band around each implied value is one residual standard deviation of its curve, so wide bands mean the category itself is noisy.'));
    sec.appendChild(p2);
    var ul = document.createElement('ul');
    [['Implied value is a model, not a promise', ' — it estimates what a token might be worth if one launches, from comparables. It is not a price, and a launch may never happen.'],
     ['Records no token \u2260 has no token', ' — the snapshot only records what it records; a protocol listed here as pre-token may have a token the snapshot missed.'],
     ['Costs are gas + fees only; deposits are your capital, not a cost', ' — farm-plan totals count gas and fees. Any deposit you place stays yours (minus risk); it is not spent.']]
    .forEach(function (pair) {
      var li = document.createElement('li');
      li.appendChild(el('b', null, pair[0]));
      li.appendChild(document.createTextNode(pair[1]));
      ul.appendChild(li);
    });
    sec.appendChild(ul);
    var p3 = el('p');
    p3.appendChild(document.createTextNode('Snapshot as of ' + esc(DATA.as_of) + ' \u00b7 model ' + esc(DATA.model_version || '') + ' \u00b7 ' + (COUNTS.rows !== undefined ? COUNTS.rows : ROWS.length) + ' rows (' + (COUNTS.watchlist !== undefined ? COUNTS.watchlist : 0) + ' watchlist + ' + (COUNTS.early !== undefined ? COUNTS.early : 0) + ' early) \u00b7 ' + (COUNTS.live !== undefined ? COUNTS.live : LIVE.length) + ' live tokens set aside.'));
    sec.appendChild(p3);
    noteHost.appendChild(sec);
  }

  /* ---------- detail drawer ---------- */
  function normSteps(row) {
    var raw = row.farm_steps || [];
    return raw.map(function (s) {
      if (typeof s === 'string') return { text: s, cost: null, time: null };
      return { text: s.text || '', cost: (typeof s.cost_usd === 'number' ? s.cost_usd : null), time: (typeof s.time_min === 'number' ? s.time_min : null) };
    });
  }
  function openDetail(slug) {
    var row = null;
    ROWS.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.sel = slug;
    var rec = impliedOf(row);
    // The board stores base_value_usd rounded to whole dollars, so a recompute from
    // the stored base can land a dollar or two away; agreement within that rounding
    // noise (max $2 or 0.01%) counts as a match.
    var agree = Math.abs(rec.value - row.implied_value_usd) <= Math.max(2, Math.round(row.implied_value_usd * 0.0001));
    drawer.textContent = '';
    var head = el('div', 'd-head');
    var ht = el('div');
    ht.appendChild(el('span', 'tag' + (isWl(row) ? ' wl' : ''), 'RANK ' + row.rank + ' OF ' + ROWS.length + (isWl(row) ? ' \u00b7 WATCHLIST' : '')));
    ht.appendChild(el('h2', null, row.name));
    ht.appendChild(el('p', 'sub', (row.category || 'Other') + ' on ' + ((row.chains || []).join(', ') || 'an unnamed chain') + ' \u00b7 TVL ' + fmtUsd(row.tvl_usd)));
    head.appendChild(ht);
    var close = el('button', 'close', 'Close');
    close.type = 'button';
    close.addEventListener('click', closeDetail);
    head.appendChild(close);
    drawer.appendChild(head);

    var s1 = el('section', 'd-sec');
    s1.appendChild(el('h3', null, 'Model breakdown'));
    var kv = el('div', 'kv');
    [['Curve used', rec.curve], ['Base value (curve x TVL)', fmtUsd(rec.base)],
     ['7d growth', fmtPct(row.change_7d)], ['Growth multiplier', 'x' + rec.growthMult.toFixed(3)],
     ['Age with no token', fmtAge(row.age_days)], ['Maturity multiplier', 'x' + rec.maturityMult.toFixed(3)],
     ['Implied value', fmtUsd(row.implied_value_usd)]].forEach(function (pair) {
      kv.appendChild(el('span', null, pair[0]));
      kv.appendChild(el('b', null, pair[1]));
    });
    s1.appendChild(kv);
    var chk = el('p', 'check');
    chk.appendChild(document.createTextNode('Page recompute from the row + model constants: ' + fmtUsd(rec.value) + ' — '));
    var cb = el('b', agree ? null : 'bad', agree ? 'matches the board' : 'differs from the board');
    chk.appendChild(cb);
    chk.appendChild(document.createTextNode('.'));
    s1.appendChild(chk);
    var lo = row.implied_low_usd, hi = row.implied_high_usd;
    if (lo && hi && hi > lo && row.implied_value_usd) {
      var spanLo = Math.log10(Math.max(1, lo)), spanHi = Math.log10(Math.max(1, hi));
      var pad = (spanHi - spanLo) * 0.15;
      var mn = spanLo - pad, mx = spanHi + pad;
      var pct = function (v) { return Math.max(0, Math.min(100, ((Math.log10(Math.max(1, v)) - mn) / (mx - mn)) * 100)); };
      var w = el('div', 'whisk');
      var band = el('i'); band.style.left = pct(lo) + '%'; band.style.width = (pct(hi) - pct(lo)) + '%';
      w.appendChild(band);
      var mark = el('b'); mark.style.left = 'calc(' + pct(row.implied_value_usd) + '% - 1px)';
      w.appendChild(mark);
      s1.appendChild(w);
      var lab = el('div', 'whisk-lab');
      lab.appendChild(el('span', null, 'low ' + fmtUsd(lo)));
      lab.appendChild(el('span', null, 'implied ' + fmtUsd(row.implied_value_usd)));
      lab.appendChild(el('span', null, 'high ' + fmtUsd(hi)));
      s1.appendChild(lab);
      var cap2 = el('p', 'check', 'Uncertainty band: one residual standard deviation of the ' + rec.curve + ' curve, in log space.');
      s1.appendChild(cap2);
    }
    drawer.appendChild(s1);

    var s2 = el('section', 'd-sec');
    s2.appendChild(el('h3', null, 'Farm plan'));
    var steps = normSteps(row);
    var ol = el('ol', 'steps');
    var totCost = 0, totTime = 0, hasCost = false;
    steps.forEach(function (st, i) {
      var li = document.createElement('li');
      li.appendChild(document.createTextNode((i + 1) + '. ' + st.text));
      var tail = [];
      if (st.cost !== null) { tail.push(fmtMoney(st.cost) + ' gas/fees'); totCost += st.cost; hasCost = true; }
      if (st.time !== null) { tail.push(fmtDur(st.time)); totTime += st.time; }
      if (tail.length) li.appendChild(el('span', 'cost', tail.join(' \u00b7 ')));
      ol.appendChild(li);
    });
    s2.appendChild(ol);
    var total = el('div', 'total');
    var tc = row.farm_total_usd !== undefined ? row.farm_total_usd : (hasCost ? totCost : null);
    var tt = row.farm_total_min !== undefined ? row.farm_total_min : totTime;
    total.appendChild(el('span', null, 'Net total (gas + fees only)'));
    total.appendChild(el('b', null, (tc === null ? 'n/a' : fmtMoney(tc)) + ' \u00b7 ' + fmtDur(tt)));
    s2.appendChild(total);
    var note = el('p', 'check', 'Deposits in the steps above are your capital, not a cost — only gas and fees are counted.');
    s2.appendChild(note);
    drawer.appendChild(s2);

    drawer.hidden = false;
    renderTable();
  }
  function closeDetail() {
    state.sel = null;
    drawer.hidden = true;
    drawer.textContent = '';
    renderTable();
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !drawer.hidden) closeDetail();
  });

  /* ---------- boot ---------- */
  if (mastMeta) {
    mastMeta.textContent = 'AS OF ' + (DATA.as_of || 'n/a') + '\nMODEL ' + (DATA.model_version || 'n/a') +
      '\nFLOOR ' + fmtUsd(DATA.floor_usd) + '\nROWS ' + ROWS.length + ' \u00b7 LIVE ' + LIVE.length;
  }
  buildShell();
  renderTable();
  app.setAttribute('aria-busy', 'false');
  window.MERIDIAN = {
    openDetail: openDetail, closeDetail: closeDetail,
    setState: function (patch) { Object.keys(patch).forEach(function (k) { state[k] = patch[k]; }); renderTable(); },
    state: state, rows: ROWS
  };
  window.__RADAR_READY__ = true;
})();
