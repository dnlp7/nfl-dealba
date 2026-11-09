/*
 * Fantasy De Alba — site v1 (Stage 6).
 * One IIFE, no build step. Spanish UI. Data:
 *   data/league.json                 managers + team seasons (nightly export)
 *   data/season-<year>.json          2026 onward (nightly export)
 *   data/history_games_2020-2025.json  static history (regular season only)
 * All stats come from stats.js (window.DeAlbaStats); this file only arranges
 * and formats them.
 */
(function () {
  'use strict';

  var S = window.DeAlbaStats;
  var HISTORY_LAST = 2025;
  var FIRST_SEASON = 2020;

  var st = {
    league: null,
    managers: {},        // managerId -> manager
    seasons: {},         // year -> { year, games, regWeeks, currentWeek, exportedAt, live }
    years: [],           // newest first
    current: null,       // newest year
    computed: {}         // year -> computeSeason result
  };

  // ---------------------------------------------------------------- helpers

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function fmt(v, dec) {
    if (!isNum(v)) return '';
    return v.toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec, useGrouping: false });
  }
  function pts(v) { return fmt(v, 2); }
  function signed(v, dec) { return isNum(v) ? (v > 0 ? '+' : '') + fmt(v, dec == null ? 2 : dec) : ''; }
  function pct(v) { return isNum(v) ? fmt(v * 100, 0) + '%' : ''; }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function mgrName(id) { var m = st.managers[id]; return m ? m.shortName : id; }

  function fetchJson(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ': ' + r.status);
      return r.json();
    });
  }

  // ---------------------------------------------------------------- data

  function load() {
    return Promise.all([
      fetchJson('data/league.json'),
      fetchJson('data/history_games_2020-2025.json')
    ]).then(function (res) {
      st.league = res[0];
      st.league.managers.forEach(function (m) { st.managers[m.managerId] = m; });
      var hist = res[1];
      S.seasonsIn(hist).forEach(function (y) {
        var games = hist.filter(function (g) { return g.season === y; });
        st.seasons[y] = {
          year: y, games: games, live: false, currentWeek: null,
          regWeeks: Math.max.apply(null, games.filter(function (g) { return g.type === 'REG'; }).map(function (g) { return g.week; }))
        };
      });
      // Every season after the history file has its own export file.
      var exported = {};
      st.league.teamSeasons.forEach(function (t) { if (t.season > HISTORY_LAST) exported[t.season] = true; });
      return Promise.all(Object.keys(exported).map(function (y) {
        return fetchJson('data/season-' + y + '.json').then(function (s) {
          st.seasons[s.season] = {
            year: s.season, games: s.games, live: true, exportedAt: s.exportedAt,
            regWeeks: s.config.regWeeks, playoffTeams: s.config.playoffTeams,
            currentWeek: s.config.currentWeek, teams: s.teams
          };
        }).catch(function () { /* season file not exported yet */ });
      }));
    }).then(function () {
      st.years = Object.keys(st.seasons).map(Number).sort(function (a, b) { return b - a; });
      st.current = st.years[0];
    });
  }

  function computed(year) {
    if (!st.computed[year]) {
      var s = st.seasons[year];
      st.computed[year] = S.computeSeason(s.games, year, { regWeeks: s.regWeeks, playoffSpots: s.playoffTeams || 4 });
    }
    return st.computed[year];
  }

  // Rows of a stats table sorted by its rank R (nulls last), ties by team name.
  function sorted(rows) {
    return rows.slice().sort(function (a, b) {
      var ra = isNum(a.R) ? a.R : 999, rb = isNum(b.R) ? b.R : 999;
      return ra - rb || String(a.team).localeCompare(String(b.team));
    });
  }

  // Weeks of a season that have games (regular season + tracked playoffs).
  function seasonWeeks(year) {
    var w = {};
    st.seasons[year].games.forEach(function (g) { w[g.week] = g.type; });
    return Object.keys(w).map(Number).sort(function (a, b) { return a - b; }).map(function (k) { return { week: k, type: w[k] }; });
  }

  // Last week with every game FINAL (null if none yet).
  function lastFinalWeek(year) {
    var byWeek = {};
    st.seasons[year].games.forEach(function (g) {
      if (!byWeek[g.week]) byWeek[g.week] = true;
      if (g.status !== 'FINAL') byWeek[g.week] = false;
    });
    var done = Object.keys(byWeek).filter(function (k) { return byWeek[k]; }).map(Number);
    return done.length ? Math.max.apply(null, done) : null;
  }

  // One entry per matchup (games are stored once per team, mirrored).
  function matchups(year, week) {
    var seen = {}, out = [];
    st.seasons[year].games.forEach(function (g) {
      if (g.week !== week) return;
      var key = [g.managerId, g.oppManagerId].sort().join('|');
      if (seen[key]) return;
      seen[key] = true;
      var a = side(g, false), b = side(g, true);
      // Winner on top once final; otherwise ESPN's order (no projections shown before a game is final).
      var swap = g.status === 'FINAL' && g.result === 'L';
      out.push({
        year: year, week: week, type: g.type, status: g.status,
        top: swap ? b : a, bottom: swap ? a : b,
        margin: g.status === 'FINAL' && isNum(g.pf) && isNum(g.pa) ? Math.abs(g.pf - g.pa) : null
      });
    });
    return out;
  }
  function side(g, opp) {
    return opp
      ? { managerId: g.oppManagerId, team: g.opp, pf: g.pa, proj: g.projPa, result: g.result === 'W' ? 'L' : g.result === 'L' ? 'W' : g.result }
      : { managerId: g.managerId, team: g.team, pf: g.pf, proj: g.projPf, result: g.result };
  }

  function weekLabel(type, week) {
    if (type === 'SF') return 'Semifinal';
    if (type === 'F') return 'Final';
    return 'Semana ' + week;
  }

  // Awards for one finished week. Every award keeps all tied holders.
  function weekAwards(year, week) {
    var rows = st.seasons[year].games.filter(function (g) { return g.week === week && g.status === 'FINAL'; });
    if (!rows.length) return null;
    var ms = matchups(year, week).filter(function (m) { return m.status === 'FINAL'; });
    function best(list, fn, lowest) {
      var vals = list.map(fn).filter(isNum);
      if (!vals.length) return null;
      var target = lowest ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
      return { value: target, items: list.filter(function (x) { return fn(x) === target; }) };
    }
    var scores = rows.map(function (g) { return g.pf; });
    var out = {
      teams: rows.length,
      avg: scores.reduce(function (a, b) { return a + b; }, 0) / scores.length
    };
    // Record badges only for regular-season weeks (playoff games never count).
    var reg = rows.every(function (g) { return g.type === 'REG'; }), R = reg ? awardRecords() : null;
    Object.keys(AWARD_FN).forEach(function (k) {
      var d = AWARD_FN[k], b = best(d.team ? rows : ms, d.f, d.lowest);
      if (b && R) { b.leagueRec = b.value === R[k].league; b.seasonRec = b.value === R[k].season[year]; }
      out[k] = b;
    });
    return out;
  }

  // Highlight values (rounded to cents so sums compare exactly). team = one row
  // per team, otherwise one entry per match (matchups()).
  function r2(v) { return isNum(v) ? Math.round(v * 100) / 100 : null; }
  function projDiff(g) { return isNum(g.projPf) ? r2(g.pf - g.projPf) : null; }
  function matchTotal(m) { return r2(m.top.pf + m.bottom.pf); }
  function matchMargin(m) { return isNum(m.margin) ? r2(m.margin) : null; }
  var AWARD_FN = {
    high: { team: true, f: function (g) { return r2(g.pf); } },
    low: { team: true, f: function (g) { return r2(g.pf); }, lowest: true },
    over: { team: true, f: projDiff },
    under: { team: true, f: projDiff, lowest: true },
    mostPts: { f: matchTotal },
    fewestPts: { f: matchTotal, lowest: true },
    blowout: { f: matchMargin },
    closest: { f: matchMargin, lowest: true },
    mostPtsLoss: { team: true, f: function (g) { return g.result === 'L' ? r2(g.pf) : null; } },
    fewestPtsWin: { team: true, f: function (g) { return g.result === 'W' ? r2(g.pf) : null; }, lowest: true },
    // winner that was projected to lose by the most (its projected margin, negative)
    upset: { f: function (m) {
      return m.top.result === 'W' && isNum(m.top.proj) && isNum(m.bottom.proj) && m.top.proj < m.bottom.proj ? r2(m.top.proj - m.bottom.proj) : null;
    }, lowest: true },
    // final margin furthest from the projected margin, either way (always positive)
    unexpected: { f: function (m) {
      return isNum(m.top.proj) && isNum(m.bottom.proj) ? r2(Math.abs((m.top.pf - m.bottom.pf) - (m.top.proj - m.bottom.proj))) : null;
    } }
  };
  // Best/worst value of every highlight: per season and all-time (regular season, FINAL).
  function awardRecords() {
    if (st.awardRec) return st.awardRec;
    var R = {};
    Object.keys(AWARD_FN).forEach(function (k) { R[k] = { league: null, season: {} }; });
    st.years.forEach(function (y) {
      var rows = st.seasons[y].games.filter(function (g) { return g.type === 'REG' && g.status === 'FINAL'; });
      var weeks = {};
      rows.forEach(function (g) { weeks[g.week] = true; });
      var ms = [];
      Object.keys(weeks).forEach(function (w) {
        ms = ms.concat(matchups(y, Number(w)).filter(function (m) { return m.status === 'FINAL' && m.type === 'REG'; }));
      });
      Object.keys(AWARD_FN).forEach(function (k) {
        var d = AWARD_FN[k], vals = (d.team ? rows : ms).map(d.f).filter(isNum);
        if (!vals.length) return;
        var v = d.lowest ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
        R[k].season[y] = v;
        if (R[k].league === null || (d.lowest ? v < R[k].league : v > R[k].league)) R[k].league = v;
      });
    });
    st.awardRec = R;
    return R;
  }

  // Current streak and last-5 form from the STD table's weekly results.
  function form(stdRow, playedWeeks) {
    var res = playedWeeks.map(function (w) { return stdRow.weeks[w]; }).filter(Boolean);
    var streak = '';
    if (res.length) {
      var last = res[res.length - 1], n = 0;
      for (var i = res.length - 1; i >= 0 && res[i] === last; i--) n++;
      streak = ({ W: 'G', L: 'P', T: 'E' }[last] || last) + n;
    }
    return { streak: streak, last5: res.slice(-5) };
  }

  // ---------------------------------------------------------------- color scales
  // Exact port of the 2025 season doc's conditional formatting (Google Sheets
  // color scales: linear RGB between stops; a 3-stop "percent 50" midpoint is
  // halfway between the min and max values; a numeric midpoint is that value).
  var K = {
    red: '#cd0f2f', grey: '#202225', green: '#40b031', purple: '#6336b3', blue: '#2362d9',
    accent: '#2d9ee0', slate: '#283f4c', navy: '#293245', plum: '#312742',
    dkGreen: '#2b4328', dkRed: '#43272c', magenta: '#cd0fa8', dkMagenta: '#43243d',
    wkWin: '#1c5b14', wkLoss: '#5d0c1a', winText: '#48cb36', lossText: '#ff4d63',
    gold: '#0f9183', violet: '#c4511d', orange: '#6336b3',
    brick: '#9a3412', petrol: '#0e7490'   // DIF scale: darker than the PC / PF edges   // points summary: for / against; MÁX-MÍN low end
  };
  // A scale is [lowColor, highColor] or [lowColor, midColor, highColor, midValue?]
  // (midValue omitted = halfway between min and max).
  var SC = {
    good3: [K.red, K.grey, K.green],        // totals/averages: higher is better
    bad3: [K.green, K.grey, K.red],         // totals/averages: higher is worse
    mm: [K.orange, K.grey, K.blue],         // MAX/MIN pair (one range for both columns)
    mmPa: [K.blue, K.grey, K.orange],
    wkPf: [K.slate, K.accent],              // weekly points for
    wkPa: [K.dkMagenta, K.magenta],         // weekly points against
    footPf: [K.slate, K.accent],            // PROM row = same scale as the weekly cells
    footPa: [K.dkMagenta, K.magenta],
    div: [K.wkLoss, K.grey, K.wkWin, 0],    // weekly +/- around zero (dark, as in the docs)
    divInv: [K.wkWin, K.grey, K.wkLoss, 0],
    rank: [K.accent, K.slate],              // R column: 1 brightest
    wins: [K.dkGreen, K.green], losses: [K.dkRed, K.red],
    fav: [K.navy, K.blue], und: [K.plum, K.purple],   // counts: good = blue, bad = purple
    // Summary scales with a fixed middle (Stage 8): differences center on 0, records on .500
    // POINTS world (blue = for / good, magenta = against / bad)
    // POINTS summary columns (gold = for / good, violet = against / bad)
    good0: [K.brick, K.grey, K.petrol, 0], bad0: [K.petrol, K.grey, K.brick, 0],   // DIF, vs proyección, PR PFvsPC (middle 0)
    pos: [K.grey, K.gold], neg: [K.grey, K.violet],        // PF / PC totals and averages
    pwrB: [K.purple, K.grey, K.blue, 0], rankB: [K.accent, K.slate],   // PWR value (middle 0) / PWR position
    titles: [K.grey, '#a8780f'], finals: [K.grey, '#66788a'],   // Títulos = trophy gold, Finales = silver (Playoffs = count)
    wkRec: [K.wkLoss, K.grey, K.wkWin, 0.5],                 // season cells of Histórico TG (dark, middle .500)
    count: [K.navy, K.blue],                                 // neutral counts: títulos, finales, playoffs, weekly TG wins
    // RESULTS world (green = wins / good, red = losses / bad)
    win5: [K.red, K.grey, K.green, 0.5], recB: [K.red, K.grey, K.green, 0.5],   // G-P, TG, %, FAV-UND: middle .500
    streak: [K.red, K.grey, K.green, 0],                    // Racha: losses negative, wins positive
    blueUp: [K.grey, K.gold], purpleUp: [K.grey, K.violet], blueDown: [K.green, K.dkGreen],   // points counts (good / bad); Tabla xS best place
    greenDown: [K.blue, K.grey, K.purple], redDown: [K.purple, K.grey, K.blue],   // average weekly rank / average place (low = blue)
    accentDown: [K.accent, K.slate], magentaDown: [K.magenta, K.dkMagenta]
  };

  function hexRgb(h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); }
  function lerp(a, b, t) {
    var x = hexRgb(a), y = hexRgb(b);
    return 'rgb(' + x.map(function (v, i) { return Math.round(v + (y[i] - v) * t); }).join(',') + ')';
  }
  function clamp01(t) { return Math.max(0, Math.min(1, t)); }
  // Background color for v on scale over [lo, hi].
  function scaleColor(v, scale, lo, hi) {
    if (!isNum(v) || !isNum(lo) || !isNum(hi)) return null;
    if (scale.length === 2) return lerp(scale[0], scale[1], hi === lo ? 0 : clamp01((v - lo) / (hi - lo)));
    var mid = scale.length > 3 ? scale[3] : (lo + hi) / 2;
    if (v <= mid) return lerp(scale[0], scale[1], mid === lo ? 1 : clamp01((v - lo) / (mid - lo)));
    return lerp(scale[1], scale[2], hi === mid ? 0 : clamp01((v - mid) / (hi - mid)));
  }
  function bg(v, scale, range) {
    var c = scaleColor(v, scale, range[0], range[1]);
    return c ? 'background:' + c : '';
  }
  function rangeOf(vals) {
    var a = vals.filter(isNum);
    return a.length ? [Math.min.apply(null, a), Math.max.apply(null, a)] : [null, null];
  }
  // Win/loss cell, as in the doc's Tabla tab: dark fill + bright text.
  function wlStyle(r) {
    if (r === 'W') return 'background:' + K.wkWin + ';color:' + K.winText;
    if (r === 'L') return 'background:' + K.wkLoss + ';color:' + K.lossText;
    return '';
  }

  // ---------------------------------------------------------------- shared UI bits

  // Team name + manager; the manager's photo (avatar) on the left unless opts.noPhoto (Stage 8).
  function teamCell(row, opts) {
    opts = opts || {};
    var txt = '<span class="team-name">' + esc(row.team) + (opts.tag || '') + '</span>' +
      (opts.noManager ? '' : '<span class="team-mgr">' + esc(mgrName(row.managerId)) + '</span>');
    if (opts.noPhoto || !row.managerId) return '<div class="team-cell">' + txt + '</div>';
    return '<div class="team-cell has-photo">' + avatar(row.managerId, 'sm') + '<div class="team-txt">' + txt + '</div></div>';
  }

  // hist = true adds a "Histórico" option first (Estadísticas only); the arrows are off in that mode.
  function seasonSelect(id, year, hist) {
    var isH = year === 'historico';
    return '<div class="controls controls-season-nav">' +
      '<select id="' + id + '" aria-label="Temporada">' +
      (hist ? '<option value="historico"' + (isH ? ' selected' : '') + '>Histórico</option>' : '') +
      st.years.map(function (y) { return '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>' + y + '</option>'; }).join('') +
      '</select>' +
      '<div class="season-nav">' +
      '<button type="button" class="nav-btn" data-step="-1" aria-label="Temporada anterior"' + (isH || year === st.years[st.years.length - 1] ? ' disabled' : '') + '>&#9664;</button>' +
      '<button type="button" class="nav-btn" data-step="1" aria-label="Temporada siguiente"' + (isH || year === st.years[0] ? ' disabled' : '') + '>&#9654;</button>' +
      '</div></div>';
  }
  // Page header with the season as a title-picker between arrows (Stage 8). Same
  // markup hooks as seasonSelect (select + .season-nav .nav-btn), so bindSeasonSelect works.
  function seasonPicker(id, year, hist) {
    var isH = year === 'historico';
    return '<div class="page-head"><div class="week-pick-row season-nav">' +
      '<button type="button" class="nav-btn" data-step="-1" aria-label="Temporada anterior"' + (isH || year === st.years[st.years.length - 1] ? ' disabled' : '') + '>&#9664;</button>' +
      '<label class="title-pick"><h2 class="box-title">' + (isH ? 'Histórico' : year) + '</h2><span class="title-pick-ic" aria-hidden="true"></span>' +
      '<select id="' + id + '" aria-label="Temporada">' + (hist ? '<option value="historico"' + (isH ? ' selected' : '') + '>Histórico</option>' : '') + st.years.map(function (y) { return '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>' + y + '</option>'; }).join('') + '</select></label>' +
      '<button type="button" class="nav-btn" data-step="1" aria-label="Temporada siguiente"' + (isH || year === st.years[0] ? ' disabled' : '') + '>&#9654;</button>' +
      '</div></div>';
  }
  function bindSeasonSelect(root, year, go) {
    $('select', root).addEventListener('change', function (e) { go(e.target.value === 'historico' ? 'historico' : Number(e.target.value)); });
    $all('.season-nav .nav-btn', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var asc = st.years.slice().reverse(), i = asc.indexOf(year) + Number(b.dataset.step);
        if (asc[i]) go(asc[i]);
      });
    });
  }

  function resultBadge(r) {
    var t = { W: 'G', L: 'P', T: 'E' }[r] || '';
    return '<span class="res res-' + esc(r) + '">' + t + '</span>';
  }

  function statusChip(status) {
    var t = { FINAL: 'Final', LIVE: 'En juego', SCHEDULED: 'Por jugar' }[status] || status;
    return '<span class="chip chip-' + esc(String(status).toLowerCase()) + '">' + t + '</span>';
  }

  // Current regular-season record "G-P" (or "G-P-E" with ties).
  function recordOf(year, managerId) {
    var r = computed(year).tables.STD.rows.filter(function (x) { return x.managerId === managerId; })[0];
    return r ? r.W + '-' + r.L + (r.T ? '-' + r.T : '') : '';
  }

  function matchupCard(m, opts) {
    opts = opts || {};
    function line(s, isTop) {
      var cls = m.status === 'FINAL' ? (s.result === 'W' ? ' is-winner' : s.result === 'L' ? ' is-loser' : '') : '';
      return '<div class="mu-line' + cls + '">' +
        teamCell(s) +
        '<div class="mu-score">' +
          (m.status === 'FINAL'
            ? (isNum(s.pf) ? '<span class="mu-pts">' + pts(s.pf) + '</span>' : resultBadge(s.result)) +
              (isNum(s.proj) ? '<span class="mu-proj" title="Proyección">' + pts(s.proj) + '</span>' : '')
            : '<span class="mu-rec" title="Récord G-P">' + esc(recordOf(m.year, s.managerId)) + '</span>') +
        '</div></div>';
    }
    return '<div class="matchup' + (opts.compact ? ' compact' : '') + '">' +
      line(m.top, true) + line(m.bottom, false) +
      (opts.compact ? '' : '<div class="mu-foot">' + statusChip(m.status) +
        (isNum(m.margin) ? '<span class="mu-margin">+/- ' + pts(m.margin) + '</span>' : '') + '</div>') +
      '</div>';
  }



  // ---------------------------------------------------------------- awards

  // Highlights (Stage 8, layout B): team highlights, then match highlights.
  // tone: good (green ▲), bad (red ▼), neutral (blue ◆, the two margins).
  var AWARD_GROUPS = [
    { title: 'Equipos', items: [
      { key: 'high', title: 'Más puntos', tone: 'good', val: pts },
      { key: 'low', title: 'Menos puntos', tone: 'bad', val: pts },
      { key: 'over', title: 'Puntos arriba de la proyección', tone: 'good', val: signed },
      { key: 'under', title: 'Puntos abajo de la proyección', tone: 'bad', val: signed },
      { key: 'mostPtsLoss', title: 'Más puntos en una derrota', tone: 'good', val: pts },
      { key: 'fewestPtsWin', title: 'Menos puntos en una victoria', tone: 'bad', val: pts },
      { key: 'upset', title: 'Ganador más inesperado', tone: 'good', val: signed, winner: true, sub: function (b) { return 'diferencia proyectada vs ' + b.items.map(function (x) { return '<span class="award-rival">' + esc(x.bottom.team) + '</span>'; }).join(' / '); }, empty: 'Ganaron todos los favoritos' }] },
    { title: 'Partidos', items: [
      { key: 'mostPts', title: 'Más puntos combinados', tone: 'good', val: pts, match: true },
      { key: 'fewestPts', title: 'Menos puntos combinados', tone: 'bad', val: pts, match: true },
      { key: 'blowout', title: 'Mayor margen de victoria', tone: 'neutral', val: function (v) { return '+' + pts(v); }, match: true },
      { key: 'closest', title: 'Marcador más cerrado', tone: 'neutral', val: function (v) { return '+' + pts(v); }, match: true },
      { key: 'unexpected', title: 'Resultado más inesperado', tone: 'neutral', val: pts, match: true, sub: 'vs el margen proyectado' }] }
  ];
  var TONE_ICON = { good: '&#9650;', bad: '&#9660;', neutral: '&#9670;' };
  function decSpan(s) { return String(s).replace(/(\.\d+)/, '<span class="dec">$1</span>'); }

  // only = list of keys: just those cards, in that order, without the group headings (Inicio).
  function awardsHtml(a, only) {
    var groups = only ? [{ items: only.map(function (k) {
      return AWARD_GROUPS.reduce(function (f, g) { return f || g.items.filter(function (d) { return d.key === k; })[0]; }, null);
    }) }] : AWARD_GROUPS;
    return groups.map(function (grp) {
      return '<div class="hl-group">' + (grp.title ? '<h5 class="hl-head">' + grp.title + '</h5>' : '') + '<div class="awards">' + grp.items.map(function (d) {
        var b = a[d.key];
        // A highlight that can be missing (no underdog won) still shows its card, with a dash.
        if (!b && d.empty) return '<div class="award tone-' + d.tone + '"><div class="award-title"><span class="hl-ic">' + TONE_ICON[d.tone] + '</span>' + d.title + '</div>' +
          '<div class="award-value">–</div><div class="award-who muted">' + d.empty + '</div></div>';
        if (!b) return '';
        var who = b.items.map(function (x) {
          if (d.winner) return '<div class="award-who">' + teamCell(x.top) + '</div>';
          if (d.match) return '<div class="award-who">' + esc(x.top.team) + ' <span class="vs">vs</span> ' + esc(x.bottom.team) + '</div>';
          return '<div class="award-who">' + teamCell(x) + '</div>';
        }).join('');
        var badge = b.leagueRec ? '<span class="hl-badge rec-league">Récord de la liga</span>'
          : b.seasonRec ? '<span class="hl-badge rec-season">Récord de la temporada</span>' : '';
        return '<div class="award tone-' + d.tone + '"><div class="award-title"><span class="hl-ic">' + TONE_ICON[d.tone] + '</span>' + d.title + '</div>' +
          '<div class="award-value">' + decSpan(d.val(b.value)) + (d.sub ? '<div class="award-sub">' + (typeof d.sub === 'function' ? d.sub(b) : d.sub) + '</div>' : '') + '</div>' + who +
          (badge ? '<div class="hl-badges">' + badge + '</div>' : '') + '</div>';
      }).join('') + '</div></div>';
    }).join('');
  }

  // ---------------------------------------------------------------- INICIO

  function renderInicio() {
    var year = st.current, s = st.seasons[year], C = computed(year);
    var lastWeek = lastFinalWeek(year);
    var cw = s.currentWeek;
    var weekNow = seasonWeeks(year).filter(function (w) { return w.week === cw; })[0];
    var html = '<div class="inicio-grid">';

    // Left: last finished week
    html += '<div class="inicio-main">';
    if (lastWeek) {
      var a = weekAwards(year, lastWeek);
      var wtype = seasonWeeks(year).filter(function (w) { return w.week === lastWeek; })[0].type;
      html += '<div class="solid-box">' +
        boxHead('Últimos resultados', weekLabel(wtype, lastWeek)) +
        '<div class="matchups-grid">' + matchups(year, lastWeek).map(function (m) { return matchupCard(m, { compact: true }); }).join('') + '</div>' +
        (wtype === 'REG' ? '<h3 class="hl-title-inicio">Highlights</h3>' +
        awardsHtml(a, ['high', 'low', 'blowout', 'closest']) +
        '<a class="more-link" href="#resultados?temporada=' + year + '&semana=' + lastWeek + '">Ver más highlights &rarr;</a>' : '') +
        '</div>';
    }
    html += '</div>';

    // Right column: standings (no box), then next week's matchups
    var std = sorted(C.tables.STD.rows);
    html += '<div class="inicio-side">';
    html += '<div class="inicio-tabla">' + miniStandings(std, C, year) +
      '<a class="more-link" href="#posiciones?temporada=' + year + '">Ver posiciones &rarr;</a></div>';
    if (weekNow) {
      html += '<div class="solid-box">' + boxHead('Próximos partidos', weekLabel(weekNow.type, cw)) +
        '<div class="matchups-col">' + matchups(year, cw).map(function (m) { return matchupCard(m, { compact: true }); }).join('') + '</div>' +
        '</div>';
    }
    html += '</div></div>';

    $('#section-inicio').innerHTML = html;
  }

  // Box title with a lighter white line below it (e.g. the week).
  function boxHead(title, sub) {
    return '<div class="box-head"><h3 class="box-title center">' + esc(title) + '</h3>' +
      (sub ? '<div class="box-head-sub">' + esc(sub) + '</div>' : '') + '</div>';
  }

  function miniStandings(rows, C, year) {
    var rR = rangeOf(rows.map(function (r) { return r.R; }));
    // G-P colored by win %: green above .500, grey at .500, red below (Stage 8)
    var winPct = function (r) { var n = r.W + r.L + (r.T || 0); return n ? (r.W + (r.T || 0) / 2) / n : null; };
    var rPct = rangeOf(rows.map(winPct));
    var clinch = S.computeClinched(st.seasons[year].games, year, { playoffSpots: C.playoffSpots });
    var rPF = rangeOf(rows.map(function (r) { return r.PF; }));
    return '<table class="data-table mini-table"><thead><tr><th></th><th class="left">Equipo</th><th>G-P</th><th>PF</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var cut = i === C.playoffSpots - 1 ? ' class="po-cut"' : '';
        var tag = clinch[r.managerId] ? ' <span class="res res-C" title="Clasificado a playoffs">C</span>' : '';
        return '<tr' + cut + '><td class="rk" style="' + bg(r.R, SC.rank, rR) + '">' + r.R + '</td><td class="left team-td">' + teamCell(r, { tag: tag }) + '</td>' +
          '<td style="' + bg(winPct(r), SC.recB, rPct) + '">' + r.W + '-' + r.L + (r.T ? '-' + r.T : '') + '</td><td style="' + bg(r.PF, SC.pos, rPF) + '">' + pts(r.PF) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // ---------------------------------------------------------------- POSICIONES

  function renderPosiciones(params) {
    var year = Number(params.temporada) || st.current;
    if (!st.seasons[year]) year = st.current;
    var C = computed(year), T = C.tables;
    var by = function (code) { var o = {}; T[code].rows.forEach(function (r) { o[r.managerId] = r; }); return o; };
    var pa = by('PA'), gw = by('GW'), pwr = by('PWR'), xs = by('STD xW');
    var std = sorted(T.STD.rows);
    var anyTies = std.some(function (r) { return r.T; });
    var clinch = S.computeClinched(st.seasons[year].games, year, { playoffSpots: C.playoffSpots });

    var head = '<tr><th>Pos</th><th class="left">Equipo</th><th>' + (anyTies ? 'G-P-E' : 'G-P') + '</th>' +
      '<th>PF</th><th>PC</th><th>DIF</th><th title="Triunfos globales: contra todos los equipos cada semana">TG</th>' +
      '<th title="Ranking de poder">PWR</th><th>Racha</th><th class="form-col">Últimos 5</th></tr>';

    var col = function (fn) { return rangeOf(std.map(fn)); };
    var rR = col(function (r) { return r.R; }), rW = col(function (r) { return r.W; }), rL = col(function (r) { return r.L; });
    var rPF = col(function (r) { return r.PF; }), rPA = col(function (r) { return pa[r.managerId].TOT; });
    var rDIF = col(function (r) { return r.PF - pa[r.managerId].TOT; });
    var gwPct = function (r) { var g = gw[r.managerId]; return g.W + g.L ? g.W / (g.W + g.L) : null; };
    var recPct = function (r) { var n = r.W + r.L + (r.T || 0); return n ? (r.W + (r.T || 0) / 2) / n : null; };
    var rRec = col(recPct);
    var streakVal = function (r) { var s = form(r, C.playedWeeks).streak, n = Number(s.slice(1)) || 0; return s[0] === 'G' ? n : s[0] === 'P' ? -n : 0; };
    var rStreak = col(streakVal);
    var rGW = col(gwPct), rPWR = col(function (r) { return pwr[r.managerId].PWR; });

    var body = std.map(function (r, i) {
      var p = pa[r.managerId].TOT, d = r.PF - p, g = gw[r.managerId], f = form(r, C.playedWeeks);
      var cut = i === C.playoffSpots - 1 ? ' class="po-cut"' : '';
      return '<tr' + cut + '>' +
        '<td class="rk" style="' + bg(r.R, SC.rank, rR) + '">' + r.R + '</td>' +
        '<td class="left team-td">' + teamCell(r, { tag: clinch[r.managerId] ? ' <span class="res res-C" title="Clasificado a playoffs">C</span>' : '' }) + '</td>' +
        '<td style="' + bg(recPct(r), SC.recB, rRec) + '">' + r.W + '-' + r.L + (anyTies ? '-' + r.T : '') + '</td>' +
        '<td style="' + bg(r.PF, SC.pos, rPF) + '">' + pts(r.PF) + '</td>' +
        '<td style="' + bg(p, SC.neg, rPA) + '">' + pts(p) + '</td>' +
        '<td style="' + bg(d, SC.good0, rDIF) + '">' + signed(d) + '</td>' +
        '<td style="' + bg(gwPct(r), SC.recB, rGW) + '">' + g.W + '-' + g.L + '</td>' +
        '<td style="' + bg(pwr[r.managerId].PWR, SC.pwrB, rPWR) + '">' + signed(pwr[r.managerId].PWR) + '</td>' +
        '<td style="' + bg(streakVal(r), SC.streak, rStreak) + '">' + f.streak + '</td>' +
        '<td class="form-col"><span class="form">' + f.last5.slice().reverse().map(resultBadge).join('') + '</span></td>' +
        '</tr>';
    }).join('');

    // Pills: Tabla (standings) | Tabla xS | VS. The last two are the same
    // tables Estadísticas used to show, with the doc's title + description.
    var VIEWS = [{ id: 'tabla', label: 'Tabla' }, { id: 'xs', label: 'Tabla xS', code: 'STD xW' }, { id: 'vs', label: 'VS', code: 'VS' }];
    var view = VIEWS.filter(function (v) { return v.id === params.vista; })[0] || VIEWS[0];
    var pills = '<div class="stat-selector">' + VIEWS.map(function (v) {
      return '<button type="button" class="stat-btn' + (v === view ? ' active' : '') + '" data-vista="' + v.id + '">' + v.label + '</button>';
    }).join('') + '</div>';
    var inner = view.code
      ? '<div class="stat-head"><h3 class="box-title stat-title">' + esc(TITLE[view.code]) + '</h3><p class="box-desc">' + esc(DESC[view.code]) + '</p></div>' +
        (C.playedWeeks.length ? statTable(view.code, C) : '<p class="box-note">Aún no hay semanas terminadas.</p>')
      : '<div class="table-scroll"><table class="data-table standings">' + '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
        '<p class="box-note">Desempate: puntos a favor (PF)</p>';

    var html = seasonPicker('posiciones-season', year) + playoffsBox(year) +
      '<div class="solid-box">' + pills + inner + '</div>';

    html += '<div class="solid-box"><h3 class="box-title">Posición por semana</h3>' + bumpChart(C, xs) + '</div>';

    var sec = $('#section-posiciones');
    sec.innerHTML = html;
    var go = function (y, v) { setParams('posiciones', { temporada: y === st.current ? null : y, vista: v === 'tabla' ? null : v }); };
    bindSeasonSelect(sec, year, function (y) { go(y, view.id); });
    $all('.stat-btn[data-vista]', sec).forEach(function (b) { b.addEventListener('click', function () { go(year, b.dataset.vista); }); });
    bindBump(sec);
  }

  function playoffsBox(year) {
    var P = S.computePlayoffs(st.league.teamSeasons, year);
    if (!P.champion) return '';
    function card(cls, label, t) {
      return '<div class="po-card po-card-' + cls + '"><div class="po-card-label">' + label + '</div>' +
        '<div class="po-card-team">' + esc(t.team) + '</div><div class="po-card-mgr">' + esc(mgrName(t.managerId)) + '</div></div>';
    }
    return '<div class="solid-box"><h3 class="box-title">Playoffs</h3><div class="po-cards">' +
      card('c', 'Campeón', P.champion) + (P.runnerUp ? card('r', 'Subcampeón', P.runnerUp) : '') +
      (P.semifinalists || []).map(function (t) { return card('s', 'Semifinalista', t); }).join('') +
      '</div></div>';
  }

  // Bump chart (standings position after each week), plain SVG.
  var PALETTE = ['#2d9ee0', '#f2c14e', '#e8505b', '#4cc38a', '#b07cf2', '#f28c3a', '#5fd3d8', '#ef6fb0', '#a3b53c', '#c9ced6'];
  function bumpChart(C, xs) {
    var weeks = C.playedWeeks, n = C.teams.length;
    if (weeks.length < 2) return '<p class="box-note">Disponible a partir de la semana 2.</p>';
    var W = 900, H = 40 + n * 34, L = 40, R = 190, T = 24, B = 28;
    var x = function (i) { return L + i * (W - L - R) / (weeks.length - 1); };
    var y = function (p) { return T + (p - 1) * (H - T - B) / (n - 1); };
    var last = weeks[weeks.length - 1];
    var rows = C.teams.map(function (t) { return xs[t.managerId]; })
      .sort(function (a, b) { return a.weeks[last] - b.weeks[last]; });
    var svg = '<svg class="bump" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Posición por semana">';
    weeks.forEach(function (w, i) {
      svg += '<line class="grid" x1="' + x(i) + '" x2="' + x(i) + '" y1="' + (T - 10) + '" y2="' + (H - B + 6) + '"/>' +
        '<text class="axis" x="' + x(i) + '" y="' + (H - 6) + '">S' + w + '</text>';
    });
    var cutY = (y(C.playoffSpots) + y(C.playoffSpots + 1)) / 2;
    svg += '<line class="cut" x1="' + (L - 14) + '" x2="' + (W - R + 14) + '" y1="' + cutY + '" y2="' + cutY + '"/>';
    for (var p = 1; p <= n; p++) svg += '<text class="axis pos" x="' + (L - 22) + '" y="' + (y(p) + 4) + '">' + p + '</text>';
    rows.forEach(function (r, k) {
      var c = PALETTE[k % PALETTE.length];
      var ptsStr = weeks.map(function (w, i) { return x(i) + ',' + y(r.weeks[w]); }).join(' ');
      svg += '<g class="bump-line" data-m="' + esc(r.managerId) + '" style="--c:' + c + '">' +
        '<polyline points="' + ptsStr + '"/>' +
        weeks.map(function (w, i) { return '<circle cx="' + x(i) + '" cy="' + y(r.weeks[w]) + '" r="4.5"><title>' + esc(r.team) + ' · S' + w + ': ' + r.weeks[w] + 'º</title></circle>'; }).join('') +
        '<text class="bump-label" x="' + (W - R + 16) + '" y="' + (y(r.weeks[last]) + 4) + '">' + esc(r.team) + '</text></g>';
    });
    return '<div class="bump-wrap">' + svg + '</svg></div><p class="box-note">Pasa el cursor (o toca) una línea para resaltarla.</p>';
  }
  function bindBump(root) {
    $all('.bump-line', root).forEach(function (g) {
      var on = function () { root.querySelector('.bump').classList.add('has-focus'); g.classList.add('focus'); };
      var off = function () { root.querySelector('.bump').classList.remove('has-focus'); g.classList.remove('focus'); };
      g.addEventListener('mouseenter', on); g.addEventListener('mouseleave', off);
      g.addEventListener('click', function () { g.classList.contains('focus') ? off() : (off(), on()); });
    });
  }

  // ---------------------------------------------------------------- RESULTADOS

  // Resultados has two views (Stage 8): por semana (default) and por equipo.
  function resultadosViewSwitch(view) {
    return '<nav class="grp-tabs res-views">' +
      '<button type="button" class="grp-tab' + (view === 'semana' ? ' active' : '') + '" data-vista="semana">Por semana</button>' +
      '<button type="button" class="grp-tab' + (view === 'equipo' ? ' active' : '') + '" data-vista="equipo">Por equipo</button></nav>';
  }

  function renderResultadosEquipo(year, params) {
    var C = computed(year), std = sorted(C.tables.STD.rows);
    var teams = std.slice().sort(function (a, b) { return String(a.team).localeCompare(String(b.team), 'es'); });
    var sel = teams.filter(function (t) { return t.managerId === params.equipo; })[0] || std[0];
    var id = sel.managerId;
    var opts = teams.map(function (t) {
      return '<option value="' + esc(t.managerId) + '"' + (t === sel ? ' selected' : '') + '>' + esc(t.team) + '</option>';
    }).join('');
    var rec = sel.W + '-' + sel.L + (sel.T ? '-' + sel.T : '');
    // header: team, manager and record, one item per line (Stage 8: no standings info on this page)
    var picker = '';
    var head = '<div class="team-strip"><div class="team-strip-id"><label class="title-pick"><h3 class="box-title">' + esc(sel.team) + '</h3><span class="title-pick-ic" aria-hidden="true"></span>' +
      '<select id="res-team" aria-label="Equipo">' + opts + '</select></label><div class="team-head-sub">' + esc(mgrName(id)) + '</div></div>' +
      '<div class="team-strip-rec"><span class="tile-label">Récord</span><b>' + rec + '</b></div></div>';
    // every game of the team, in week order (regular season + its playoff games)
    var list = [];
    seasonWeeks(year).forEach(function (w) {
      matchups(year, w.week).forEach(function (m) {
        if (m.top.managerId !== id && m.bottom.managerId !== id) return;
        var me = m.top.managerId === id ? m.top : m.bottom, opp = me === m.top ? m.bottom : m.top;
        list.push({ m: m, me: me, opp: opp, week: w.week, type: w.type });
      });
    });
    function wkLink(x, txt) { return '<a class="link" href="#resultados?temporada=' + year + '&semana=' + x.week + '">' + txt + '</a>'; }
    function wkName(x) { return x.type === 'REG' ? 'S' + x.week : x.type; }
    var games;
    // Style A: game log, one row per game
    games = '<div class="glog">' + list.map(function (x) {
      var done = x.m.status === 'FINAL', r = done ? x.me.result : null;
      var scored = done && isNum(x.me.pf) && isNum(x.opp.pf);   // 2023-2025 playoffs: result only
      var right = done && !scored ? ''
        : done
        ? '<div class="glog-score"><span class="glog-me">' + decSpan(pts(x.me.pf)) + '</span><span class="glog-sep">–</span><span class="glog-opp-pts">' + decSpan(pts(x.opp.pf)) + '</span></div>' +
          '<div class="glog-margin ' + (r === 'W' ? 'up' : r === 'L' ? 'down' : '') + '">' + signed(x.me.pf - x.opp.pf) + '</div>'
        : '<div class="glog-score glog-next">' + statusChip(x.m.status) + '</div><div class="glog-margin muted">' + esc(recordOf(year, x.opp.managerId)) + '</div>';
      return '<div class="glog-row' + (r ? ' is-' + r : '') + (done ? '' : ' is-next') + '">' +
        '<div class="glog-wk"' + (x.type !== 'REG' ? ' title="' + (x.type === 'F' ? 'Final' : 'Semifinal') + '"' : '') + '>' + wkLink(x, wkName(x)) + '</div>' +
        '<div class="glog-res">' + (done ? resultBadge(r) : '') + '</div>' +
        '<div class="glog-opp"><span class="glog-vs">vs</span>' + teamCell(x.opp) + '</div>' + right + '</div>';
    }).join('') + '</div>';
    // one toolbar row: view switch left, season (+ team) right (Stage 8)
    return seasonPicker('resultados-season', year) + '<div class="solid-box">' + resultadosViewSwitch('equipo') +
      '<div class="res-wrap">' + picker + head + games + '</div></div>';
  }

  function renderResultados(params) {
    var year = Number(params.temporada) || st.current;
    if (!st.seasons[year]) year = st.current;
    var view = params.vista === 'equipo' ? 'equipo' : 'semana';
    if (view === 'equipo') {
      var secE = $('#section-resultados');
      secE.innerHTML = renderResultadosEquipo(year, params);
      var goE = function (y, team) { setParams('resultados', { temporada: y === st.current ? null : y, vista: 'equipo', equipo: team }); };
      bindSeasonSelect($('.page-head', secE), year, function (y) { goE(y, params.equipo); });
      $('#res-team', secE).addEventListener('change', function (e) { goE(year, e.target.value); });
      $all('.res-views .grp-tab', secE).forEach(function (b) {
        b.addEventListener('click', function () { if (b.dataset.vista === 'semana') setParams('resultados', { temporada: year === st.current ? null : year }); });
      });
      return;
    }
    var weeks = seasonWeeks(year);
    var def = lastFinalWeek(year) || weeks[0].week;
    var week = Number(params.semana) || def;
    if (!weeks.some(function (w) { return w.week === week; })) week = def;
    var wi = weeks.map(function (w) { return w.week; }).indexOf(week);
    var wtype = weeks[wi].type;

    var weekBtns = '<div class="week-strip">' + weeks.map(function (w) {
      var lbl = w.type === 'REG' ? w.week : (w.type === 'F' ? 'F' : 'SF');
      return '<button type="button" class="week-btn' + (w.week === week ? ' active' : '') + '" data-week="' + w.week + '">' + lbl + '</button>';
    }).join('') + '</div>';

    var ms = matchups(year, week);
    var a = weekAwards(year, week);
    // Stage 8 layout: toolbar row (view switch | season), then a header strip:
    // week title as a picker between the arrows. The week average is the PROM row of
    // "Puntajes de la semana" (same as every stat table), not a line under the matches.
    var weekDone = a && a.teams === ms.length * 2;
    var hitos = wtype === 'REG' && weekDone ? weekMilestones(year, week) : [];
    var weekOpts = weeks.map(function (w) {
      return '<option value="' + w.week + '"' + (w.week === week ? ' selected' : '') + '>' + weekLabel(w.type, w.week) + '</option>';
    }).join('');
    var html = seasonPicker('resultados-season', year) + '<div class="solid-box">' + resultadosViewSwitch('semana') +
      '<div class="team-strip"><div class="week-pick-row">' +
      '<button type="button" class="nav-btn" id="week-prev"' + (wi === 0 ? ' disabled' : '') + ' aria-label="Semana anterior">&#9664;</button>' +
      '<label class="title-pick"><h3 class="box-title">' + weekLabel(wtype, week) + '</h3><span class="title-pick-ic" aria-hidden="true"></span>' +
      '<select id="res-week" aria-label="Semana">' + weekOpts + '</select></label>' +
      '<button type="button" class="nav-btn" id="week-next"' + (wi === weeks.length - 1 ? ' disabled' : '') + ' aria-label="Semana siguiente">&#9654;</button></div>' +
      '</div>' +
      '<div class="matchups-grid">' + ms.map(function (m) { return matchupCard(m); }).join('') + '</div>' +
      '</div>';

    if (weekDone && wtype === 'REG') {   // playoff weeks get no Highlights (Stage 8)
      html += '<div class="solid-box"><h3 class="box-title">Highlights</h3>' + awardsHtml(a) + milestonesHtml(hitos) + '</div>';
      html += '<div class="solid-box ws-box"><h3 class="box-title">Puntajes de la semana</h3>' + weekScores(year, week, a) + '</div>';
    }

    var sec = $('#section-resultados');
    sec.innerHTML = html;
    var go = function (y, w) { setParams('resultados', { temporada: y === st.current ? null : y, semana: w }); };
    bindSeasonSelect($('.page-head', sec), year, function (y) { go(y, null); });
    $('#res-week', sec).addEventListener('change', function (e) { go(year, Number(e.target.value)); });
    $all('.week-btn', sec).forEach(function (b) { b.addEventListener('click', function () { go(year, Number(b.dataset.week)); }); });
    var prev = $('#week-prev', sec), next = $('#week-next', sec);
    prev.addEventListener('click', function () { if (wi > 0) go(year, weeks[wi - 1].week); });
    next.addEventListener('click', function () { if (wi < weeks.length - 1) go(year, weeks[wi + 1].week); });
    $all('.res-views .grp-tab', sec).forEach(function (b) {
      b.addEventListener('click', function () { if (b.dataset.vista === 'equipo') setParams('resultados', { temporada: year === st.current ? null : year, vista: 'equipo' }); });
    });
  }

  // Week milestones (Stage 8): clinched playoff spots, then each team's own career / season bests.
  var MIN_PRIOR = 3;
  function weekMilestones(year, week) {
    var out = [], all = [];
    Object.keys(st.seasons).forEach(function (y) {
      st.seasons[y].games.forEach(function (g) { if (g.type === 'REG' && g.status === 'FINAL' && isNum(g.pf)) all.push(g); });
    });
    var before = function (g) { return g.season < year || (g.season === year && g.week < week); };
    clinchedInWeek(year, week).forEach(function (id) {
      var g = st.seasons[year].games.filter(function (x) { return x.managerId === id; })[0];
      out.push({ kind: 'clinch', row: g });
    });
    var bests = [];
    st.seasons[year].games.filter(function (g) { return g.week === week && g.type === 'REG' && g.status === 'FINAL' && isNum(g.pf); }).forEach(function (g) {
      // listed only while it still stands: no other game of the manager is higher (ever / that season)
      var career = all.filter(function (x) { return x.managerId === g.managerId && x !== g; });
      var season = career.filter(function (x) { return x.season === year; });
      var priorC = career.filter(before).length, priorS = season.filter(before).length;
      var top = function (l) { return l.every(function (x) { return x.pf <= g.pf; }); };
      if (priorC >= MIN_PRIOR && top(career)) bests.push({ kind: 'career', row: g });
      else if (priorS >= MIN_PRIOR && top(season)) bests.push({ kind: 'season', row: g });
    });
    bests.sort(function (x, y) { return (x.kind === y.kind ? 0 : x.kind === 'career' ? -1 : 1) || y.row.pf - x.row.pf; });
    return out.concat(bests);
  }
  function clinchedInWeek(year, week) {
    var games = st.seasons[year].games, spots = computed(year).playoffSpots;
    function asOf(w) {
      return S.computeClinched(games.map(function (g) { return g.week > w && g.status === 'FINAL' ? Object.assign({}, g, { status: 'SCHEDULED', result: null }) : g; }), year, { playoffSpots: spots });
    }
    var now = asOf(week), prev = asOf(week - 1);
    return Object.keys(now).filter(function (id) { return !prev[id]; });
  }
  // More Highlights subsections after Equipos / Partidos: who clinched, then personal records.
  function milestonesHtml(list) {
    if (!list.length) return '';
    var cl = list.filter(function (h) { return h.kind === 'clinch'; }), pr = list.filter(function (h) { return h.kind !== 'clinch'; });
    var block = function (title, cls, items) { return items.length ? '<div class="hl-group"><h5 class="hl-head">' + title + '</h5><ul class="wn-list ' + cls + '">' + items.join('') + '</ul></div>' : ''; };
    return block('Clasificados a playoffs', 'wn-clinch', cl.map(function (h) { return '<li>' + teamCell(h.row) + '</li>'; })) +
      block('Récords personales', 'wn-recs', pr.map(function (h) {
        return '<li>' + teamCell(h.row) + '<span class="wn-val">' + pts(h.row.pf) + '</span>' +
          '<span class="hl-badge ' + (h.kind === 'career' ? 'rec-league' : 'rec-season') + '">' + (h.kind === 'career' ? 'Mejor histórico' : 'Mejor de la temporada') + '</span></li>';
      }));
  }

  // Every team's score that week, ranked (Stage 8 redesign).
  function weekScores(year, week, a) {
    var rows = st.seasons[year].games.filter(function (g) { return g.week === week && g.status === 'FINAL'; })
      .sort(function (x, y) { return y.pf - x.pf; });
    var vps = rows.map(function (g) { return isNum(g.projPf) ? g.pf - g.projPf : null; });
    var rVP = rangeOf(vps);
    function vpCell(v) { return '<span class="ws-vp" style="' + bg(v, SC.good0, rVP) + '">' + (isNum(v) ? signed(v) : '–') + '</span>'; }
    // bars start at 0, so lengths compare honestly; the average is a line across all bars
    var max = Math.max.apply(null, rows.map(function (g) { return g.pf; }));
    var pct = function (v) { return (100 * v / max).toFixed(2) + '%'; };
    var avgAt = pct(a.avg);
    return '<div class="ws ws-bars"><div class="ws-row ws-head"><span>#</span><span>Equipo</span>' +
      '<span class="ws-bar"><span class="ws-avg-label" style="left:' + avgAt + '">Promedio ' + decSpan(pts(a.avg)) + '</span></span><span class="ws-vp-h">vs Proy.</span></div>' +
      rows.map(function (g, i) {
        return '<div class="ws-row"><span class="ws-rk">' + (i + 1) + '</span>' +
          '<span class="ws-team">' + teamCell(g) + resultBadge(g.result) + '</span>' +
          '<span class="ws-bar"><span class="ws-fill' + (g.pf >= a.avg ? ' over' : '') + '" style="width:' + pct(g.pf) + '"></span>' +
          '<span class="ws-avg-line" style="left:' + avgAt + '"></span><span class="ws-val">' + decSpan(pts(g.pf)) + '</span></span>' +
          vpCell(vps[i]) + '</div>';
      }).join('') + '</div>';
  }

  // ---------------------------------------------------------------- ESTADÍSTICAS

  // Codes, titles and descriptions come from the 2020-2025 season docs
  // (tab name, cell B2, cell B3), with accents restored.
  var CODE = {
    'PF': 'PF', 'PA': 'PC', 'DIF': 'DIF', 'PR PF': 'PR PF', 'PR PA': 'PR PC', 'PF vsPR': 'PF vsPR', 'PA vsPR': 'PC vsPR',
    'PR PFvsPA': 'PR PFvsPC', 'Rk PF': 'Rk PF', 'Rk PA': 'Rk PC', 'Rk PF TOT': 'Rk PF TOT', 'Rk PA TOT': 'Rk PC TOT',
    'PF W': 'PF G', 'PF L': 'PF P', 'PA W': 'PC G', 'PA L': 'PC P', 'GW': 'TG', 'PWR': 'PWR', 'STD xW': 'Tabla xS', 'VS': 'VS'
  };
  var TITLE = {
    'PF': 'Puntos a favor', 'PA': 'Puntos en contra', 'DIF': 'Diferencia de puntos',
    'PR PF': 'Puntos proyectados a favor', 'PR PA': 'Puntos proyectados en contra',
    'PF vsPR': 'Puntos a favor vs puntos proyectados', 'PA vsPR': 'Puntos en contra vs puntos proyectados',
    'PR PFvsPA': 'Puntos proyectados a favor vs puntos proyectados en contra',
    'Rk PF': 'Ranking semanal de puntos a favor', 'Rk PA': 'Ranking semanal de puntos en contra',
    'Rk PF TOT': 'Ranking anual de puntos a favor', 'Rk PA TOT': 'Ranking anual de puntos en contra',
    'PF W': 'Puntos a favor en triunfos', 'PF L': 'Puntos a favor en derrotas',
    'PA W': 'Puntos en contra en triunfos', 'PA L': 'Puntos en contra en derrotas',
    'GW': 'Triunfos globales', 'PWR': 'Power Ranking', 'STD xW': 'Tabla por semana', 'VS': 'Récord vs rivales'
  };
  var DESC = {
    'PF': 'Puntos conseguidos por cada equipo por semana',
    'PA': 'Puntos del rival de cada equipo por semana',
    'DIF': 'Diferencia de puntos de cada equipo vs su rival por semana. Un número positivo significa que el equipo ganó ese partido.',
    'PR PF': 'Puntos proyectados por cada equipo por semana',
    'PR PA': 'Puntos proyectados del rival de cada equipo por semana',
    'PF vsPR': 'Puntos conseguidos menos puntos proyectados de cada equipo por semana. Un número positivo significa que superó su proyección.',
    'PA vsPR': 'Puntos conseguidos menos puntos proyectados del rival de cada equipo por semana. Un número positivo significa que el rival superó su proyección.',
    'PR PFvsPA': 'Diferencia de puntos proyectados de cada equipo vs los puntos proyectados de su rival cada semana. Un número positivo significa que el equipo era el favorito.',
    'Rk PF': 'Ranking por semana de puntos conseguidos por cada equipo con respecto al resto de la liga',
    'Rk PA': 'Ranking por semana de los puntos del rival de cada equipo con respecto al resto de la liga',
    'Rk PF TOT': 'Ranking de puntos conseguidos por cada equipo cada semana con respecto a todos los demás puntajes de la temporada',
    'Rk PA TOT': 'Ranking de puntos conseguidos por el rival de cada equipo cada semana con respecto a todos los demás puntajes de la temporada',
    'PF W': 'Puntos conseguidos por cada equipo por semana en partidos ganados',
    'PF L': 'Puntos conseguidos por cada equipo por semana en partidos perdidos',
    'PA W': 'Puntos del rival de cada equipo por semana en partidos ganados',
    'PA L': 'Puntos del rival de cada equipo por semana en partidos perdidos',
    'GW': 'Total de triunfos de cada equipo si enfrentara a todos los demás equipos de la liga cada semana',
    'PWR': 'Promedio de PF vs la mediana de la liga en los últimos 5 partidos de cada equipo',
    'STD xW': 'Lugar en la tabla general de cada equipo tras cada semana',
    'VS': 'Récord de cada equipo vs cada rival'
  };
  var GROUPS = [
    { id: 'puntos', label: 'Puntos', tables: ['PF', 'PA', 'DIF', 'PR PF', 'PR PA', 'PF vsPR', 'PA vsPR', 'PR PFvsPA', 'PF W', 'PF L', 'PA W', 'PA L'] },
    { id: 'rankings', label: 'Rankings', tables: ['Rk PF', 'Rk PA', 'Rk PF TOT', 'Rk PA TOT'] },
    { id: 'otras', label: 'Otras', tables: ['GW', 'PWR'] }
  ];

  function dec1(v) { return fmt(v, 1); }
  function str(v) { return String(v); }

  // Per table, mirroring that tab in the 2025 doc:
  //   cols: summary columns [key, label, format, scale, joint?] (joint = shares
  //         one range with the other joint column, like the doc's MAX:MIN range)
  //   week: weekly-cell scale + format; foot: PROM-row scale (if the doc has one).
  function spec(code, C) {
    var half = Math.floor(C.teams.length / 2);
    function pointsCols(tot, pa, signedFmt) {
      var f = signedFmt ? signed : pts;
      var good = signedFmt ? SC.good0 : SC.pos, bad = signedFmt ? SC.bad0 : SC.neg;
      return (tot ? [['TOT', tot, f, pa ? bad : good]] : []).concat([
        ['AVG', 'PROM', f, pa ? bad : good],
        ['MAX', 'MÁX', f, pa ? SC.mmPa : SC.mm, true],
        ['MIN', 'MÍN', f, pa ? SC.mmPa : SC.mm, true]]);
    }
    switch (code) {
      case 'PF': case 'PR PF':
        return { cols: pointsCols(CODE[code], false), week: SC.wkPf, fmt: pts, foot: SC.footPf };
      case 'PA': case 'PR PA':
        return { cols: pointsCols(CODE[code], true), week: SC.wkPa, fmt: pts, foot: SC.footPa };
      case 'DIF': case 'PF vsPR':
        return { cols: pointsCols('DIF', false, true), week: SC.div, fmt: signed, foot: SC.footPf };
      case 'PA vsPR':
        return { cols: pointsCols('DIF', true, true), week: SC.divInv, fmt: signed, foot: SC.footPa };
      case 'PR PFvsPA':
        return { cols: [['FAVP', 'FAV', str, SC.recB, false, function (r) { return r.FAV + '-' + r.UND; }],
          ['MAX', 'MÁX', signed, SC.mm, true], ['MIN', 'MÍN', signed, SC.mm, true]], week: SC.div, fmt: signed, foot: SC.footPf };
      case 'Rk PF':
        return { cols: [['AVG', 'PROM', dec1, SC.greenDown], ['TOP1', 'TOP1', str, SC.blueUp], ['TOPHALF', 'TOP' + half, str, SC.blueUp],
          ['BOTHALF', 'PEOR' + half, str, SC.purpleUp], ['BOT1', 'PEOR1', str, SC.purpleUp]], week: SC.accentDown, fmt: str };
      case 'Rk PA':
        return { cols: [['AVG', 'PROM', dec1, SC.redDown], ['TOP1', 'TOP1', str, SC.purpleUp], ['TOPHALF', 'TOP' + half, str, SC.purpleUp],
          ['BOTHALF', 'PEOR' + half, str, SC.blueUp], ['BOT1', 'PEOR1', str, SC.blueUp]], week: SC.magentaDown, fmt: str };
      case 'Rk PF TOT': case 'Rk PA TOT':
        var pa = code === 'Rk PA TOT';
        return { cols: [['AVG', 'PROM', dec1, pa ? SC.redDown : SC.greenDown]].concat(
          ['TOP10', 'TOP25', 'TOP50', 'BOT50', 'BOT25', 'BOT10'].map(function (k) {
            var top = k[0] === 'T';
            return [k, (top ? k : 'PEOR' + k.slice(3)) + '%', pct, (top !== pa) ? SC.blueUp : SC.purpleUp];
          })), week: pa ? SC.magentaDown : SC.accentDown, fmt: str };
      case 'PF W': case 'PF L':
        return { cols: pointsCols(null, false), week: SC.wkPf, fmt: pts, foot: SC.footPf };
      case 'PA W': case 'PA L':
        return { cols: pointsCols(null, true), week: SC.wkPa, fmt: pts, foot: SC.footPa };
      case 'GW':
        return { cols: [['WLP', 'G-P', str, SC.recB, false, function (r) { return r.W + '-' + r.L; }]], week: SC.count, fmt: str };
      case 'PWR':
        return { cols: [['PWR', 'PWR', signed, SC.pwrB]], week: SC.div, fmt: signed };
      case 'STD xW':
        return { cols: [['AVG', 'PROM', dec1, SC.greenDown], ['TOP_PO_PCT', 'TOP' + C.playoffSpots + ' %', pct, SC.good3],
          ['BEST', 'TOP', str, SC.rank], ['WORST', 'PEOR', str, SC.rank]],
          week: [K.wkWin, K.grey, K.wkLoss, C.playoffSpots + 1], fmt: str };
    }
    return null;
  }

  function statTable(code, C) {
    if (code === 'VS') return vsTable(C);
    var T = C.tables[code], sp = spec(code, C);
    var rows = sorted(T.rows);
    // merged record columns (Stage 8): colored by share, shown as W-L / FAV-UND
    rows.forEach(function (r) {
      if (code === 'GW') r.WLP = r.W + r.L ? r.W / (r.W + r.L) : null;
      if (code === 'PR PFvsPA') r.FAVP = r.FAV + r.UND ? r.FAV / (r.FAV + r.UND) : null;
    });
    // Every regular-season week has a column (Stage 8); weeks not played yet are empty.
    var played = C.playedWeeks, weeks = [];
    for (var wk = 1; wk <= C.regWeeks; wk++) weeks.push(wk);
    // PWR only counts its last-5-weeks window, so only those weeks are shown (Stage 8).
    if (code === 'PWR' && T.window) { weeks = T.window.slice(); played = T.window.slice(); }
    var wVals = [];
    rows.forEach(function (r) { played.forEach(function (w) { wVals.push(r.weeks[w]); }); });
    var wr = rangeOf(wVals);
    var rR = rangeOf(rows.map(function (r) { return r.R; }));
    var jointR = rangeOf([].concat.apply([], sp.cols.filter(function (c) { return c[4]; }).map(function (c) {
      return rows.map(function (r) { return r[c[0]]; });
    })));
    var colR = sp.cols.map(function (c) { return c[4] ? jointR : rangeOf(rows.map(function (r) { return r[c[0]]; })); });

    var head = '<tr><th>R</th><th class="left sticky-col">Equipo</th>' +
      sp.cols.map(function (c) { return '<th class="sum">' + c[1] + '</th>'; }).join('') +
      weeks.map(function (w) { return '<th class="wk">S' + w + '</th>'; }).join('') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr><td class="rk" style="' + bg(r.R, SC.rank, rR) + '">' + (isNum(r.R) ? r.R : '') + '</td>' +
        '<td class="left sticky-col team-td">' + teamCell(r, { noPhoto: code !== 'STD xW' }) + '</td>' +
        sp.cols.map(function (c, i) {
          var v = r[c[0]];
          return '<td class="sum" style="' + bg(v, c[3], colR[i]) + '">' + (isNum(v) ? (c[5] ? c[5](r) : c[2](v)) : '') + '</td>';
        }).join('') +
        weeks.map(function (w) {
          var v = r.weeks[w];
          return '<td class="wk" style="' + bg(v, sp.week, wr) + '">' + (isNum(v) ? sp.fmt(v) : '') + '</td>';
        }).join('') + '</tr>';
    }).join('');

    var foot = '';
    var F = T.footer;
    if (F && F.AVG && sp.foot) {
      var fr = rangeOf(played.map(function (w) { return F.AVG[w]; }));
      // The label sits right before the first weekly average (last summary column).
      foot = '<tr class="foot"><td class="foot-gap"></td><td class="foot-gap"></td>' +
        sp.cols.map(function (c, i) { return i === sp.cols.length - 1 ? '<td class="foot-label">PROM:</td>' : '<td class="foot-gap"></td>'; }).join('') +
        weeks.map(function (w) { var v = F.AVG[w]; return '<td class="wk" style="' + bg(v, sp.foot, fr) + '">' + (isNum(v) ? pts(v) : '') + '</td>'; }).join('') + '</tr>';
    }
    return '<div class="table-scroll"><table class="data-table stat-table" data-hide="semanas"><thead>' + head + '</thead><tbody>' + body + '</tbody>' +
      (foot ? '<tfoot>' + foot + '</tfoot>' : '') + '</table></div>';
  }

  function vsTable(C) {
    var rows = sorted(C.tables.VS.rows);
    var rR = rangeOf(rows.map(function (r) { return r.R; }));
    var rW = rangeOf(rows.map(function (r) { return r.W; }));
    var head = '<tr><th>R</th><th class="left sticky-col">Equipo</th><th class="sum">G-P</th>' +
      rows.map(function (o) { return '<th class="wk" title="' + esc(o.team) + '">' + esc(mgrName(o.managerId)) + '</th>'; }).join('') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr><td class="rk" style="' + bg(r.R, SC.rank, rR) + '">' + r.R + '</td><td class="left sticky-col team-td">' + teamCell(r) + '</td>' +
        '<td class="sum" style="' + bg(r.W / ((r.W + r.L + r.T) || 1), SC.recB, rangeOf(rows.map(function (x) { return x.W / ((x.W + x.L + x.T) || 1); }))) + '">' + r.W + '-' + r.L + (r.T ? '-' + r.T : '') + '</td>' +
        rows.map(function (o) {
          if (o.managerId === r.managerId) return '<td class="wk self"></td>';
          var v = r.vs[o.managerId];
          if (!v || !(v.W + v.L + v.T)) return '<td class="wk"></td>';
          var st2 = v.W > v.L ? wlStyle('W') : v.L > v.W ? wlStyle('L') : 'background:' + K.grey;
          return '<td class="wk" style="' + st2 + '">' + v.W + '-' + v.L + (v.T ? '-' + v.T : '') + '</td>';
        }).join('') + '</tr>';
    }).join('');
    return '<div class="table-scroll"><table class="data-table stat-table vs-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
  }

  function renderEstadisticas(params, sub) {
    // The all-time tables live in Historia > Estadísticas (Stage 8); old links go there.
    if (params.temporada === 'historico') { location.replace(buildHash('historia/estadisticas', { tabla: params.tabla })); return; }
    var hist = false;
    var year = hist ? 'historico' : (Number(params.temporada) || st.current);
    if (!hist && !st.seasons[year]) year = st.current;
    var groups = hist ? HIST_GROUPS : GROUPS;
    var group = groups.filter(function (g) { return g.id === sub; })[0] || groups[0];
    var code = group.tables.indexOf(params.tabla) >= 0 ? params.tabla : group.tables[0];
    var tParam = year === st.current ? null : year;
    var label = function (c) { return hist ? HIST_LABEL[c] : CODE[c]; };

    // two levels, two looks: categories = tab bar with underline, tables = small chips (Stage 8)
    var subnav = '<nav class="grp-tabs">' + groups.map(function (g) {
      return '<a class="grp-tab' + (g === group ? ' active' : '') + '" href="' + buildHash('estadisticas/' + g.id, { temporada: tParam }) + '">' + g.label + '</a>';
    }).join('') + '</nav>';
    var sel = group.tables.length > 1 ? '<div class="stat-selector">' + group.tables.map(function (c) {
      return '<button type="button" class="stat-btn' + (c === code ? ' active' : '') + '" data-code="' + esc(c) + '">' + esc(label(c)) + '</button>';
    }).join('') + '</div>' : '';

    var body;
    if (hist) body = histStatTable(code);
    else {
      var C = computed(year);
      body = C.playedWeeks.length ? statTable(code, C) : '<p class="box-note">Aún no hay semanas terminadas.</p>';
    }
    var html = seasonPicker('stats-season', year) +
      '<div class="solid-box">' + subnav + sel +
      '<div class="stat-head"><h3 class="box-title stat-title">' + esc(hist ? HIST_TITLE[code] : TITLE[code]) + '</h3>' +
      '<p class="box-desc">' + esc(hist ? HIST_DESC[code] : DESC[code]) + '</p></div>' + body + '</div>';

    var sec = $('#section-estadisticas');
    sec.innerHTML = html;
    bindSeasonSelect(sec, year, function (y) {
      setParams('estadisticas/' + group.id, { temporada: y === st.current ? null : y, tabla: code === group.tables[0] ? null : code });
    });
    $all('.stat-btn', sec).forEach(function (b) {
      b.addEventListener('click', function () {
        setParams('estadisticas/' + group.id, { temporada: tParam, tabla: b.dataset.code === group.tables[0] ? null : b.dataset.code });
      });
    });
  }

  // ---------- Historia > Estadísticas (all-time tables; was Estadísticas > Histórico) ----------
  function histStats(params) {
    var all = HIST_GROUPS.reduce(function (a, g) { return a.concat(g.tables); }, []);
    var code = all.indexOf(params.tabla) >= 0 ? params.tabla : all[0];
    // one row of the usual chips, no categories (the page already has a tab bar)
    var chips = '<div class="stat-selector hist-chips">' + all.map(function (c) {
      return '<button type="button" class="stat-btn' + (c === code ? ' active' : '') + '" data-code="' + esc(c) + '">' + esc(HIST_LABEL[c]) + '</button>';
    }).join('') + '</div>';
    return '<div class="solid-box">' + chips +
      '<div class="stat-head"><h3 class="box-title stat-title">' + esc(HIST_TITLE[code]) + '</h3>' +
      '<p class="box-desc">' + esc(HIST_DESC[code]) + '</p></div>' + histStatTable(code) + '</div>';
  }
  function bindHistStats(sec) {
    $all('.hist-chips .stat-btn', sec).forEach(function (b) {
      b.addEventListener('click', function () { setParams('historia/estadisticas', { tabla: b.dataset.code === 'PF T' ? null : b.dataset.code }); });
    });
  }

  // ---------- all-time table definitions ----------
  var HIST_GROUPS = [
    { id: 'puntos', label: 'Puntos', tables: ['PF T', 'PF P', 'PA T', 'PA P'] },
    { id: 'rankings', label: 'Rankings', tables: ['TOP PF', 'BOT PF', 'TOP PA', 'BOT PA'] },
    { id: 'otras', label: 'Otras', tables: ['GW'] }
  ];
  var HIST_LABEL = { 'PF T': 'PF (T)', 'PF P': 'PF (P)', 'PA T': 'PC (T)', 'PA P': 'PC (P)',
    'TOP PF': 'TOP PF', 'BOT PF': 'PEOR PF', 'TOP PA': 'TOP PC', 'BOT PA': 'PEOR PC', 'GW': 'TG' };
  var HIST_TITLE = {
    'PF T': 'Puntos a favor totales', 'PF P': 'Puntos a favor por semana',
    'PA T': 'Puntos en contra totales', 'PA P': 'Puntos en contra por semana',
    'TOP PF': 'Mejor puntaje de la semana', 'BOT PF': 'Peor puntaje de la semana',
    'TOP PA': 'Rival con el mejor puntaje de la semana', 'BOT PA': 'Rival con el peor puntaje de la semana',
    'GW': 'Triunfos globales'
  };
  var HIST_DESC = {
    'PF T': 'Total de puntos conseguidos por cada manager en cada temporada',
    'PF P': 'Promedio de puntos por semana de cada manager en cada temporada. PROM = promedio de toda su carrera',
    'PA T': 'Total de puntos del rival de cada manager en cada temporada',
    'PA P': 'Promedio de puntos por semana del rival de cada manager en cada temporada. PROM = promedio de toda su carrera',
    'TOP PF': 'Veces que cada manager tuvo el puntaje más alto de la semana (TOP1 en Rk PF)',
    'BOT PF': 'Veces que cada manager tuvo el puntaje más bajo de la semana (PEOR1 en Rk PF)',
    'TOP PA': 'Veces que el rival de cada manager tuvo el puntaje más alto de la semana (TOP1 en Rk PC)',
    'BOT PA': 'Veces que el rival de cada manager tuvo el puntaje más bajo de la semana (PEOR1 en Rk PC)',
    'GW': 'Récord de cada manager por temporada si enfrentara a todos los demás equipos cada semana. Color según % de triunfos'
  };

  function allTime() {
    if (!st.allTime) {
      var games = [], opts = {};
      st.years.slice().reverse().forEach(function (y) {
        var s = st.seasons[y];
        games = games.concat(s.games);
        opts[y] = { regWeeks: s.regWeeks, playoffSpots: s.playoffTeams || 4 };
      });
      st.allTime = S.computeAllTime(games, opts);
    }
    return st.allTime;
  }

  // Summary cols [key, label, format, scale, joint?]; cell format + scale; perSeason = one color range per season column
  // (season totals depend on the season's length).
  function histSpec(code) {
    switch (code) {
      case 'PF T': return { cols: [['TOT', 'PF', pts, SC.pos]], fmt: pts, week: SC.wkPf, perSeason: true };
      case 'PA T': return { cols: [['TOT', 'PC', pts, SC.neg]], fmt: pts, week: SC.wkPa, perSeason: true };
      case 'PF P': return { cols: [['AVG', 'PROM', pts, SC.pos], ['MAX', 'MÁX', pts, SC.mm, true], ['MIN', 'MÍN', pts, SC.mm, true]], fmt: pts, week: SC.wkPf };
      case 'PA P': return { cols: [['AVG', 'PROM', pts, SC.neg], ['MAX', 'MÁX', pts, SC.mmPa, true], ['MIN', 'MÍN', pts, SC.mmPa, true]], fmt: pts, week: SC.wkPa };
      // season cells like the yearly Rk PF (blue) / Rk PC (magenta); MÁX / MÍN = best / worst season
      case 'TOP PF': return { cols: [['TOT', 'TOT', str, SC.blueUp], ['MAX', 'MÁX', str, SC.mm, true], ['MIN', 'MÍN', str, SC.mm, true]], fmt: str, week: SC.wkPf };
      case 'BOT PF': return { cols: [['TOT', 'TOT', str, SC.purpleUp], ['MAX', 'MÁX', str, SC.mmPa, true], ['MIN', 'MÍN', str, SC.mmPa, true]], fmt: str, week: SC.wkPf };
      case 'TOP PA': return { cols: [['TOT', 'TOT', str, SC.purpleUp], ['MAX', 'MÁX', str, SC.mmPa, true], ['MIN', 'MÍN', str, SC.mmPa, true]], fmt: str, week: SC.wkPa };
      case 'BOT PA': return { cols: [['TOT', 'TOT', str, SC.blueUp], ['MAX', 'MÁX', str, SC.mm, true], ['MIN', 'MÍN', str, SC.mm, true]], fmt: str, week: SC.wkPa };
    }
    return null;
  }

  function histStatTable(code) {
    var A = allTime(), T = A.tables[code], seasons = A.seasons;
    var rows = T.rows.filter(function (r) { return seasons.some(function (s) { return r.seasons[s.season] !== null; }); });
    // TG ranked by games won, then win % (Stage 8)
    if (code === 'GW') {
      var gr = S._helpers.rankRows(rows, function (r) { return [r.W, r.pct]; }, [true, true]);
      rows = rows.map(function (r, i) { return Object.assign({}, r, { R: gr[i] }); });
    }
    rows.sort(function (a, b) { return (isNum(a.R) ? a.R : 999) - (isNum(b.R) ? b.R : 999) || mgrName(a.managerId).localeCompare(mgrName(b.managerId)); });
    var rR = rangeOf(rows.map(function (r) { return r.R; }));
    var live = seasons.filter(function (s) { return s.inProgress; })[0];
    var head = '<tr><th>R</th><th class="left sticky-col">Manager</th>';
    var cellHtml, sumHtml;
    if (code === 'GW') {
      var pcts = [];
      rows.forEach(function (r) { pcts.push(r.pct); seasons.forEach(function (s) { var c = r.seasons[s.season]; if (c) pcts.push(c.pct); }); });
      var sR = rangeOf([].concat.apply([], rows.map(function (r) { return seasons.map(function (s) { var c = r.seasons[s.season]; return c ? c.pct : null; }); })));
      var pr = rangeOf(pcts), scale = SC.recB;
      head += '<th class="sum">G-P</th>';
      sumHtml = function (r) {
        return '<td class="sum" style="' + bg(r.pct, scale, pr) + '" title="' + fmt(r.pct * 100, 1) + '%">' + r.W + '-' + r.L + '</td>';
      };
      cellHtml = function (r, s) {
        var c = r.seasons[s.season];
        return '<td class="wk" style="' + bg(c.pct, [K.violet, K.grey, K.gold, 0.5], sR) + '" title="' + fmt(c.pct * 100, 1) + '%">' + c.W + '-' + c.L + '</td>';
      };
    } else {
      var sp = histSpec(code);
      if (/^(TOP|BOT) /.test(code)) rows.forEach(function (r) {
        var done = seasons.filter(function (s) { return isNum(r.seasons[s.season]); });
        var fin = done.filter(function (s) { return !s.inProgress; }).map(function (s) { return r.seasons[s.season]; });
        r.MAX = done.length ? Math.max.apply(null, done.map(function (s) { return r.seasons[s.season]; })) : null;
        r.MIN = fin.length ? Math.min.apply(null, fin) : null;
      });
      var jointR = rangeOf([].concat.apply([], sp.cols.filter(function (c) { return c[4]; }).map(function (c) { return rows.map(function (r) { return r[c[0]]; }); })));
      var colR = sp.cols.map(function (c) { return c[4] ? jointR : rangeOf(rows.map(function (r) { return r[c[0]]; })); });
      var all = [];
      rows.forEach(function (r) { seasons.forEach(function (s) { all.push(r.seasons[s.season]); }); });
      var allR = rangeOf(all), perR = {};
      seasons.forEach(function (s) { perR[s.season] = rangeOf(rows.map(function (r) { return r.seasons[s.season]; })); });
      head += sp.cols.map(function (c) { return '<th class="sum">' + c[1] + '</th>'; }).join('');
      sumHtml = function (r) {
        return sp.cols.map(function (c, i) { var v = r[c[0]]; return '<td class="sum" style="' + bg(v, c[3], colR[i]) + '">' + (isNum(v) ? c[2](v) : '') + '</td>'; }).join('');
      };
      cellHtml = function (r, s) {
        var v = r.seasons[s.season];
        return '<td class="wk" style="' + bg(v, sp.week, sp.perSeason ? perR[s.season] : allR) + '">' + sp.fmt(v) + '</td>';
      };
    }
    head += seasons.map(function (s) { return '<th class="wk">' + s.season + (s.inProgress ? '*' : '') + '</th>'; }).join('') + '</tr>';
    var body = rows.map(function (r) {
      return '<tr><td class="rk" style="' + bg(r.R, SC.rank, rR) + '">' + (isNum(r.R) ? r.R : '') + '</td>' +
        '<td class="left sticky-col team-td"><a class="mgr-link" href="#managers/' + esc(r.managerId) + '">' + avatar(r.managerId, 'sm') + '<span>' + esc(mgrName(r.managerId)) + '</span></a></td>' +
        sumHtml(r) +
        seasons.map(function (s) { return r.seasons[s.season] === null ? '<td class="wk na"></td>' : cellHtml(r, s); }).join('') + '</tr>';
    }).join('');
    return '<div class="table-scroll"><table class="data-table stat-table hist-table" data-hide="temporadas"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="box-note">Solo temporada regular. ' + (live ? '* ' + live.season + ': temporada en curso, cuenta hasta la última semana terminada. ' : '') +
      'Celdas rayadas: el manager no jugó esa temporada.' +
      ((code === 'PF T' || code === 'PA T') ? ' Cada temporada se colorea por separado (2020 tuvo 14 semanas).' : '') + '</p>';
  }

  // ---------------------------------------------------------------- history (all seasons)

  // computeHistory over every loaded season (2026 counts live, Stage 7).
  // Not named "history": inside this IIFE that would hide window.history (replaceState).
  function leagueHistory() {
    if (!st.history) {
      var games = [], opts = {};
      st.years.slice().reverse().forEach(function (y) {
        var s = st.seasons[y];
        games = games.concat(s.games);
        opts[y] = { regWeeks: s.regWeeks, playoffSpots: s.playoffTeams || 4 };
      });
      st.history = S.computeHistory(games, st.league, opts);
    }
    return st.history;
  }

  // "2020, 2024–2026": consecutive years collapsed into ranges.
  function yearsLabel(years) {
    var out = [], a = null, b = null;
    years.slice().sort().forEach(function (y) {
      if (b !== null && y === b + 1) { b = y; return; }
      if (a !== null) out.push(a === b ? String(a) : a + '–' + b);
      a = b = y;
    });
    if (a !== null) out.push(a === b ? String(a) : a + '–' + b);
    return out.join(', ');
  }

  function recStr(t) { return t.W + '-' + t.L + (t.T ? '-' + t.T : ''); }

  // Manager photo with a designed placeholder underneath. The photo
  // (images/managers/<managerId>.jpg, square) covers it when the file exists;
  // a missing file removes the <img>, leaving the initials badge.
  function initials(m) {
    var sn = String(m.shortName || '').trim().split(/\s+/);
    if (sn.length > 1) return (sn[0][0] + sn[1][0]).toUpperCase();
    var fn = String(m.fullName || '').trim().split(/\s+/);
    return ((sn[0] || '?')[0] + (fn.length > 1 ? fn[fn.length - 1][0] : '')).toUpperCase();
  }
  function avatar(id, size) {
    var m = st.managers[id] || { shortName: id, active: true };
    return '<span class="avatar avatar-' + (size || 'md') + (m.active ? '' : ' is-former') + '" aria-hidden="true">' +
      '<span class="avatar-initials">' + esc(initials(m)) + '</span>' +
      '<img src="images/managers/' + esc(id) + '.jpg" alt="" loading="lazy" onerror="this.remove()">' +
      '</span>';
  }

  var ICON_TROPHY = '<svg class="ico-trophy" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 2h10v2h4v4a5 5 0 0 1-4.6 5A5 5 0 0 1 13 15.9V18h3.5v4h-9v-4H11v-2.1A5 5 0 0 1 7.6 13 5 5 0 0 1 3 8V4h4V2zm0 4H5v2a3 3 0 0 0 2 2.8V6zm10 0v4.8A3 3 0 0 0 19 8V6h-2z"/></svg>';

  // +/- columns on history pages: red below 0, grey at 0, green above.
  var DIF0 = SC.good0;

  var PO_LABEL = { c: 'Campeón', r: 'Subcampeón', s: 'Semifinal' };

  // ---------------------------------------------------------------- MANAGERS

  function renderManagers(params, sub) {
    if (sub) return renderPerfil(sub);
    var H = leagueHistory();
    var ids = Object.keys(H.managers).filter(function (id) { return H.managers[id].seasons.length; });
    function card(id) {
      var m = H.managers[id], t = m.totals, last = m.seasons[m.seasons.length - 1];
      var titleYears = m.seasons.filter(function (s) { return s.playoffResult === 'c'; }).map(function (s) { return s.season; });
      return '<a class="mgr-card' + (m.active ? '' : ' is-former') + '" href="#managers/' + esc(id) + '">' + avatar(id, 'md') +
        '<div class="mgr-card-body">' +
          '<div class="mgr-card-name">' + esc(m.shortName) + '</div>' +
          '<div class="mgr-card-team">' + esc(last.team) + '</div>' +
          '<div class="mgr-card-rec">' + recStr(t) + '</div>' +
          '<div class="mgr-card-seasons">' + t.seasons + (t.seasons === 1 ? ' temporada' : ' temporadas') + '</div>' +
          (titleYears.length ? '<div class="mgr-card-titles" title="Campeón ' + titleYears.join(', ') + '">' +
            titleYears.map(function (y) { return '<span class="trophy">' + ICON_TROPHY + y + '</span>'; }).join('') + '</div>' : '') +
        '</div></a>';
    }
    // Alphabetical within each section (Stage 8)
    ids.sort(function (a, b) { return H.managers[a].shortName.localeCompare(H.managers[b].shortName, 'es'); });
    var active = ids.filter(function (id) { return H.managers[id].active; });
    var former = ids.filter(function (id) { return !H.managers[id].active; });
    var html = '<div class="solid-box"><h3 class="box-title">Actuales</h3><div class="mgr-grid">' + active.map(card).join('') + '</div></div>';
    if (former.length) html += '<div class="solid-box"><h3 class="box-title">Inactivos</h3><div class="mgr-grid">' + former.map(card).join('') + '</div></div>';
    $('#section-managers').innerHTML = html;
  }

  function renderPerfil(id) {
    var H = leagueHistory(), m = H.managers[id];
    if (!m || !m.seasons.length) { location.replace('#managers'); return; }
    var t = m.totals;
    var span = t.firstSeason === t.lastSeason ? String(t.firstSeason) : t.firstSeason + '–' + t.lastSeason;
    // titles as the same gold chips as the Managers grid (Stage 8)
    var badges = m.seasons.filter(function (s) { return s.playoffResult === 'c'; }).map(function (s) {
      return '<span class="trophy title-chip">' + ICON_TROPHY + s.season + '</span>';
    }).join('');

    var head = '<div class="solid-box perfil-head">' + avatar(id, 'lg') +
      '<div class="perfil-id">' +
        '<label class="title-pick perfil-pick"><h2 class="perfil-name">' + esc(m.fullName || m.shortName) + '</h2><span class="title-pick-ic" aria-hidden="true"></span>' +
          '<select id="perfil-pick" aria-label="Manager">' + mgrOptions(H, id) + '</select></label>' +
        '<div class="perfil-sub">' + esc(m.seasons[m.seasons.length - 1].team) + '</div>' +
        '<div class="perfil-meta">' + span + '</div>' +
        (badges ? '<div class="po-badges">' + badges + '</div>' : '') +
      '</div></div>';

    // Carrera (Stage 8): two compact groups of label + value; rank among all managers under some
    var everyone = Object.keys(H.managers).map(function (k) { return H.managers[k]; }).filter(function (x) { return x.seasons.length; });
    var rankOf = function (fn, desc) {
      var vals = everyone.map(function (x) { return fn(x.totals); }).filter(isNum), mine = fn(t);
      if (!isNum(mine)) return '';
      return (vals.filter(function (v) { return desc ? v > mine : v < mine; }).length + 1) + ' de ' + vals.length;
    };
    var recRank = (function () {
      var better = everyone.filter(function (x) { var o = x.totals; return o.W > t.W || (o.W === t.W && o.PF > t.PF); }).length;
      return (better + 1) + ' de ' + everyone.length;
    })();
    var CAR = [
      ['Temporada regular', [['Temporadas', String(t.seasons)], ['Récord', recStr(t), recRank],
        ['% de victorias', pct(t.pct), rankOf(function (o) { return o.pct; }, true)],
        ['PF por partido', pts(t.avgPF), rankOf(function (o) { return o.avgPF; }, true)],
        ['PC por partido', pts(t.avgPA), rankOf(function (o) { return o.avgPA; }, true)],
        ['Mejor posición', isNum(t.bestPos) ? t.bestPos + 'º' : '–'],
        ['Posición promedio', isNum(t.avgPos) ? fmt(t.avgPos, 1) : '–', rankOf(function (o) { return o.avgPos; }, false)]]],
      ['Playoffs', [['Playoffs', String(t.playoffs)], ['Finales', String(t.finals)], ['Títulos', String(t.titles)]]]
    ];
    var tilesHtml = '<div class="solid-box"><h3 class="box-title">Carrera</h3>' + CAR.map(function (g) {
      return '<div class="hl-group"><h5 class="hl-head">' + g[0] + '</h5><div class="car-stats">' + g[1].map(function (x) {
        return '<div class="car-stat"><div class="car-label">' + x[0] + '</div><div class="car-value">' + x[1] + '</div>' +
          (x[2] ? '<div class="car-rank">' + x[2] + '</div>' : '') + '</div>';
      }).join('') + '</div></div>';
    }).join('') + '</div>';

    // Season by season
    var difR = rangeOf(m.seasons.map(function (s) { return s.PF - s.PA; }));
    // PF / PC colored by points per game, so a season in progress compares fairly (Stage 8)
    var perG = function (s, v) { var g = s.W + s.L + (s.T || 0); return g ? v / g : null; };
    var rows = m.seasons.slice().reverse().map(function (s) {
      var n = H.seasons.filter(function (x) { return x.season === s.season; })[0].teams;
      var d = s.PF - s.PA;
      var po = s.inProgress ? '<span class="chip chip-live">En curso</span>'
        : s.playoffResult === 'c' ? '<span class="trophy title-chip">' + ICON_TROPHY + PO_LABEL.c + '</span>'
        : s.playoffResult ? '<span class="po-txt po-txt-' + s.playoffResult + '">' + PO_LABEL[s.playoffResult] + '</span>' : '<span class="muted">–</span>';
      return '<tr><td><a class="link" href="#posiciones?temporada=' + s.season + '">' + s.season + '</a></td>' +
        '<td class="left team-td"><span class="team-name">' + esc(s.team) + '</span></td>' +
        '<td class="rk" style="' + bg(s.R, SC.rank, [1, n]) + '">' + (isNum(s.R) ? s.R + 'º' : '') + '</td>' +
        '<td style="' + bg(s.W / ((s.W + s.L + (s.T || 0)) || 1), SC.recB, rangeOf(m.seasons.map(function (x) { return x.W / ((x.W + x.L + (x.T || 0)) || 1); }))) + '">' + s.W + '-' + s.L + (s.T ? '-' + s.T : '') + '</td>' +
        '<td style="' + bg(perG(s, s.PF), SC.pos, rangeOf(m.seasons.map(function (x) { return perG(x, x.PF); }))) + '">' + pts(s.PF) + '</td>' +
        '<td style="' + bg(perG(s, s.PA), SC.neg, rangeOf(m.seasons.map(function (x) { return perG(x, x.PA); }))) + '">' + pts(s.PA) + '</td>' +
        '<td style="' + bg(d, DIF0, difR) + '">' + signed(d) + '</td>' +
        '<td class="po-td">' + po + '</td></tr>';
    }).join('');
    var seasonsHtml = '<div class="solid-box"><h3 class="box-title">Temporada por temporada</h3>' +
      '<div class="table-scroll"><table class="data-table perfil-seasons"><thead><tr><th>Año</th><th class="left">Equipo</th><th>Pos</th><th>G-P</th>' +
      '<th>PF</th><th>PC</th><th>DIF</th><th>Playoffs</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    // Head-to-head (Stage 8): G-P, then one column per season with a badge per game
    var years = m.seasons.map(function (s) { return s.season; });
    var met = {};
    years.forEach(function (y) {
      st.seasons[y].games.forEach(function (g) {
        if (g.managerId !== id || ['REG', 'SF', 'F'].indexOf(g.type) < 0) return;
        (met[g.oppManagerId] = met[g.oppManagerId] || {});
        (met[g.oppManagerId][y] = met[g.oppManagerId][y] || []).push(g);
      });
    });
    var opp = Object.keys(met).map(function (o) {
      var h = m.h2h[o] || { games: 0, W: 0, L: 0, T: 0 };
      return { id: o, h: h, pct: h.games ? (h.W + h.T / 2) / h.games : null };
    }).sort(function (a, b) { return (isNum(b.pct) ? b.pct : -1) - (isNum(a.pct) ? a.pct : -1) || b.h.games - a.h.games || mgrName(a.id).localeCompare(mgrName(b.id)); });
    var pctR = rangeOf(opp.map(function (o) { return o.pct; }));
    function h2hBadge(g) {
      var b = g.status === 'FINAL' ? resultBadge(g.result)
        : '<span class="res res-' + (g.status === 'LIVE' ? 'EJ" title="En juego">EJ' : 'PJ" title="Por jugar">PJ') + '</span>';
      return '<a class="h2h-b" href="#resultados?temporada=' + g.season + '&semana=' + g.week + '">' + b +
        (g.type !== 'REG' ? '<small>' + g.type + '</small>' : '') + '</a>';
    }
    var h2hRows = opp.map(function (x) {
      var h = x.h;
      return '<tr><td class="left team-td"><a class="mgr-link" href="#managers/' + esc(x.id) + '">' + avatar(x.id, 'sm') +
        '<span>' + esc(mgrName(x.id)) + '</span></a></td>' +
        '<td style="' + (h.games ? bg(x.pct, SC.recB, pctR) : '') + '">' + (h.games ? recStr(h) : '–') + '</td>' +
        years.map(function (y) {
          var list = (met[x.id][y] || []).slice().sort(function (a, b) { return a.week - b.week; });
          return '<td class="h2h-yr">' + (list.length ? '<span class="h2h-badges">' + list.map(h2hBadge).join('') + '</span>' : '') + '</td>';
        }).join('') + '</tr>';
    }).join('');
    var h2hHtml = '<div class="solid-box"><h3 class="box-title">Cara a cara</h3>' +
      '<div class="table-scroll"><table class="data-table perfil-h2h"><thead><tr><th class="left">Rival</th><th>G-P</th>' +
      years.map(function (y) { return '<th>' + y + '</th>'; }).join('') + '</tr></thead><tbody>' + h2hRows + '</tbody></table></div></div>';

    // Team names over time
    var namesHtml = '<div class="solid-box"><h3 class="box-title">Nombres de equipo</h3><ul class="wn-list name-list">' +
      m.teamNames.slice().reverse().map(function (n) {
        return '<li><span class="wn-dot"></span><span class="team-name">' + esc(n.team) + '</span><span class="muted">' + yearsLabel(n.seasons) + '</span></li>';
      }).join('') + '</ul></div>';

    var html = head + tilesHtml + personalRecordsHtml(id) + seasonsHtml + h2hHtml + namesHtml;
    var secM = $('#section-managers');
    secM.innerHTML = html;
    $('#perfil-pick', secM).addEventListener('change', function (e) { location.hash = '#managers/' + e.target.value; });
  }

  // Profile picker options: active managers, then former ones, alphabetical (same order as the grid).
  function mgrOptions(H, sel) {
    var ids = Object.keys(H.managers).filter(function (k) { return H.managers[k].seasons.length; })
      .sort(function (a, b) { return H.managers[a].shortName.localeCompare(H.managers[b].shortName, 'es'); });
    var opt = function (k) { var x = H.managers[k]; return '<option value="' + esc(k) + '"' + (k === sel ? ' selected' : '') + '>' + esc(x.fullName || x.shortName) + '</option>'; };
    var act = ids.filter(function (k) { return H.managers[k].active; }), old = ids.filter(function (k) { return !H.managers[k].active; });
    return old.length ? '<optgroup label="Actuales">' + act.map(opt).join('') + '</optgroup><optgroup label="Inactivos">' + old.map(opt).join('') + '</optgroup>'
      : act.map(opt).join('');
  }

  // Personal records on the profile (same definitions as Historia > Récords).
  var PREC = {
    mostPts: { t: 'Más puntos', f: pts, tone: 'good' },
    fewestPts: { t: 'Menos puntos', f: pts, tone: 'bad' },
    biggestWin: { t: 'Mayor margen de victoria', f: function (v) { return '+' + pts(v); }, tone: 'good' },
    worstLoss: { t: 'Peor derrota', f: function (v) { return '-' + pts(v); }, tone: 'bad' },
    mostWins: { t: 'Mejor temporada', f: function (v) { return v + ' G'; }, tone: 'good' },
    bestPfPg: { t: 'Mejor PF por partido', f: pts, tone: 'good' },
    winStreak: { t: 'Racha de triunfos', f: String, tone: 'good' },
    lossStreak: { t: 'Racha de derrotas', f: String, tone: 'bad' }
  };
  function personalRecordsHtml(id) {
    var games = [], opts = {};
    st.years.slice().reverse().forEach(function (y) {
      var s = st.seasons[y];
      games = games.concat(s.games);
      opts[y] = { regWeeks: s.regWeeks, playoffSpots: s.playoffTeams || 4 };
    });
    var P = S.computeManagerRecords(games, opts, id);
    if (!P.length) return '';
    var byKey = {}; P.forEach(function (r) { byKey[r.key] = r; });
    var DEF = {}, TONE = {};
    Object.keys(REC_GAME).forEach(function (k) { DEF[k] = REC_GAME[k]; });
    Object.keys(REC_SEASON).forEach(function (k) { DEF[k] = REC_SEASON[k]; TONE[k] = REC_SEASON_TONE[k]; });
    REC_GROUPS.forEach(function (g) { g.items.forEach(function (it) { TONE[it[0]] = it[1]; }); });
    DEF.worstLoss = { t: 'Peor derrota', f: function (v) { return '-' + pts(v); } }; TONE.worstLoss = 'bad'; TONE.biggestWin = 'good';
    DEF.winStreak = { t: 'Racha de triunfos', f: String }; TONE.winStreak = 'good';
    DEF.lossStreak = { t: 'Racha de derrotas', f: String }; TONE.lossStreak = 'bad';
    var SEASON_KEYS = Object.keys(REC_SEASON);
    // card = the Records card without the team (it's this manager): value, then the detail band
    function detail(x, key) {
      if (x.start) return '<div class="ref-line">' + refLink(x.start) + (x.active ? '<span class="chip chip-live">Activa</span>' : '<span class="ref-arrow">→</span>' + refLink(x.end)) + '</div>';
      return recDetail(x, key, SEASON_KEYS.indexOf(key) >= 0);
    }
    function card(k) {
      var r = byKey[k], tone = TONE[k] || 'neutral', d = DEF[k];
      var val = (k === 'mostWins' || k === 'fewestWins') ? recStr(r.entries[0]) : d.f(r.value);
      return '<div class="award tone-' + tone + ' rec-award"><div class="award-title"><span class="hl-ic">' + TONE_ICON[tone] + '</span>' + d.t + '</div>' +
        '<div class="award-value">' + decSpan(val) + '</div>' +
        r.entries.map(function (x) { return '<div class="rec-leader">' + detail(x, k) + '</div>'; }).join('') +
        (r.league ? '<div class="hl-badges"><span class="hl-badge rec-league">Récord de la liga</span></div>' : '') + '</div>';
    }
    var GROUPS_P = [
      ['Equipos', REC_GROUPS[0].items.map(function (it) { return it[0]; })],
      ['Partidos', ['mostCombined', 'fewestCombined', 'biggestWin', 'worstLoss', 'closest', 'unexpected']],
      ['Temporadas', SEASON_KEYS],
      ['Rachas', ['winStreak', 'lossStreak']]
    ];
    return '<div class="solid-box"><h3 class="box-title">Récords personales</h3>' + GROUPS_P.map(function (g) {
      var list = g[1].filter(function (k) { return byKey[k]; });
      return list.length ? '<div class="hl-group"><h5 class="hl-head">' + g[0] + '</h5><div class="awards rec-cards rec-pairs">' + list.map(card).join('') + '</div></div>' : '';
    }).join('') + '</div>';
  }

  // ---------------------------------------------------------------- HISTORIA

  // Pages inside Historia (sub-nav). Each one is added as it is built.
  var HIST_PAGES = [
    { id: 'campeones', label: 'Campeones', render: histCampeones },
    { id: 'tabla', label: 'Tabla histórica', render: histTabla },
    { id: 'estadisticas', label: 'Estadísticas', render: histStats, bind: bindHistStats },
    { id: 'records', label: 'Récords', render: histRecords },
    { id: 'vs', label: 'Cara a cara', render: histVs }
  ];

  function renderHistoria(params, sub) {
    if (sub === 'rachas') { location.replace('#historia/records'); return; }   // Rachas moved into Récords (Stage 8)
    var page = HIST_PAGES.filter(function (p) { return p.id === sub; })[0] || HIST_PAGES[0];
    var subnav = HIST_PAGES.length > 1 ? '<nav class="grp-tabs page-tabs">' + HIST_PAGES.map(function (p) {
      return '<a class="grp-tab' + (p === page ? ' active' : '') + '" href="#historia/' + p.id + '">' + p.label + '</a>';
    }).join('') + '</nav>' : '';
    var sec = $('#section-historia');
    sec.innerHTML = subnav + page.render(params);
    $all('.box-note', sec).forEach(function (n) { n.parentNode.removeChild(n); });   // no notes in Historia (Stage 8)
    // phones: the tab bar scrolls sideways; keep the active tab in view
    var bar = $('.page-tabs', sec), on = bar && $('.grp-tab.active', bar);
    if (on && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = on.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2;
    if (page.bind) page.bind(sec, params);
  }

  function mgrChip(id, team) {
    return '<a class="mgr-link" href="#managers/' + esc(id) + '">' + avatar(id, 'sm') +
      '<span class="mgr-chip-txt"><span class="team-name">' + esc(team) + '</span>' +
      '<span class="team-mgr">' + esc(mgrName(id)) + '</span></span></a>';
  }

  // Tabla histórica: all-time regular-season standings by manager (ranked by
  // wins, then total PF; decided Stage 7) + final position per season.
  // Standings never show playoff tags (section 6, Display rules).
  function histTabla() {
    var H = leagueHistory();
    var ids = Object.keys(H.managers).filter(function (id) { return H.managers[id].seasons.length; });
    var list = ids.map(function (id) { return H.managers[id]; });
    var ranks = S._helpers.rankRows(list, function (m) { return [m.totals.W, m.totals.PF]; }, [true, true]);
    list.forEach(function (m, i) { m._R = ranks[i]; });
    list.sort(function (a, b) { return a._R - b._R || a.shortName.localeCompare(b.shortName); });
    var anyT = list.some(function (m) { return m.totals.T; });
    var col = function (fn) { return rangeOf(list.map(fn)); };
    var rR = col(function (m) { return m._R; }), rW = col(function (m) { return m.totals.W; }), rL = col(function (m) { return m.totals.L; });
    var rPF = col(function (m) { return m.totals.PF; }), rPA = col(function (m) { return m.totals.PA; });
    var rD = col(function (m) { return m.totals.DIF; }), rAvg = col(function (m) { return m.totals.avgPF; });
    var rT = col(function (m) { return m.totals.titles; });
    var live = H.seasons.filter(function (s) { return s.inProgress; })[0];

    var body = list.map(function (m) {
      var t = m.totals;
      return '<tr><td class="rk" style="' + bg(m._R, SC.rank, rR) + '">' + m._R + '</td>' +
        '<td class="left team-td"><a class="mgr-link" href="#managers/' + esc(m.managerId) + '">' + avatar(m.managerId, 'sm') + '<span>' + esc(m.shortName) + '</span></a></td>' +
        '<td>' + t.seasons + '</td><td>' + t.games + '</td>' +
        '<td style="' + bg(t.pct, SC.recB, rangeOf(list.map(function (x) { return x.totals.pct; }))) + '">' + t.W + '-' + t.L + (anyT ? '-' + t.T : '') + '</td>' +
        '<td style="' + bg(t.PF, SC.pos, rPF) + '">' + pts(t.PF) + '</td>' +
        '<td style="' + bg(t.PA, SC.neg, rPA) + '">' + pts(t.PA) + '</td>' +
        '<td style="' + bg(t.DIF, DIF0, rD) + '">' + signed(t.DIF) + '</td>' +
        '<td style="' + bg(t.avgPF, SC.pos, rAvg) + '">' + pts(t.avgPF) + '</td>' +
        '<td style="' + bg(t.titles, SC.titles, rT) + '">' + t.titles + '</td></tr>';
    }).join('');
    var table = '<div class="solid-box"><h3 class="box-title">Tabla histórica</h3><div class="table-scroll">' +
      '<table class="data-table hist-std"><thead><tr><th>Pos</th><th class="left">Manager</th><th title="Temporadas">Temp.</th><th title="Partidos jugados">PJ</th>' +
      '<th>' + (anyT ? 'G-P-E' : 'G-P') + '</th><th>PF</th><th>PC</th><th>DIF</th>' +
      '<th title="Puntos a favor por partido">PF/PJ</th><th>Títulos</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="box-note">Solo temporada regular, ' + H.seasons[0].season + '–' + H.seasons[H.seasons.length - 1].season +
      (live ? ' (incluye la temporada ' + live.season + ', en curso)' : '') + '. Orden: triunfos, luego puntos a favor (PF).</p></div>';

    // Final regular-season position per season (same manager order).
    var seasons = H.seasons;
    var head = '<tr><th class="left">Manager</th><th class="sum">PROM</th><th class="sum" title="Mejor posición">TOP</th>' + seasons.map(function (s) {
      return '<th class="wk" title="' + s.teams + ' equipos">' + s.season + (s.inProgress ? '*' : '') + '</th>';
    }).join('') + '</tr>';
    var rAvgPos = col(function (m) { return m.totals.avgPos; });
    var rBest = col(function (m) { return m.totals.bestPos; });
    var grid = list.map(function (m) {
      return '<tr><td class="left team-td"><a class="mgr-link" href="#managers/' + esc(m.managerId) + '">' + avatar(m.managerId, 'sm') + '<span>' + esc(m.shortName) + '</span></a></td>' +
        '<td class="sum" style="' + bg(m.totals.avgPos, [K.green, K.grey, K.red], rAvgPos) + '">' + (isNum(m.totals.avgPos) ? fmt(m.totals.avgPos, 1) : '') + '</td>' +
        '<td class="sum" style="' + bg(m.totals.bestPos, [K.blue, K.navy], rBest) + '">' + (isNum(m.totals.bestPos) ? m.totals.bestPos + 'º' : '') + '</td>' +
        seasons.map(function (s) {
          var p = H.positions[s.season][m.managerId];
          if (!p || !isNum(p.R)) return '<td class="wk pos-empty"></td>';
          return '<td class="wk" style="' + bg(p.R, SC.rank, [1, s.teams]) + '"><a class="pos-link" href="#posiciones?temporada=' + s.season + '">' + p.R + 'º</a></td>';
        }).join('') + '</tr>';
    }).join('');
    var posBox = '<div class="solid-box"><h3 class="box-title">Posición por temporada</h3><div class="table-scroll">' +
      '<table class="data-table pos-grid"><thead>' + head + '</thead><tbody>' + grid + '</tbody></table></div>' +
      '<p class="box-note">Posición final de la temporada regular. ' + (live ? '* ' + live.season + ': posición actual (temporada en curso); no cuenta en PROM ni MEJOR. ' : '') +
      'Cada año lleva a la tabla de esa temporada.</p></div>';
    return table + posBox;
  }

  // Récords: single-game (all seasons, 2026 live) and season (finished seasons).
  var REC_GAME = {
    mostPts: { t: 'Más puntos', kind: 'team', f: pts },
    fewestPts: { t: 'Menos puntos', kind: 'team', f: pts },
    biggestWin: { t: 'Mayor margen de victoria', kind: 'match', f: function (v) { return '+' + pts(v); } },
    closest: { t: 'Marcador más cerrado', kind: 'match', f: function (v) { return '+' + pts(v); } },
    mostCombined: { t: 'Más puntos combinados', kind: 'match', f: pts },
    fewestCombined: { t: 'Menos puntos combinados', kind: 'match', f: pts },
    mostPtsLoss: { t: 'Más puntos en una derrota', kind: 'team', f: pts },
    fewestPtsWin: { t: 'Menos puntos en una victoria', kind: 'team', f: pts },
    overProj: { t: 'Puntos arriba de la proyección', kind: 'team', f: signed, note: 'PF menos proyección' },
    underProj: { t: 'Puntos abajo de la proyección', kind: 'team', f: signed, note: 'PF menos proyección' },
    upset: { t: 'Ganador más inesperado', kind: 'match', f: signed, note: 'Diferencia proyectada del ganador' },
    unexpected: { t: 'Resultado más inesperado', kind: 'match', f: pts, note: 'Diferencia entre el margen final y el proyectado' }
  };
  var REC_SEASON = {
    mostWins: { t: 'Más triunfos', f: str },
    fewestWins: { t: 'Menos triunfos', f: str },
    bestPfPg: { t: 'Mejor PF por partido', f: pts },
    worstPfPg: { t: 'Peor PF por partido', f: pts },
    fewestPaPg: { t: 'Menos PC por partido', f: pts },
    mostPaPg: { t: 'Más PC por partido', f: pts },
    bestDifPg: { t: 'Mejor DIF por partido', f: signed },
    mostTop1: { t: 'Más semanas con el mejor puntaje', f: str },
    mostBot1: { t: 'Más semanas con el peor puntaje', f: str },
    mostPf: { t: 'Más PF', f: pts }, fewestPf: { t: 'Menos PF', f: pts },
    mostPa: { t: 'Más PC', f: pts }, fewestPa: { t: 'Menos PC', f: pts },
    bestDif: { t: 'Mejor DIF', f: signed }, worstDif: { t: 'Peor DIF', f: signed },
    worstDifPg: { t: 'Peor DIF por partido', f: signed },
    worstGw: { t: 'Peor récord en TG', f: function (v) { return fmt(v * 100, 1) + '%'; } },
    bestGw: { t: 'Mejor récord en TG', f: function (v) { return fmt(v * 100, 1) + '%'; }, note: 'Triunfos globales: contra todos los equipos cada semana' }
  };

  function records() {
    if (!st.records) {
      var games = [], opts = {};
      st.years.slice().reverse().forEach(function (y) {
        var s = st.seasons[y];
        games = games.concat(s.games);
        opts[y] = { regWeeks: s.regWeeks, playoffSpots: s.playoffTeams || 4 };
      });
      st.records = S.computeRecords(games, opts);
    }
    return st.records;
  }

  // Records on the Highlights system (Stage 8): same groups, names, tones and card.
  var REC_GROUPS = [
    { title: 'Equipos', items: [['mostPts', 'good'], ['fewestPts', 'bad'], ['overProj', 'good'], ['underProj', 'bad'],
      ['mostPtsLoss', 'good'], ['fewestPtsWin', 'bad'], ['upset', 'good']] },
    { title: 'Partidos', items: [['mostCombined', 'good'], ['fewestCombined', 'bad'], ['biggestWin', 'neutral'],
      ['closest', 'neutral'], ['unexpected', 'neutral']] }
  ];
  var REC_SEASON_TONE = { mostWins: 'good', fewestWins: 'bad', mostPf: 'good', fewestPf: 'bad', bestPfPg: 'good', worstPfPg: 'bad',
    mostPa: 'neutral', fewestPa: 'neutral', mostPaPg: 'neutral', fewestPaPg: 'neutral', bestDif: 'good', worstDif: 'bad',
    bestDifPg: 'good', worstDifPg: 'bad', mostTop1: 'good', mostBot1: 'bad', bestGw: 'good', worstGw: 'bad' };

  function recWeek(x) { return refLink(x); }
  function recSeason(x) { return refSeason(x.season); }
  // final score of the game, winner's first for match records, the team's first otherwise
  function recScore(x, key) {
    if (x.winner) return pts(x.winner.pf) + '–' + pts(x.loser.pf);
    return pts(x.pf) + '–' + pts(x.pa);
  }
  // holder block: team (photo, manager), 'vs rival', score; or 'A vs B', score; one item per line
  // Detail band (Stage 8): reference (season over week) on the left, then rival / match over the score
  function recDetail(x, key, season) {
    if (season) return '<div class="ref-line">' + recSeason(x) + '</div>';
    var t = recTeam(x, key);
    var who = t ? '<span class="vs">vs</span> ' + esc(key === 'upset' ? x.loser.team : x.opp) : recMatch(x);
    return '<div class="ref-line">' + recWeek(x) + '<div class="ref-txt"><div class="rec-vs">' + who + '</div>' +
      '<div class="rec-score">' + recScore(x, key) + '</div></div></div>';
  }
  function recHolderBlock(x, key, season) {
    var t = recTeam(x, key);
    if (!t) return recDetail(x, key, season);
    return '<div class="rec-holder-row' + (season ? ' rec-season-row' : '') + '"><div class="award-who">' + teamCell(t) + '</div>' + recDetail(x, key, season) + '</div>';
  }
  // the team a record belongs to: winner for upsets, the team itself otherwise; null for match records
  function recTeam(x, key) {
    if (key === 'upset') return x.winner;
    return x.winner ? null : x;
  }
  function recMatch(x) {
    return esc(x.winner.team) + ' <span class="vs">vs</span> ' + esc(x.loser.team);
  }
  // leader block: one item per line
  function recLeader(x, key, season) { return recHolderBlock(x, key, season); }
  function recRow(x, key, def, season) {
    return '<li><span class="rec-rank">' + x.rank + '</span><span class="rec-val">' + decSpan(def.f(x.value)) + '</span>' +
      '<span class="rec-who">' + recHolderBlock(x, key, season) + '</span></li>';
  }
  function recCard(rec, def, tone, season) {
    var e = rec.entries, key = rec.key;
    var leaders = e.filter(function (x) { return x.rank === 1; }), rest = e.filter(function (x) { return x.rank !== 1; });
    var sub = key === 'unexpected' ? '<div class="award-sub">vs el margen proyectado</div>'
      : key === 'upset' ? '<div class="award-sub">diferencia proyectada</div>' : '';
    return '<div class="award tone-' + tone + ' rec-award"><div class="award-title"><span class="hl-ic">' + TONE_ICON[tone] + '</span>' + def.t + '</div>' +
      '<div class="award-value">' + decSpan(def.f(leaders[0].value)) + sub + '</div>' +
      leaders.map(function (x) { return '<div class="rec-leader">' + recLeader(x, key, season) + '</div>'; }).join('') +
      (rest.length ? '<ol class="rec-list">' + rest.map(function (x) { return recRow(x, key, def, season); }).join('') + '</ol>' : '') + '</div>';
  }

  function histRecords() {
    var R = records(), K = streaks(), byKey = {};
    R.game.forEach(function (r) { byKey[r.key] = r; });
    var game = REC_GROUPS.map(function (g) {
      var cards = g.items.filter(function (it) { return byKey[it[0]]; }).map(function (it) { return recCard(byKey[it[0]], REC_GAME[it[0]], it[1], false); });
      return cards.length ? '<div class="hl-group"><h5 class="hl-head">' + g.title + '</h5><div class="awards rec-cards rec-pairs">' + cards.join('') + '</div></div>' : '';
    }).join('');
    var season = R.season.map(function (r) { return recCard(r, REC_SEASON[r.key], REC_SEASON_TONE[r.key] || 'neutral', true); }).join('');
    return '<div class="solid-box"><h3 class="box-title">Récords de partido</h3>' + game + '</div>' +
      '<div class="solid-box"><h3 class="box-title">Récords de temporada</h3><div class="awards rec-cards rec-pairs">' + season + '</div></div>' +
      '<div class="solid-box"><h3 class="box-title">Rachas</h3><div class="awards rec-cards rec-pairs">' +
      streakCard(K.wins, 'Más triunfos seguidos', 'good') + streakCard(K.losses, 'Más derrotas seguidas', 'bad') + '</div></div>' +
      h2hSection();
  }
  // Cara a cara record (Stage 8): best win % against one rival; same card as the other records.
  // Holder = manager, band = rival over the record. Follows the manager, so names, not team names.
  function h2hSection() {
    var games = [];
    st.years.forEach(function (y) { games = games.concat(st.seasons[y].games); });
    var list = S.computeH2hRecords(games, 10, 3);
    if (!list.length) return '';
    function pct(v) { return fmt(v * 100, 1) + '%'; }
    function holder(x) {
      var rec = x.W + '-' + x.L + (x.T ? '-' + x.T : '');
      return '<div class="rec-holder-row h2h-row"><div class="award-who"><div class="team-cell has-photo">' + avatar(x.managerId, 'sm') +
        '<div class="team-txt"><span class="team-name">' + esc(mgrName(x.managerId)) + '</span><span class="team-mgr"><span class="vs">vs</span> ' + esc(mgrName(x.oppManagerId)) + '</span></div></div></div>' +
        '<div class="h2h-rec">' + rec + '</div></div>';
    }
    var leaders = list.filter(function (x) { return x.rank === 1; }), rest = list.filter(function (x) { return x.rank !== 1; });
    var card = '<div class="award tone-good rec-award"><div class="award-title"><span class="hl-ic">' + TONE_ICON.good + '</span>Mejor porcentaje ganador vs un rival</div>' +
      '<div class="award-value">' + decSpan(pct(leaders[0].value)) + '</div>' +
      leaders.map(function (x) { return '<div class="rec-leader">' + holder(x) + '</div>'; }).join('') +
      (rest.length ? '<ol class="rec-list">' + rest.map(function (x) {
        return '<li><span class="rec-rank">' + x.rank + '</span><span class="rec-val">' + decSpan(pct(x.value)) + '</span><span class="rec-who">' + holder(x) + '</span></li>';
      }).join('') + '</ol>' : '') + '</div>';
    return '<div class="solid-box"><h3 class="box-title">Cara a cara</h3><div class="awards rec-cards rec-pairs">' + card + '</div></div>';
  }
  // Streak record card (Stage 8): same card as the other records; holder = manager with the team(s)
  // of the streak, band = first game → last game (or Activa)
  function streakCard(list, title, tone) {
    if (!list.length) return '';
    function holder(x) {
      var team = x.start.team === x.end.team ? x.end.team : x.start.team + ' → ' + x.end.team;
      return '<div class="rec-holder-row"><div class="award-who">' + teamCell({ managerId: x.managerId, team: team }) + '</div>' +
        '<div class="ref-line">' + refLink(x.start) + '<span class="ref-arrow">→</span>' +
        (x.active ? '<span class="chip chip-live">Activa</span>' : refLink(x.end)) + '</div></div>';
    }
    var leaders = list.filter(function (x) { return x.rank === 1; }), rest = list.filter(function (x) { return x.rank !== 1; });
    return '<div class="award tone-' + tone + ' rec-award"><div class="award-title"><span class="hl-ic">' + TONE_ICON[tone] + '</span>' + title + '</div>' +
      '<div class="award-value">' + leaders[0].length + '</div>' +
      leaders.map(function (x) { return '<div class="rec-leader">' + holder(x) + '</div>'; }).join('') +
      (rest.length ? '<ol class="rec-list">' + rest.map(function (x) {
        return '<li><span class="rec-rank">' + x.rank + '</span><span class="rec-val">' + x.length + '</span><span class="rec-who">' + holder(x) + '</span></li>';
      }).join('') + '</ol>' : '') + '</div>';
  }

  // Streaks: win/loss runs across seasons, following the manager (Stage 7); shown in Récords.
  function streaks() {
    if (!st.streaks) {
      var games = [];
      st.years.slice().reverse().forEach(function (y) { games = games.concat(st.seasons[y].games); });
      st.streaks = S.computeStreaks(games, 5);   // top 5 + ties, like every record
    }
    return st.streaks;
  }
  // Game reference in two lines: season over week (Stage 8)
  function refLink(p) {
    return '<a class="ref" href="#resultados?temporada=' + p.season + '&semana=' + p.week + '"><span>' + p.season + '</span><span>' + wkTag(p) + '</span></a>';
  }
  function wkTag(p) { return p.type === 'SF' || p.type === 'F' ? p.type : 'S' + p.week; }
  function refSeason(season) { return '<a class="ref" href="#posiciones?temporada=' + season + '"><span>' + season + '</span></a>'; }
  function weekLink(p) {
    return '<a class="link" href="#resultados?temporada=' + p.season + '&semana=' + p.week + '">' + p.season + ' ' + wkTag(p) + '</a>';
  }
  // Cara a cara: all-time head-to-head grid (row vs column), managers in
  // Tabla histórica order. Same data as each profile's Cara a cara table.
  function histVs() {
    var H = leagueHistory();
    var list = Object.keys(H.managers).map(function (id) { return H.managers[id]; }).filter(function (m) { return m.seasons.length; });
    var ranks = S._helpers.rankRows(list, function (m) { return [m.totals.W, m.totals.PF]; }, [true, true]);
    list = list.map(function (m, i) { return { m: m, R: ranks[i] }; })
      .sort(function (a, b) { return a.R - b.R || a.m.shortName.localeCompare(b.m.shortName); }).map(function (x) { return x.m; });
    var head = '<tr><th class="left sticky-col">Manager</th><th class="sum">G-P</th>' + list.map(function (o) {
      return '<th class="vs-col wk" data-label="' + esc(o.shortName) + '" title="' + esc(o.fullName || o.shortName) + '"><a href="#managers/' + esc(o.managerId) + '">' + avatar(o.managerId, 'sm') +
        '<span>' + esc(o.shortName) + '</span></a></th>';
    }).join('') + '</tr>';
    var body = list.map(function (m) {
      return '<tr><td class="left sticky-col team-td"><a class="mgr-link" href="#managers/' + esc(m.managerId) + '">' + avatar(m.managerId, 'sm') + '<span>' + esc(m.shortName) + '</span></a></td>' +
        '<td class="sum">' + recStr(m.totals) + '</td>' +
        list.map(function (o) {
          if (o.managerId === m.managerId) return '<td class="wk self"></td>';
          var h = m.h2h[o.managerId];
          if (!h || !h.games) return '<td class="wk never" title="Nunca se han enfrentado">–</td>';
          var style = h.W > h.L ? wlStyle('W') : h.L > h.W ? wlStyle('L') : 'background:' + K.grey;
          return '<td class="wk" style="' + style + '" title="' + esc(m.shortName) + ' vs ' + esc(o.shortName) + ': ' + recStr(h) + '">' + recStr(h) + '</td>';
        }).join('') + '</tr>';
    }).join('');
    return '<div class="solid-box"><h3 class="box-title">Cara a cara</h3>' +
      '<p class="box-desc">Récord histórico de cada manager (fila) contra cada rival (columna), temporada regular y playoffs.</p>' +
      '<div class="table-scroll"><table class="data-table stat-table vs-table vs-all"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="box-note">Verde = récord ganador, rojo = perdedor, gris = empatado. Pasa el cursor (o toca) una celda para ver PF y PC; el detalle completo está en el perfil de cada manager.</p></div>';
  }

  // Campeones: playoff results per season (newest first) + titles by manager.
  function histCampeones() {
    var H = leagueHistory();
    var rows = H.champions.slice().reverse().filter(function (c) {
      // a season in progress has no champion yet: not listed (Stage 8)
      var s = H.seasons.filter(function (x) { return x.season === c.season; })[0];
      return c.champion || !s.inProgress;
    }).map(function (c) {
      var s = H.seasons.filter(function (x) { return x.season === c.season; })[0];
      var yr = '<td class="ch-year"><a class="link" href="#posiciones?temporada=' + c.season + '">' + c.season + '</a></td>';
      if (!c.champion) {
        var msg = s.inProgress ? 'Temporada en curso · Semana ' + s.playedWeeks + ' de ' + s.regWeeks : 'Sin resultado registrado';
        return '<tr>' + yr + '<td class="ch-pending" colspan="3"><span class="chip' + (s.inProgress ? ' chip-live' : '') + '">' +
          (s.inProgress ? 'En curso' : 'Pendiente') + '</span> <span class="muted">' + msg + '</span></td></tr>';
      }
      return '<tr>' + yr +
        '<td class="ch-c"><div class="ch-cell">' + ICON_TROPHY + '<div>' + mgrChip(c.champion.managerId, c.champion.team) + '</div></div></td>' +
        '<td class="ch-r">' + (c.runnerUp ? mgrChip(c.runnerUp.managerId, c.runnerUp.team) : '') + '</td>' +
        '<td class="ch-s">' + c.semifinalists.map(function (t) { return '<div class="ch-semi">' + mgrChip(t.managerId, t.team) + '</div>'; }).join('') + '</td>' +
        '</tr>';
    }).join('');
    var champs = '<div class="solid-box"><h3 class="box-title">Campeones</h3><div class="table-scroll">' +
      '<table class="data-table champions"><thead><tr><th>Año</th><th class="left">Campeón</th><th class="left">Subcampeón</th>' +
      '<th class="left">Semifinalistas</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';

    // Titles by manager
    var ids = Object.keys(H.managers).filter(function (id) { return H.managers[id].seasons.length; });
    var list = ids.map(function (id) {
      var m = H.managers[id], t = m.totals;
      var done = m.seasons.filter(function (s) { return !s.inProgress; }).length;
      return { id: id, m: m, t: t, done: done,
        years: m.seasons.filter(function (s) { return s.playoffResult === 'c'; }).map(function (s) { return s.season; }),
        rate: done ? t.playoffs / done : null };
    }).sort(function (a, b) {
      return b.t.titles - a.t.titles || b.t.finals - a.t.finals || b.t.playoffs - a.t.playoffs ||
        (b.rate || 0) - (a.rate || 0) || mgrName(a.id).localeCompare(mgrName(b.id));
    });
    var rT = rangeOf(list.map(function (x) { return x.t.titles; })), rF = rangeOf(list.map(function (x) { return x.t.finals - x.t.titles; }));
    var rP = rangeOf(list.map(function (x) { return x.t.playoffs; }));
    var body = list.map(function (x) {
      return '<tr><td class="left team-td"><a class="mgr-link" href="#managers/' + esc(x.id) + '">' + avatar(x.id, 'sm') + '<span>' + esc(x.m.shortName) + '</span></a></td>' +
        '<td style="' + bg(x.t.titles, SC.titles, rT) + '">' + x.t.titles + '</td>' +
        '<td style="' + bg(x.t.finals - x.t.titles, SC.finals, rF) + '">' + (x.t.finals - x.t.titles) + '</td>' +
        '<td style="' + bg(x.t.playoffs, SC.count, rP) + '">' + x.t.playoffs + '</td>' +
        '<td>' + x.done + '</td>' +
        '<td style="' + bg(x.rate, SC.good3, rangeOf(list.map(function (o) { return o.rate; }))) + '">' + pct(x.rate) + '</td>' +
        '<td class="left ch-years">' + (x.years.length ? x.years.map(function (y) { return '<span class="trophy title-chip">' + ICON_TROPHY + y + '</span>'; }).join('') : '<span class="muted">–</span>') + '</td></tr>';
    }).join('');
    var titles = '<div class="solid-box"><h3 class="box-title">Títulos por manager</h3><div class="table-scroll">' +
      '<table class="data-table titles-table"><thead><tr><th class="left">Manager</th><th>Campeonatos</th><th title="Finales perdidas">Subcampeonatos</th><th>Playoffs</th>' +
      '<th title="Temporadas terminadas">Temp.</th><th title="Playoffs / temporadas terminadas">% Playoffs</th><th class="left">Títulos</th></tr></thead><tbody>' +
      body + '</tbody></table></div>' +
      '<p class="box-note">Playoffs = semifinales jugadas. Solo cuentan temporadas terminadas.</p></div>';
    return champs + titles;
  }

  // ---------------------------------------------------------------- tables (Stage 8)
  // One pass over every table a section renders:
  //  - decimals: the part after the point goes in .dec (set a bit smaller in CSS);
  //  - pinned columns: the leading columns up to the team/manager column stay in
  //    place while the table scrolls sideways (offsets measured here); the header
  //    is sticky inside the scroll box (CSS); shadow/gradient = more to see;
  //  - grids (tables with .wk columns) get a toolbar: the phone-only
  //    "Tabla | Tarjetas" switch and, if the table has data-hide, a button that
  //    hides the repeated columns. Cards are built from the table's own cells,
  //    so values and colors always match the table.
  var VIEW_KEY = 'dealba-vista-tablas';
  var tableView = (function () {
    try { return localStorage.getItem(VIEW_KEY) === 'tarjetas' ? 'tarjetas' : 'tabla'; } catch (e) { return 'tabla'; }
  })();
  var hideCols = false;

  // Every number's decimals are set smaller (.dec), site-wide (Stage 8).
  function wrapDecimals(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = walker.nextNode())) {
      if (/\d\.\d/.test(n.nodeValue) && !n.parentNode.closest('.dec, select, option, svg, script, style')) nodes.push(n);
    }
    nodes.forEach(function (t) {
      // one inline wrapper per text node, so a flex parent doesn't split '191' and '.24' apart
      var parts = t.nodeValue.split(/(\.\d+)/), frag = document.createElement('span');
      parts.forEach(function (p, i) {
        if (!p) return;
        // odd parts are '.digits'; wrap them only when a digit comes right before
        if (i % 2 && /\d$/.test(parts[i - 1])) { var d = document.createElement('span'); d.className = 'dec'; d.textContent = p; frag.appendChild(d); }
        else frag.appendChild(document.createTextNode(p));
      });
      t.parentNode.replaceChild(frag, t);
    });
  }

  function pinCount(table) {
    if (table.classList.contains('champions')) return 0;
    var ths = $all('thead tr:first-child th', table);
    for (var i = 0; i < ths.length && i < 3; i++) if (ths[i].classList.contains('left')) return i + 1;
    return 0;
  }

  function cardsHtml(table) {
    var ths = $all('thead tr:first-child th', table);
    var label = function (i) { var th = ths[i]; return th ? (th.getAttribute('data-label') || th.textContent) : ''; };
    var tile = function (td, i, kind) {
      var cls = td.className.replace(/\b(wk|sum)\b/g, '').trim();
      return '<div class="tc-tile ' + kind + (cls ? ' ' + cls : '') + '" style="' + esc(td.getAttribute('style') || '') + '"' +
        (td.title ? ' title="' + esc(td.title) + '"' : '') + '><span class="tc-l">' + esc(label(i)) + '</span><span class="tc-v">' + td.innerHTML + '</span></div>';
    };
    var cards = $all('tbody tr', table).map(function (tr) {
      var rk = null, team = null, sums = [], wks = [];
      Array.prototype.forEach.call(tr.cells, function (td, i) {
        if (!team && td.classList.contains('rk')) rk = td;
        else if (!team && td.classList.contains('left')) team = td;
        else if (td.classList.contains('sum')) sums.push(tile(td, i, 'tc-sum'));
        else if (td.classList.contains('wk')) wks.push(tile(td, i, 'tc-wk'));
      });
      return '<div class="tcard"><div class="tc-head">' +
        (rk ? '<div class="tc-rk" style="' + esc(rk.getAttribute('style') || '') + '">' + rk.innerHTML + '</div>' : '') +
        '<div class="tc-team">' + (team ? team.innerHTML : '') + '</div></div>' +
        (sums.length ? '<div class="tc-sums">' + sums.join('') + '</div>' : '') +
        '<div class="tc-wks">' + wks.join('') + '</div></div>';
    });
    $all('tfoot tr', table).forEach(function (tr) {
      var wks = [];
      Array.prototype.forEach.call(tr.cells, function (td, i) { if (td.classList.contains('wk')) wks.push(tile(td, i, 'tc-wk')); });
      if (wks.length) cards.push('<div class="tcard tcard-foot"><div class="tc-head"><div class="tc-team"><span class="team-name">Promedio de la liga</span></div></div>' +
        '<div class="tc-wks">' + wks.join('') + '</div></div>');
    });
    return cards.join('');
  }

  function layoutPins(block) {
    var table = $('table', block), n = Number(table.getAttribute('data-pins')) || 0;
    if (n && table.offsetParent) {
      var ths = $all('thead tr:first-child th', table), left = 0, offs = [];
      for (var i = 0; i < n; i++) { offs.push(left); left += ths[i].getBoundingClientRect().width; }
      $all('tr', table).forEach(function (tr) {
        for (var j = 0; j < n && j < tr.cells.length; j++) tr.cells[j].style.left = offs[j] + 'px';
      });
    }
    updateCue($('.table-scroll', block));
  }
  function updateCue(sc) {
    if (!sc) return;
    var max = sc.scrollWidth - sc.clientWidth;
    sc.parentNode.classList.toggle('more-left', sc.scrollLeft > 2);
    sc.parentNode.classList.toggle('more-right', max - sc.scrollLeft > 2);
  }

  function applyTableState(root) {
    $all('.tbl-block', root).forEach(function (b) {
      b.classList.toggle('is-cards', tableView === 'tarjetas' && b.classList.contains('is-grid'));
      b.classList.toggle('hide-cols', hideCols && !!$('.hide-btn', b));
      $all('.view-switch button', b).forEach(function (x) {
        var on = x.getAttribute('data-view') === tableView;
        x.classList.toggle('active', on); x.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var hb = $('.hide-btn', b);
      if (hb) hb.textContent = (hideCols ? 'Mostrar ' : 'Ocultar ') + hb.getAttribute('data-word');
      layoutPins(b);
    });
  }

  function enhanceTables(root) {
    $all('.table-scroll', root).forEach(function (sc) {
      var table = $('table', sc);
      if (!table || sc.parentNode.classList.contains('twrap')) return;
      wrapDecimals(table);
      var grid = !!$('thead th.wk', table), word = table.getAttribute('data-hide');
      var block = document.createElement('div');
      block.className = 'tbl-block' + (grid ? ' is-grid' : '');
      sc.parentNode.insertBefore(block, sc);
      if (grid) {
        var tools = document.createElement('div');
        tools.className = 'tbl-tools' + (word ? '' : ' only-phone');
        tools.innerHTML = '<div class="view-switch" role="group" aria-label="Vista">' +
          '<button type="button" data-view="tabla">Tabla</button><button type="button" data-view="tarjetas">Tarjetas</button></div>' +
          (word ? '<button type="button" class="hide-btn" data-word="' + esc(word) + '"></button>' : '');
        block.appendChild(tools);
        // the table's title + description sit in the same row as its controls (Stage 8)
        var head = block.previousElementSibling;
        if (head && head.classList.contains('stat-head')) { tools.insertBefore(head, tools.firstChild); tools.classList.add('has-head'); }
      }
      var wrap = document.createElement('div');
      wrap.className = 'twrap';
      block.appendChild(wrap);
      wrap.appendChild(sc);
      if (grid) {
        var cards = document.createElement('div');
        cards.className = 'tcards';
        cards.innerHTML = cardsHtml(table);
        block.appendChild(cards);
      }
      var n = pinCount(table);
      table.setAttribute('data-pins', n);
      if (n) $all('tr', table).forEach(function (tr) {
        for (var i = 0; i < n && i < tr.cells.length; i++) {
          tr.cells[i].classList.add('pin');
          if (i === n - 1) tr.cells[i].classList.add('pin-last');
        }
      });
      sc.addEventListener('scroll', function () { updateCue(sc); }, { passive: true });
    });
    applyTableState(root);
  }

  function bindTableControls() {
    document.addEventListener('click', function (e) {
      var v = e.target.closest('.view-switch button'), h = e.target.closest('.hide-btn');
      if (v) {
        tableView = v.getAttribute('data-view');
        try { localStorage.setItem(VIEW_KEY, tableView); } catch (err) { /* private mode */ }
        applyTableState(document);
      } else if (h) {
        hideCols = !hideCols;
        applyTableState(document);
      }
    });
    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(function () { $all('.section-panel.active .tbl-block').forEach(layoutPins); }, 150);
    });
  }

  // ---------------------------------------------------------------- router

  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    var q = h.indexOf('?');
    var path = q >= 0 ? h.slice(0, q) : h;
    var params = {};
    if (q >= 0) h.slice(q + 1).split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    var parts = path.split('/');
    return { section: parts[0] || 'inicio', sub: parts[1] || '', params: params };
  }
  function buildHash(path, params) {
    var q = Object.keys(params || {}).filter(function (k) { return params[k] != null && params[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return '#' + path + (q ? '?' + q : '');
  }
  // Filters replace the history entry (like the Estuardos site); sections push.
  function setParams(path, params) {
    history.replaceState(null, '', buildHash(path, params));
    route(true);
  }

  var SECTIONS = { inicio: renderInicio, posiciones: renderPosiciones, resultados: renderResultados, estadisticas: renderEstadisticas,
                   managers: renderManagers, historia: renderHistoria };

  function route(keepScroll) {
    var r = parseHash();
    if (!SECTIONS[r.section]) r = { section: 'inicio', sub: '', params: {} };
    document.body.dataset.section = r.section;
    $all('.section-panel').forEach(function (s) { s.classList.toggle('active', s.id === 'section-' + r.section); });
    $all('.main-tab-btn').forEach(function (a) { a.classList.toggle('active', a.dataset.section === r.section); });
    var y = window.scrollY;
    SECTIONS[r.section](r.params, r.sub);
    wrapDecimals($('#section-' + r.section));
    enhanceTables($('#section-' + r.section));
    if (keepScroll) window.scrollTo(0, y);
  }

  function lastUpdated() {
    var s = st.seasons[st.current];
    if (!s || !s.exportedAt) return;
    var d = new Date(s.exportedAt);
    $('#last-updated').textContent = 'Actualizado: ' + d.toLocaleString('es-MX', {
      day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Mexico_City'
    });
  }

  function init() {
    load().then(function () {
      window.addEventListener('hashchange', function () { route(false); window.scrollTo(0, 0); });
      bindTableControls();
      route(false);
      lastUpdated();
      $('#loading-overlay').hidden = true;
    }).catch(function (e) {
      console.error(e);
      $('#loading-overlay').innerHTML = '<p>No se pudieron cargar los datos. Intenta de nuevo más tarde.</p>';
    });
  }

  init();
  // Installable as an app (Stage 8): network-first service worker, see sw.js
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () { /* not supported here */ }); });
  }
})();
