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
          regWeeks: Math.max.apply(null, games.map(function (g) { return g.week; }))
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
        margin: g.status === 'FINAL' ? Math.abs(g.pf - g.pa) : null
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

  function teamCell(row, opts) {
    opts = opts || {};
    return '<div class="team-cell">' +
      '<span class="team-name">' + esc(row.team) + (opts.tag || '') + '</span>' +
      (opts.noManager ? '' : '<span class="team-mgr">' + esc(mgrName(row.managerId)) + '</span>') +
      '</div>';
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
            ? '<span class="mu-pts">' + pts(s.pf) + '</span>' +
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
      { key: 'over', title: 'Puntaje sorpresa', tone: 'good', val: signed },
      { key: 'under', title: 'Puntaje decepción', tone: 'bad', val: signed },
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

  function awardsHtml(a) {
    return AWARD_GROUPS.map(function (grp) {
      return '<div class="hl-group"><h5 class="hl-head">' + grp.title + '</h5><div class="awards">' + grp.items.map(function (d) {
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
        '<h3 class="hl-title-inicio">Highlights</h3>' +
        awardsHtml(a) +
        '<a class="more-link" href="#resultados?temporada=' + year + '&semana=' + lastWeek + '">Ver detalles &rarr;</a>' +
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
      ? '<h3 class="box-title stat-title">' + esc(TITLE[view.code]) + '</h3><p class="box-desc">' + esc(DESC[view.code]) + '</p>' +
        (C.playedWeeks.length ? statTable(view.code, C) : '<p class="box-note">Aún no hay semanas terminadas.</p>')
      : '<div class="table-scroll"><table class="data-table standings">' + '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
        '<p class="box-note">Desempate: puntos a favor (PF)</p>';

    var html = seasonSelect('posiciones-season', year) + playoffsBox(year) +
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
    return '<div class="solid-box"><h3 class="box-title">Playoffs ' + year + '</h3><div class="po-cards">' +
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

  function renderResultados(params) {
    var year = Number(params.temporada) || st.current;
    if (!st.seasons[year]) year = st.current;
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
    var html = seasonSelect('resultados-season', year) +
      '<div class="solid-box">' +
      '<div class="week-head"><button type="button" class="nav-btn" id="week-prev"' + (wi === 0 ? ' disabled' : '') + ' aria-label="Semana anterior">&#9664;</button>' +
      '<h3 class="box-title center">' + weekLabel(wtype, week) + '</h3>' +
      '<button type="button" class="nav-btn" id="week-next"' + (wi === weeks.length - 1 ? ' disabled' : '') + ' aria-label="Semana siguiente">&#9654;</button></div>' +
      weekBtns +
      '<div class="matchups-grid">' + ms.map(function (m) { return matchupCard(m); }).join('') + '</div>' +
      (a && a.teams === ms.length * 2 ? '<p class="box-note">Promedio de la semana: ' + pts(a.avg) + ' puntos</p>' : '') +
      '</div>';

    if (a && a.teams === ms.length * 2) {
      html += '<div class="solid-box"><h3 class="box-title">Highlights</h3>' + awardsHtml(a) + '</div>';
      html += '<div class="solid-box"><h3 class="box-title">Puntajes de la semana</h3>' + weekScores(year, week, a) + '</div>';
    }

    var sec = $('#section-resultados');
    sec.innerHTML = html;
    var go = function (y, w) { setParams('resultados', { temporada: y === st.current ? null : y, semana: w }); };
    bindSeasonSelect(sec, year, function (y) { go(y, null); });
    $all('.week-btn', sec).forEach(function (b) { b.addEventListener('click', function () { go(year, Number(b.dataset.week)); }); });
    var prev = $('#week-prev', sec), next = $('#week-next', sec);
    prev.addEventListener('click', function () { if (wi > 0) go(year, weeks[wi - 1].week); });
    next.addEventListener('click', function () { if (wi < weeks.length - 1) go(year, weeks[wi + 1].week); });
  }

  // Every team's score that week, ranked, with all-play record.
  function weekScores(year, week, a) {
    var rows = st.seasons[year].games.filter(function (g) { return g.week === week && g.status === 'FINAL'; })
      .sort(function (x, y) { return y.pf - x.pf; });
    var r = rangeOf(rows.map(function (g) { return g.pf; }));
    var rVP = rangeOf(rows.map(function (g) { return isNum(g.projPf) ? g.pf - g.projPf : null; }));
    var n = rows.length;
    return '<div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th class="left">Equipo</th><th>PF</th><th>Proy.</th><th>vs Proy.</th></tr></thead><tbody>' +
      rows.map(function (g, i) {
        var vp = isNum(g.projPf) ? g.pf - g.projPf : null;
        return '<tr><td class="rk" style="' + bg(i + 1, SC.rank, [1, n]) + '">' + (i + 1) + '</td><td class="left team-td">' + teamCell(g, { tag: ' ' + resultBadge(g.result) }) + '</td>' +
          '<td style="' + bg(g.pf, SC.wkPf, r) + '">' + pts(g.pf) + '</td>' +
          '<td>' + pts(g.projPf) + '</td>' +
          '<td style="' + bg(vp, SC.div, rVP) + '">' + signed(vp) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
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
    'PWR': 'Power ranking calculado de acuerdo al PF semanal de cada equipo vs la mediana de la liga, con más peso a las semanas recientes',
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
        return { cols: [['FAVP', 'FAV-UND', str, SC.recB, false, function (r) { return r.FAV + '-' + r.UND; }],
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
        '<td class="left sticky-col team-td">' + teamCell(r) + '</td>' +
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
      // No colspan: the label sits in the (pinned) team column.
      foot = '<tr class="foot"><td class="foot-gap"></td><td class="foot-label left">PROM:</td>' +
        sp.cols.map(function () { return '<td class="foot-gap"></td>'; }).join('') +
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
    // "Histórico" (Stage 7): all-time tables chosen by Daniel, seasons as columns.
    var hist = params.temporada === 'historico';
    var year = hist ? 'historico' : (Number(params.temporada) || st.current);
    if (!hist && !st.seasons[year]) year = st.current;
    var groups = hist ? HIST_GROUPS : GROUPS;
    var group = groups.filter(function (g) { return g.id === sub; })[0] || groups[0];
    var code = group.tables.indexOf(params.tabla) >= 0 ? params.tabla : group.tables[0];
    var tParam = year === st.current ? null : year;
    var label = function (c) { return hist ? HIST_LABEL[c] : CODE[c]; };

    var subnav = '<nav class="tabs sub-nav">' + groups.map(function (g) {
      return '<a class="tab-btn' + (g === group ? ' active' : '') + '" href="' + buildHash('estadisticas/' + g.id, { temporada: tParam }) + '">' + g.label + '</a>';
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
    var html = seasonSelect('stats-season', year, true) + subnav +
      '<div class="solid-box">' + sel +
      '<h3 class="box-title stat-title">' + esc(hist ? HIST_TITLE[code] : TITLE[code]) + '</h3>' +
      '<p class="box-desc">' + esc(hist ? HIST_DESC[code] : DESC[code]) + '</p>' + body + '</div>';

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

  // ---------- Estadísticas > Histórico ----------
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
      case 'TOP PF': return { cols: [['TOT', 'TOT', str, SC.blueUp]], fmt: str, week: SC.blueUp };
      case 'BOT PF': return { cols: [['TOT', 'TOT', str, SC.purpleUp]], fmt: str, week: SC.purpleUp };
      case 'TOP PA': return { cols: [['TOT', 'TOT', str, SC.purpleUp]], fmt: str, week: SC.purpleUp };
      case 'BOT PA': return { cols: [['TOT', 'TOT', str, SC.blueUp]], fmt: str, week: SC.blueUp };
    }
    return null;
  }

  function histStatTable(code) {
    var A = allTime(), T = A.tables[code], seasons = A.seasons;
    var rows = T.rows.filter(function (r) { return seasons.some(function (s) { return r.seasons[s.season] !== null; }); })
      .sort(function (a, b) { return (isNum(a.R) ? a.R : 999) - (isNum(b.R) ? b.R : 999) || mgrName(a.managerId).localeCompare(mgrName(b.managerId)); });
    var rR = rangeOf(rows.map(function (r) { return r.R; }));
    var live = seasons.filter(function (s) { return s.inProgress; })[0];
    var head = '<tr><th>R</th><th class="left sticky-col">Manager</th>';
    var cellHtml, sumHtml;
    if (code === 'GW') {
      var pcts = [];
      rows.forEach(function (r) { pcts.push(r.pct); seasons.forEach(function (s) { var c = r.seasons[s.season]; if (c) pcts.push(c.pct); }); });
      var pr = rangeOf(pcts), scale = SC.recB;
      head += '<th class="sum">G-P</th>';
      sumHtml = function (r) {
        return '<td class="sum" style="' + bg(r.pct, scale, pr) + '" title="' + fmt(r.pct * 100, 1) + '%">' + r.W + '-' + r.L + '</td>';
      };
      cellHtml = function (r, s) {
        var c = r.seasons[s.season];
        return '<td class="wk" style="' + bg(c.pct, SC.wkRec, pr) + '" title="' + fmt(c.pct * 100, 1) + '%">' + c.W + '-' + c.L + '</td>';
      };
    } else {
      var sp = histSpec(code);
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
          '<div class="mgr-card-meta"><span>' + recStr(t) + '</span><span class="dot">·</span><span>' +
            t.seasons + (t.seasons === 1 ? ' temporada' : ' temporadas') + '</span></div>' +
          (titleYears.length ? '<div class="mgr-card-titles" title="Campeón ' + titleYears.join(', ') + '">' +
            titleYears.map(function (y) { return '<span class="trophy">' + ICON_TROPHY + y + '</span>'; }).join('') + '</div>' : '') +
        '</div></a>';
    }
    var active = ids.filter(function (id) { return H.managers[id].active; });
    var former = ids.filter(function (id) { return !H.managers[id].active; });
    var html = '<div class="solid-box"><h3 class="box-title">Managers</h3><div class="mgr-grid">' + active.map(card).join('') + '</div></div>';
    if (former.length) html += '<div class="solid-box"><h3 class="box-title">Managers anteriores</h3><div class="mgr-grid">' + former.map(card).join('') + '</div></div>';
    $('#section-managers').innerHTML = html;
  }

  function renderPerfil(id) {
    var H = leagueHistory(), m = H.managers[id];
    if (!m || !m.seasons.length) { location.replace('#managers'); return; }
    var t = m.totals;
    var span = t.firstSeason === t.lastSeason ? String(t.firstSeason) : t.firstSeason + '–' + t.lastSeason;
    var badges = m.seasons.filter(function (s) { return s.playoffResult === 'c' || s.playoffResult === 'r'; }).map(function (s) {
      return '<span class="po-badge po-badge-' + s.playoffResult + '">' + (s.playoffResult === 'c' ? ICON_TROPHY : '') +
        PO_LABEL[s.playoffResult] + ' ' + s.season + '</span>';
    }).join('');

    var head = '<div class="solid-box perfil-head">' + avatar(id, 'lg') +
      '<div class="perfil-id">' +
        '<h2 class="perfil-name">' + esc(m.fullName || m.shortName) + '</h2>' +
        '<div class="perfil-sub">' + esc(m.seasons[m.seasons.length - 1].team) + '</div>' +
        '<div class="perfil-meta">' + (m.active ? 'Manager desde ' + t.firstSeason : 'Manager ' + span) +
          (m.active ? '' : ' <span class="chip">Anterior</span>') + '</div>' +
        (badges ? '<div class="po-badges">' + badges + '</div>' : '') +
      '</div></div>';

    var inProg = m.seasons.some(function (s) { return s.inProgress; });
    var tiles = [
      ['Temporadas', String(t.seasons)],
      ['Récord', recStr(t)],
      ['% de victorias', pct(t.pct)],
      ['Títulos', String(t.titles)],
      ['Finales', String(t.finals)],
      ['Playoffs', String(t.playoffs)],
      ['PF por partido', pts(t.avgPF)],
      ['PC por partido', pts(t.avgPA)],
      ['Mejor posición', isNum(t.bestPos) ? t.bestPos + 'º' : '–'],
      ['Posición promedio', isNum(t.avgPos) ? fmt(t.avgPos, 1) : '–']
    ];
    var tilesHtml = '<div class="solid-box"><h3 class="box-title">Carrera</h3><div class="tiles">' + tiles.map(function (x) {
      return '<div class="tile"><div class="tile-label">' + x[0] + '</div><div class="tile-value">' + x[1] + '</div></div>';
    }).join('') + '</div>' +
      '<p class="box-note">Solo temporada regular; los playoffs cuentan únicamente como resultado.' +
      (inProg ? ' Incluye la temporada en curso; la posición promedio y la mejor posición solo cuentan temporadas terminadas.' : '') + '</p></div>';

    // Season by season
    var difR = rangeOf(m.seasons.map(function (s) { return s.PF - s.PA; }));
    var rows = m.seasons.slice().reverse().map(function (s) {
      var n = H.seasons.filter(function (x) { return x.season === s.season; })[0].teams;
      var d = s.PF - s.PA;
      var po = s.inProgress ? '<span class="chip chip-live">En curso</span>'
        : s.playoffResult ? '<span class="po-txt po-txt-' + s.playoffResult + '">' + PO_LABEL[s.playoffResult] + '</span>' : '<span class="muted">–</span>';
      return '<tr><td><a class="link" href="#posiciones?temporada=' + s.season + '">' + s.season + '</a></td>' +
        '<td class="left team-td"><span class="team-name">' + esc(s.team) + '</span></td>' +
        '<td class="rk" style="' + bg(s.R, SC.rank, [1, n]) + '">' + (isNum(s.R) ? s.R + 'º' : '') + '</td>' +
        '<td style="' + bg(s.W / ((s.W + s.L + (s.T || 0)) || 1), SC.recB, rangeOf(m.seasons.map(function (x) { return x.W / ((x.W + x.L + (x.T || 0)) || 1); }))) + '">' + s.W + '-' + s.L + (s.T ? '-' + s.T : '') + '</td>' +
        '<td style="' + bg(s.PF, SC.pos, rangeOf(m.seasons.map(function (x) { return x.PF; }))) + '">' + pts(s.PF) + '</td>' +
        '<td style="' + bg(s.PA, SC.neg, rangeOf(m.seasons.map(function (x) { return x.PA; }))) + '">' + pts(s.PA) + '</td>' +
        '<td style="' + bg(d, DIF0, difR) + '">' + signed(d) + '</td>' +
        '<td class="po-td">' + po + '</td></tr>';
    }).join('');
    var seasonsHtml = '<div class="solid-box"><h3 class="box-title">Temporada por temporada</h3>' +
      '<div class="table-scroll"><table class="data-table"><thead><tr><th>Año</th><th class="left">Equipo</th><th>Pos</th><th>G-P</th>' +
      '<th>PF</th><th>PC</th><th>DIF</th><th>Playoffs</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<p class="box-note">Pos = posición final de la temporada regular (actual, si la temporada está en curso).</p></div>';

    // Head-to-head
    var opp = Object.keys(m.h2h).map(function (o) {
      var h = m.h2h[o];
      return { id: o, h: h, pct: h.games ? (h.W + h.T / 2) / h.games : null, dif: h.PF - h.PA };
    }).sort(function (a, b) { return b.h.games - a.h.games || b.pct - a.pct || mgrName(a.id).localeCompare(mgrName(b.id)); });
    var oDif = rangeOf(opp.map(function (x) { return x.dif; }));
    var h2hRows = opp.map(function (x) {
      var h = x.h;
      return '<tr><td class="left team-td"><a class="mgr-link" href="#managers/' + esc(x.id) + '">' + avatar(x.id, 'sm') +
        '<span>' + esc(mgrName(x.id)) + '</span></a></td>' +
        '<td>' + h.games + '</td>' +
        '<td style="' + bg(x.pct, SC.recB, rangeOf(opp.map(function (o) { return o.pct; }))) + '">' + recStr(h) + '</td>' +
        '<td style="' + bg(h.PF, SC.pos, rangeOf(opp.map(function (o) { return o.h.PF; }))) + '">' + pts(h.PF) + '</td>' +
        '<td style="' + bg(h.PA, SC.neg, rangeOf(opp.map(function (o) { return o.h.PA; }))) + '">' + pts(h.PA) + '</td>' +
        '<td style="' + bg(x.dif, DIF0, oDif) + '">' + signed(x.dif) + '</td></tr>';
    }).join('');
    var h2hHtml = '<div class="solid-box"><h3 class="box-title">Cara a cara</h3>' +
      '<div class="table-scroll"><table class="data-table"><thead><tr><th class="left">Rival</th><th>PJ</th><th>G-P</th>' +
      '<th>PF</th><th>PC</th><th>DIF</th></tr></thead><tbody>' + h2hRows + '</tbody></table></div></div>';

    // Team names over time
    var namesHtml = '<div class="solid-box"><h3 class="box-title">Nombres de equipo</h3><ul class="name-list">' +
      m.teamNames.slice().reverse().map(function (n) {
        return '<li><span class="team-name">' + esc(n.team) + '</span><span class="muted">' + yearsLabel(n.seasons) + '</span></li>';
      }).join('') + '</ul></div>';

    var html = '<a class="back-link" href="#managers">&larr; Managers</a>' + head + tilesHtml + personalRecordsHtml(id) +
      seasonsHtml + h2hHtml + namesHtml;
    $('#section-managers').innerHTML = html;
  }

  // Personal records on the profile (same definitions as Historia > Récords / Rachas).
  var PREC = {
    mostPts: { t: 'Más puntos', f: pts },
    fewestPts: { t: 'Menos puntos', f: pts },
    biggestWin: { t: 'Mayor margen de victoria', f: function (v) { return '+' + pts(v); } },
    worstLoss: { t: 'Peor derrota', f: function (v) { return '-' + pts(v); } },
    mostWins: { t: 'Mejor temporada', f: function (v) { return v + ' G'; } },
    bestPfPg: { t: 'Mejor PF por partido', f: pts },
    winStreak: { t: 'Racha de triunfos', f: function (v) { return v + ' G'; } },
    lossStreak: { t: 'Racha de derrotas', f: function (v) { return v + ' P'; } }
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
    function ctx(x) {
      if (x.type) { // streak
        return (x.active ? 'Desde ' + weekLink(x.start) + ' <span class="chip chip-live">Activa</span>' : weekLink(x.start) + ' → ' + weekLink(x.end));
      }
      if (x.week) return resultBadge(x.result) + ' ' + pts(x.pf) + '–' + pts(x.pa) + ' vs ' + esc(x.opp) + ' · ' + weekLink(x);
      return '<a class="link" href="#posiciones?temporada=' + x.season + '">' + x.season + '</a> · ' + esc(x.team) + ' · ' + x.W + '-' + x.L + (x.T ? '-' + x.T : '');
    }
    var cards = P.map(function (r) {
      var d = PREC[r.key];
      return '<div class="tile prec' + (r.league ? ' is-league' : '') + '"><div class="tile-label">' + d.t + '</div>' +
        '<div class="tile-value">' + d.f(r.value) + (r.league ? '<span class="league-tag">' + ICON_TROPHY + 'Récord de la liga</span>' : '') + '</div>' +
        r.entries.map(function (x) { return '<div class="prec-ctx">' + ctx(x) + '</div>'; }).join('') + '</div>';
    }).join('');
    return '<div class="solid-box"><h3 class="box-title">Récords personales</h3><div class="prec-grid">' + cards + '</div>' +
      '<p class="box-note">Temporada regular. Partidos y rachas incluyen la temporada en curso; las temporadas, solo las terminadas. ' +
      '"Récord de la liga" = igual al mejor de toda la liga (Historia › Récords y Rachas).</p></div>';
  }

  // ---------------------------------------------------------------- HISTORIA

  // Pages inside Historia (sub-nav). Each one is added as it is built.
  var HIST_PAGES = [
    { id: 'campeones', label: 'Campeones', render: histCampeones },
    { id: 'tabla', label: 'Tabla histórica', render: histTabla },
    { id: 'records', label: 'Récords', render: histRecords },
    { id: 'rachas', label: 'Rachas', render: histRachas },
    { id: 'vs', label: 'Cara a cara', render: histVs }
  ];

  function renderHistoria(params, sub) {
    var page = HIST_PAGES.filter(function (p) { return p.id === sub; })[0] || HIST_PAGES[0];
    var subnav = HIST_PAGES.length > 1 ? '<nav class="tabs sub-nav">' + HIST_PAGES.map(function (p) {
      return '<a class="tab-btn' + (p === page ? ' active' : '') + '" href="#historia/' + p.id + '">' + p.label + '</a>';
    }).join('') + '</nav>' : '';
    var sec = $('#section-historia');
    sec.innerHTML = subnav + page.render(params);
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
      '<table class="data-table"><thead><tr><th>Pos</th><th class="left">Manager</th><th title="Temporadas">Temp.</th><th title="Partidos jugados">PJ</th>' +
      '<th>' + (anyT ? 'G-P-E' : 'G-P') + '</th><th>PF</th><th>PC</th><th>DIF</th>' +
      '<th title="Puntos a favor por partido">PF/PJ</th><th>Títulos</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="box-note">Solo temporada regular, ' + H.seasons[0].season + '–' + H.seasons[H.seasons.length - 1].season +
      (live ? ' (incluye la temporada ' + live.season + ', en curso)' : '') + '. Orden: triunfos, luego puntos a favor (PF).</p></div>';

    // Final regular-season position per season (same manager order).
    var seasons = H.seasons;
    var head = '<tr><th class="left">Manager</th>' + seasons.map(function (s) {
      return '<th class="wk" title="' + s.teams + ' equipos">' + s.season + (s.inProgress ? '*' : '') + '</th>';
    }).join('') + '<th class="sum">PROM</th><th class="sum">MEJOR</th></tr>';
    var rAvgPos = col(function (m) { return m.totals.avgPos; });
    var grid = list.map(function (m) {
      return '<tr><td class="left team-td"><a class="mgr-link" href="#managers/' + esc(m.managerId) + '">' + avatar(m.managerId, 'sm') + '<span>' + esc(m.shortName) + '</span></a></td>' +
        seasons.map(function (s) {
          var p = H.positions[s.season][m.managerId];
          if (!p || !isNum(p.R)) return '<td class="wk pos-empty"></td>';
          return '<td class="wk" style="' + bg(p.R, SC.rank, [1, s.teams]) + '"><a class="pos-link" href="#posiciones?temporada=' + s.season + '">' + p.R + 'º</a></td>';
        }).join('') +
        '<td class="sum" style="' + bg(m.totals.avgPos, [K.green, K.grey, K.red], rAvgPos) + '">' + (isNum(m.totals.avgPos) ? fmt(m.totals.avgPos, 1) : '') + '</td>' +
        '<td class="sum">' + (isNum(m.totals.bestPos) ? m.totals.bestPos + 'º' : '') + '</td></tr>';
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
    overProj: { t: 'Puntaje sorpresa', kind: 'team', f: signed, note: 'PF menos proyección' },
    underProj: { t: 'Puntaje decepción', kind: 'team', f: signed, note: 'PF menos proyección' },
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
    mostTop1: { t: 'Más semanas como máximo anotador', f: str },
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

  function recWhen(x) {
    return '<a class="link rec-when" href="#resultados?temporada=' + x.season + '&semana=' + x.week + '">' + x.season + ' · S' + x.week + '</a>';
  }
  function recHolder(x, def, big) {
    var who, ctx;
    if (x.winner) {
      who = '<span class="rec-team">' + esc(x.winner.team) + '</span> <span class="rec-score">' + pts(x.winner.pf) + '–' + pts(x.loser.pf) +
        '</span> <span class="rec-team">' + esc(x.loser.team) + '</span>';
      ctx = esc(mgrName(x.winner.managerId)) + ' vs ' + esc(mgrName(x.loser.managerId)) + ' · ' + recWhen(x);
      if (def === REC_GAME.upset || def === REC_GAME.unexpected) ctx += ' · Proy. ' + pts(x.winner.proj) + '–' + pts(x.loser.proj);
    } else if (x.week) {
      who = '<span class="rec-team">' + esc(x.team) + '</span>';
      ctx = esc(mgrName(x.managerId)) + ' · ' + resultBadge(x.result) + ' ' + pts(x.pf) + '–' + pts(x.pa) + ' vs ' + esc(x.opp) + ' · ' + recWhen(x);
      if (isNum(x.projPf) && (def === REC_GAME.overProj || def === REC_GAME.underProj)) ctx += ' · Proy. ' + pts(x.projPf);
    } else {
      who = '<span class="rec-team">' + esc(x.team) + '</span>';
      ctx = esc(mgrName(x.managerId)) + ' · <a class="link" href="#posiciones?temporada=' + x.season + '">' + x.season + '</a> · ' +
        x.W + '-' + x.L + (x.T ? '-' + x.T : '');
    }
    return '<div class="rec-holder' + (big ? ' big' : '') + '">' + (big ? '' : '') + '<div class="rec-who">' + who + '</div><div class="rec-ctx">' + ctx + '</div></div>';
  }

  function recCard(rec, def) {
    var e = rec.entries;
    var leaders = e.filter(function (x) { return x.rank === 1; });
    var rest = e.filter(function (x) { return x.rank !== 1; });
    return '<div class="rec-card"><div class="rec-title">' + def.t + '</div>' +
      (def.note ? '<div class="rec-note">' + def.note + '</div>' : '') +
      '<div class="rec-value">' + def.f(leaders[0].value) + '</div>' +
      leaders.map(function (x) { return recHolder(x, def, true); }).join('') +
      (rest.length ? '<ol class="rec-list">' + rest.map(function (x) {
        return '<li><span class="rec-rank">' + x.rank + '</span><span class="rec-val">' + def.f(x.value) + '</span>' + recHolder(x, def, false) + '</li>';
      }).join('') + '</ol>' : '') + '</div>';
  }

  function histRecords() {
    var R = records(), H = leagueHistory();
    var live = H.seasons.filter(function (s) { return s.inProgress; })[0];
    var game = R.game.map(function (r) { return recCard(r, REC_GAME[r.key]); }).join('');
    var season = R.season.map(function (r) { return recCard(r, REC_SEASON[r.key]); }).join('');
    return '<div class="solid-box"><h3 class="box-title">Récords de partido</h3><div class="rec-grid">' + game + '</div>' +
      '<p class="box-note">Solo temporada regular' + (live ? ', incluye la temporada ' + live.season + ' en curso' : '') +
      '. Se muestran los 5 primeros y todos los empatados en el 5º lugar.</p></div>' +
      '<div class="solid-box"><h3 class="box-title">Récords de temporada</h3><div class="rec-grid">' + season + '</div>' +
      '<p class="box-note">Solo temporadas regulares terminadas. Los promedios por partido permiten comparar temporadas de 14 y 15 semanas.</p></div>';
  }

  // Rachas: win/loss streaks across seasons, following the manager (Stage 7).
  function streaks() {
    if (!st.streaks) {
      var games = [];
      st.years.slice().reverse().forEach(function (y) { games = games.concat(st.seasons[y].games); });
      st.streaks = S.computeStreaks(games);
    }
    return st.streaks;
  }
  function weekLink(p) {
    return '<a class="link" href="#resultados?temporada=' + p.season + '&semana=' + p.week + '">' + p.season + ' · S' + p.week + '</a>';
  }
  function streakTable(list, type) {
    var r = rangeOf(list.map(function (x) { return x.length; }));
    var body = list.map(function (x) {
      var teams = x.start.team === x.end.team ? esc(x.end.team) : esc(x.start.team) + ' → ' + esc(x.end.team);
      return '<tr><td class="rk">' + x.rank + '</td>' +
        '<td class="left team-td"><a class="mgr-link" href="#managers/' + esc(x.managerId) + '">' + avatar(x.managerId, 'sm') +
          '<span class="mgr-chip-txt"><span class="team-name">' + esc(mgrName(x.managerId)) + '</span><span class="team-mgr">' + teams + '</span></span></a></td>' +
        '<td class="streak-len" style="' + bg(x.length, type === 'W' ? SC.wins : SC.losses, r) + '">' + x.length + '</td>' +
        '<td>' + weekLink(x.start) + '</td><td>' + (x.active ? '<span class="chip chip-live">Activa</span>' : weekLink(x.end)) + '</td></tr>';
    }).join('');
    return '<div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th class="left">Manager</th><th>' +
      (type === 'W' ? 'G' : 'P') + '</th><th>Desde</th><th>Hasta</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
  function histRachas() {
    var K = streaks();
    var cur = K.current.map(function (x) {
      var lbl = ({ W: 'G', L: 'P', T: 'E' }[x.type]) + x.length;
      return '<tr><td class="left team-td"><a class="mgr-link" href="#managers/' + esc(x.managerId) + '">' + avatar(x.managerId, 'sm') +
        '<span class="mgr-chip-txt"><span class="team-name">' + esc(mgrName(x.managerId)) + '</span><span class="team-mgr">' + esc(x.end.team) + '</span></span></a></td>' +
        '<td class="streak-len" style="' + wlStyle(x.type) + '">' + lbl + '</td>' +
        '<td>' + weekLink(x.start) + '</td></tr>';
    }).join('');
    return '<div class="rachas-grid">' +
      '<div class="solid-box"><h3 class="box-title">Triunfos seguidos</h3>' + streakTable(K.wins, 'W') + '</div>' +
      '<div class="solid-box"><h3 class="box-title">Derrotas seguidas</h3>' + streakTable(K.losses, 'L') + '</div></div>' +
      '<div class="solid-box"><h3 class="box-title">Racha actual</h3><div class="table-scroll"><table class="data-table racha-actual">' +
      '<thead><tr><th class="left">Manager</th><th>Racha</th><th>Desde</th></tr></thead><tbody>' + cur + '</tbody></table></div>' +
      '<p class="box-note">Solo temporada regular. Las rachas siguen al manager y continúan de una temporada a la siguiente; un empate corta la racha. ' +
      '"Activa" = la racha sigue vigente. Se muestran los 10 primeros y todos los empatados en el 10º lugar.</p></div>';
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
          return '<td class="wk" style="' + style + '" title="' + esc(m.shortName) + ' vs ' + esc(o.shortName) + ': ' + recStr(h) +
            ' · PF ' + pts(h.PF) + ' · PC ' + pts(h.PA) + '">' + recStr(h) + '</td>';
        }).join('') + '</tr>';
    }).join('');
    return '<div class="solid-box"><h3 class="box-title">Cara a cara</h3>' +
      '<p class="box-desc">Récord histórico de cada manager (fila) contra cada rival (columna), temporada regular.</p>' +
      '<div class="table-scroll"><table class="data-table stat-table vs-table vs-all"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="box-note">Verde = récord ganador, rojo = perdedor, gris = empatado. Pasa el cursor (o toca) una celda para ver PF y PC; el detalle completo está en el perfil de cada manager.</p></div>';
  }

  // Campeones: playoff results per season (newest first) + titles by manager.
  function histCampeones() {
    var H = leagueHistory();
    var rows = H.champions.slice().reverse().map(function (c) {
      var s = H.seasons.filter(function (x) { return x.season === c.season; })[0];
      var yr = '<td class="ch-year"><a class="link" href="#posiciones?temporada=' + c.season + '">' + c.season + '</a></td>';
      if (!c.champion) {
        var msg = s.inProgress ? 'Temporada en curso · Semana ' + s.playedWeeks + ' de ' + s.regWeeks : 'Sin resultado registrado';
        return '<tr>' + yr + '<td class="ch-pending" colspan="3"><span class="chip' + (s.inProgress ? ' chip-live' : '') + '">' +
          (s.inProgress ? 'En curso' : 'Pendiente') + '</span> <span class="muted">' + msg + '</span></td></tr>';
      }
      function regPos(t) {
        var p = H.positions[c.season][t.managerId];
        return p && isNum(p.R) ? '<span class="ch-reg">' + p.R + 'º en temporada regular</span>' : '';
      }
      return '<tr>' + yr +
        '<td class="ch-c"><div class="ch-cell">' + ICON_TROPHY + '<div>' + mgrChip(c.champion.managerId, c.champion.team) + regPos(c.champion) + '</div></div></td>' +
        '<td class="ch-r">' + (c.runnerUp ? mgrChip(c.runnerUp.managerId, c.runnerUp.team) + regPos(c.runnerUp) : '') + '</td>' +
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
        '<td class="left ch-years">' + (x.years.length ? x.years.map(function (y) { return '<span class="trophy">' + ICON_TROPHY + y + '</span>'; }).join('') : '<span class="muted">–</span>') + '</td></tr>';
    }).join('');
    var titles = '<div class="solid-box"><h3 class="box-title">Títulos por manager</h3><div class="table-scroll">' +
      '<table class="data-table titles-table"><thead><tr><th class="left">Manager</th><th>Títulos</th><th title="Finales perdidas">Subcampeonatos</th><th>Playoffs</th>' +
      '<th title="Temporadas terminadas">Temp.</th><th title="Playoffs / temporadas terminadas">% Playoffs</th><th class="left">Campeón</th></tr></thead><tbody>' +
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

  function wrapDecimals(table) {
    var walker = document.createTreeWalker(table, NodeFilter.SHOW_TEXT, null), nodes = [], n;
    while ((n = walker.nextNode())) {
      if (/\d\.\d/.test(n.nodeValue) && n.parentNode.closest('td')) nodes.push(n);
    }
    nodes.forEach(function (t) {
      var m = t.nodeValue.match(/^([\s\S]*?\d)(\.\d+)([\s\S]*)$/);
      if (!m) return;
      var frag = document.createDocumentFragment(), dec = document.createElement('span');
      frag.appendChild(document.createTextNode(m[1]));
      dec.className = 'dec'; dec.textContent = m[2]; frag.appendChild(dec);
      if (m[3]) frag.appendChild(document.createTextNode(m[3]));
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
})();
