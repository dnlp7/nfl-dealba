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
    return v.toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
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
    return {
      teams: rows.length,
      avg: scores.reduce(function (a, b) { return a + b; }, 0) / scores.length,
      high: best(rows, function (g) { return g.pf; }),
      low: best(rows, function (g) { return g.pf; }, true),
      blowout: best(ms, function (m) { return m.margin; }),
      closest: best(ms, function (m) { return m.margin; }, true),
      over: best(rows, function (g) { return isNum(g.projPf) ? g.pf - g.projPf : null; }),
      under: best(rows, function (g) { return isNum(g.projPf) ? g.pf - g.projPf : null; }, true)
    };
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
    red: '#cd0f2f', grey: '#434343', green: '#40b031', purple: '#6336b3', blue: '#2362d9',
    accent: '#2d9ee0', slate: '#283f4c', navy: '#293245', plum: '#312742',
    dkGreen: '#2b4328', dkRed: '#43272c', magenta: '#cd0fa8', dkMagenta: '#43243d',
    wkWin: '#1c5b14', wkLoss: '#5d0c1a', black: '#111111', winText: '#48cb36'
  };
  // A scale is [lowColor, highColor] or [lowColor, midColor, highColor, midValue?]
  // (midValue omitted = halfway between min and max).
  var SC = {
    good3: [K.red, K.grey, K.green],        // totals/averages: higher is better
    bad3: [K.green, K.grey, K.red],         // totals/averages: higher is worse
    mm: [K.purple, K.grey, K.blue],         // MAX/MIN pair (one range for both columns)
    mmPa: [K.blue, K.grey, K.purple],
    wkPf: [K.slate, K.accent],              // weekly points for
    wkPa: [K.dkMagenta, K.magenta],         // weekly points against
    footPf: [K.navy, K.blue],               // PROM row
    footPa: [K.dkMagenta, K.magenta],
    div: [K.wkLoss, K.black, K.wkWin, 0],   // weekly +/- around zero
    divInv: [K.wkWin, K.black, K.wkLoss, 0],
    rank: [K.accent, K.slate],              // R column: 1 brightest
    wins: [K.dkGreen, K.green], losses: [K.dkRed, K.red],
    fav: [K.dkGreen, K.grey, K.green], und: [K.dkRed, K.grey, K.red],
    blueUp: [K.navy, K.blue], purpleUp: [K.plum, K.purple], blueDown: [K.blue, K.navy],
    greenDown: [K.green, K.dkGreen], redDown: [K.red, K.dkRed],
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
    if (r === 'L') return 'background:' + K.wkLoss + ';color:' + K.red;
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

  function seasonSelect(id, year) {
    return '<div class="controls controls-season-nav">' +
      '<select id="' + id + '" aria-label="Temporada">' +
      st.years.map(function (y) { return '<option value="' + y + '"' + (y === year ? ' selected' : '') + '>' + y + '</option>'; }).join('') +
      '</select>' +
      '<div class="season-nav">' +
      '<button type="button" class="nav-btn" data-step="-1" aria-label="Temporada anterior"' + (year === st.years[st.years.length - 1] ? ' disabled' : '') + '>&#9664;</button>' +
      '<button type="button" class="nav-btn" data-step="1" aria-label="Temporada siguiente"' + (year === st.years[0] ? ' disabled' : '') + '>&#9654;</button>' +
      '</div></div>';
  }
  function bindSeasonSelect(root, year, go) {
    $('select', root).addEventListener('change', function (e) { go(Number(e.target.value)); });
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

  var AWARDS = [
    { key: 'high', title: 'MVP', val: function (a) { return pts(a.high.value); }, who: 'team' },
    { key: 'low', title: 'Peor puntaje', val: function (a) { return pts(a.low.value); }, who: 'team' },
    { key: 'blowout', title: 'Mayor margen', val: function (a) { return '+' + pts(a.blowout.value); }, who: 'matchup' },
    { key: 'closest', title: 'Menor margen', val: function (a) { return pts(a.closest.value); }, who: 'matchup' },
    { key: 'over', title: 'Arriba de la proyección', val: function (a) { return signed(a.over.value); }, who: 'team' },
    { key: 'under', title: 'Debajo de la proyección', val: function (a) { return signed(a.under.value); }, who: 'team' }
  ];

  function awardsHtml(a, keys) {
    return '<div class="awards">' + AWARDS.filter(function (d) {
      return (!keys || keys.indexOf(d.key) >= 0) && a[d.key];
    }).map(function (d) {
      var who = a[d.key].items.map(function (x) {
        if (d.who === 'matchup') {
          return '<div class="award-who">' + esc(x.top.team) + ' <span class="vs">vs</span> ' + esc(x.bottom.team) + '</div>';
        }
        return '<div class="award-who">' + esc(x.team) + ' <span class="award-mgr">' + esc(mgrName(x.managerId)) + '</span></div>';
      }).join('');
      return '<div class="award"><div class="award-title">' + d.title + '</div>' +
        '<div class="award-value">' + d.val(a) + '</div>' + who +
        (d.note ? '<div class="award-note">' + d.note + '</div>' : '') + '</div>';
    }).join('') + '</div>';
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
        boxHead('Últimos Resultados', weekLabel(wtype, lastWeek)) +
        '<div class="matchups-grid">' + matchups(year, lastWeek).map(function (m) { return matchupCard(m, { compact: true }); }).join('') + '</div>' +
        '<h4 class="box-subtitle">Highlights</h4>' +
        awardsHtml(a, ['high', 'low', 'blowout', 'closest', 'over', 'under']) +
        '<a class="more-link" href="#resultados?temporada=' + year + '&semana=' + lastWeek + '">Ver detalles &rarr;</a>' +
        '</div>';
    }
    html += '</div>';

    // Right column: standings (no box), then next week's matchups
    var std = sorted(C.tables.STD.rows);
    html += '<div class="inicio-side">';
    html += '<div class="inicio-tabla">' + miniStandings(std, C) +
      '<a class="more-link" href="#posiciones?temporada=' + year + '">Ver tabla completa &rarr;</a></div>';
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

  function miniStandings(rows, C) {
    var rR = rangeOf(rows.map(function (r) { return r.R; })), rW = rangeOf(rows.map(function (r) { return r.W; }));
    var rPF = rangeOf(rows.map(function (r) { return r.PF; }));
    return '<table class="data-table mini-table"><thead><tr><th></th><th class="left">Equipo</th><th>G-P</th><th>PF</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        var cut = i === C.playoffSpots - 1 ? ' class="po-cut"' : '';
        return '<tr' + cut + '><td class="rk" style="' + bg(r.R, SC.rank, rR) + '">' + r.R + '</td><td class="left team-td">' + teamCell(r) + '</td>' +
          '<td style="' + bg(r.W, SC.wins, rW) + '">' + r.W + '-' + r.L + (r.T ? '-' + r.T : '') + '</td><td style="' + bg(r.PF, SC.mm, rPF) + '">' + pts(r.PF) + '</td></tr>';
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

    var head = '<tr><th>Pos</th><th class="left">Equipo</th><th>G</th><th>P</th>' + (anyTies ? '<th>E</th>' : '') +
      '<th>PF</th><th>PC</th><th>DIF</th><th title="Triunfos globales: contra todos los equipos cada semana">TG</th>' +
      '<th title="Ranking de poder">PWR</th><th>Racha</th><th class="form-col">Últimos 5</th></tr>';

    var col = function (fn) { return rangeOf(std.map(fn)); };
    var rR = col(function (r) { return r.R; }), rW = col(function (r) { return r.W; }), rL = col(function (r) { return r.L; });
    var rPF = col(function (r) { return r.PF; }), rPA = col(function (r) { return pa[r.managerId].TOT; });
    var rDIF = col(function (r) { return r.PF - pa[r.managerId].TOT; });
    var rGW = col(function (r) { return gw[r.managerId].W; }), rPWR = col(function (r) { return pwr[r.managerId].R; });

    var body = std.map(function (r, i) {
      var p = pa[r.managerId].TOT, d = r.PF - p, g = gw[r.managerId], f = form(r, C.playedWeeks);
      var cut = i === C.playoffSpots - 1 ? ' class="po-cut"' : '';
      return '<tr' + cut + '>' +
        '<td class="rk" style="' + bg(r.R, SC.rank, rR) + '">' + r.R + '</td>' +
        '<td class="left team-td">' + teamCell(r) + '</td>' +
        '<td style="' + bg(r.W, SC.wins, rW) + '">' + r.W + '</td>' +
        '<td style="' + bg(r.L, SC.losses, rL) + '">' + r.L + '</td>' + (anyTies ? '<td>' + r.T + '</td>' : '') +
        '<td style="' + bg(r.PF, SC.mm, rPF) + '">' + pts(r.PF) + '</td>' +
        '<td style="' + bg(p, SC.mmPa, rPA) + '">' + pts(p) + '</td>' +
        '<td style="' + bg(d, SC.good3, rDIF) + '">' + signed(d) + '</td>' +
        '<td style="' + bg(g.W, SC.wins, rGW) + '">' + g.W + '-' + g.L + '</td>' +
        '<td style="' + bg(pwr[r.managerId].R, SC.rank, rPWR) + '">' + (pwr[r.managerId].R || '') + '</td>' +
        '<td style="' + wlStyle(f.last5[f.last5.length - 1]) + '">' + f.streak + '</td>' +
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
    'PF': 'Puntos a Favor', 'PA': 'Puntos en Contra', 'DIF': 'Diferencia de puntos',
    'PR PF': 'Puntos Proyectados a Favor', 'PR PA': 'Puntos Proyectados en Contra',
    'PF vsPR': 'Puntos a Favor vs Puntos Proyectados', 'PA vsPR': 'Puntos en Contra vs Puntos Proyectados',
    'PR PFvsPA': 'Puntos Proyectados a Favor vs Puntos Proyectados en Contra',
    'Rk PF': 'Ranking semanal de Puntos a Favor', 'Rk PA': 'Ranking semanal de Puntos en Contra',
    'Rk PF TOT': 'Ranking anual de Puntos a Favor', 'Rk PA TOT': 'Ranking anual de Puntos en Contra',
    'PF W': 'Puntos a Favor en triunfos', 'PF L': 'Puntos a Favor en derrotas',
    'PA W': 'Puntos en Contra en triunfos', 'PA L': 'Puntos en Contra en derrotas',
    'GW': 'Triunfos Globales', 'PWR': 'Power Ranking', 'STD xW': 'Tabla por Semana', 'VS': 'Record vs rivales'
  };
  var DESC = {
    'PF': 'Puntos conseguidos por cada equipo por semana',
    'PA': 'Puntos del rival de cada equipo por semana',
    'DIF': 'Diferencia de puntos por cada equipo vs su rival por semana. Un número positivo implica que el equipo ganó su duelo en dicha semana.',
    'PR PF': 'Puntos proyectados por cada equipo por semana',
    'PR PA': 'Puntos proyectados del rival de cada equipo por semana',
    'PF vsPR': 'Balance de puntos conseguidos vs proyectados por cada equipo por semana. Un número positivo implica que el equipo superó sus expectativas.',
    'PA vsPR': 'Balance del rival de cada equipo de puntos conseguidos vs proyectados por semana. Un número positivo implica que el equipo rival superó sus expectativas.',
    'PR PFvsPA': 'Diferencia de puntos proyectados de cada equipo vs puntos proyectados a su rival cada semana. Un número positivo implica que el equipo era favorito a ganar.',
    'Rk PF': 'Ranking por semana de puntos conseguidos por cada equipo con respecto al resto de la liga',
    'Rk PA': 'Ranking por semana de puntos del rival por cada equipo con respecto al resto de la liga',
    'Rk PF TOT': 'Ranking de puntos conseguidos por cada equipo cada semana con respecto a todos los demás puntajes del torneo',
    'Rk PA TOT': 'Ranking de puntos conseguidos por el rival de cada equipo cada semana con respecto a todos los demás puntajes del torneo',
    'PF W': 'Puntos conseguidos por cada equipo por semana en partidos ganados',
    'PF L': 'Puntos conseguidos por cada equipo por semana en partidos perdidos',
    'PA W': 'Puntos del rival de cada equipo por semana en partidos ganados',
    'PA L': 'Puntos del rival de cada equipo por semana en partidos perdidos',
    'GW': 'Total de triunfos de cada equipo si enfrentara a todos los demás equipos de la liga cada semana',
    'PWR': 'Power ranking calculado de acuerdo al PF semanal de cada equipo vs la mediana, con ajuste de reciente',
    'STD xW': 'Lugar en la tabla general de cada equipo tras cada semana',
    'VS': 'Record de cada equipo vs cada rival'
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
      return (tot ? [['TOT', tot, f, pa ? SC.bad3 : SC.good3]] : []).concat([
        ['AVG', 'PROM', f, pa ? SC.bad3 : SC.good3],
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
        return { cols: [['FAV', 'FAV', str, SC.fav], ['UND', 'UND', str, SC.und],
          ['MAX', 'MÁX', signed, SC.mm, true], ['MIN', 'MÍN', signed, SC.mm, true]], week: SC.div, fmt: signed, foot: SC.footPf };
      case 'Rk PF':
        return { cols: [['AVG', 'PROM', dec1, SC.greenDown], ['TOP1', 'TOP1', str, SC.blueUp], ['TOPHALF', 'TOP' + half, str, SC.blueUp],
          ['BOTHALF', 'BOT' + half, str, SC.purpleUp], ['BOT1', 'BOT1', str, SC.purpleUp]], week: SC.accentDown, fmt: str };
      case 'Rk PA':
        return { cols: [['AVG', 'PROM', dec1, SC.redDown], ['TOP1', 'TOP1', str, SC.purpleUp], ['TOPHALF', 'TOP' + half, str, SC.purpleUp],
          ['BOTHALF', 'BOT' + half, str, SC.blueUp], ['BOT1', 'BOT1', str, SC.blueUp]], week: SC.magentaDown, fmt: str };
      case 'Rk PF TOT': case 'Rk PA TOT':
        var pa = code === 'Rk PA TOT';
        return { cols: [['AVG', 'PROM', dec1, pa ? SC.redDown : SC.greenDown]].concat(
          ['TOP10', 'TOP25', 'TOP50', 'BOT50', 'BOT25', 'BOT10'].map(function (k) {
            var top = k[0] === 'T';
            return [k, k + '%', pct, (top !== pa) ? SC.blueUp : SC.purpleUp];
          })), week: pa ? SC.magentaDown : SC.accentDown, fmt: str };
      case 'PF W': case 'PF L':
        return { cols: pointsCols(null, false), week: SC.wkPf, fmt: pts, foot: SC.footPf };
      case 'PA W': case 'PA L':
        return { cols: pointsCols(null, true), week: SC.wkPa, fmt: pts, foot: SC.footPa };
      case 'GW':
        return { cols: [['W', 'G', str, SC.wins], ['L', 'P', str, SC.losses]], week: SC.blueUp, fmt: str };
      case 'PWR':
        return { cols: [['PWR', 'PWR', signed, SC.good3]], week: SC.div, fmt: signed };
      case 'STD xW':
        return { cols: [['AVG', 'PROM', dec1, SC.bad3], ['TOP_PO_PCT', 'TOP' + C.playoffSpots + ' %', pct, SC.good3],
          ['BEST', 'TOP', str, SC.blueDown], ['WORST', 'BOT', str, SC.purpleUp]],
          week: [K.wkWin, K.black, K.wkLoss, C.playoffSpots + 1], fmt: str };
    }
    return null;
  }

  function statTable(code, C) {
    if (code === 'VS') return vsTable(C);
    var T = C.tables[code], sp = spec(code, C);
    var rows = sorted(T.rows);
    var weeks = C.playedWeeks;
    var wVals = [];
    rows.forEach(function (r) { weeks.forEach(function (w) { wVals.push(r.weeks[w]); }); });
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
          return '<td class="sum" style="' + bg(v, c[3], colR[i]) + '">' + (isNum(v) ? c[2](v) : '') + '</td>';
        }).join('') +
        weeks.map(function (w) {
          var v = r.weeks[w];
          return '<td class="wk" style="' + bg(v, sp.week, wr) + '">' + (isNum(v) ? sp.fmt(v) : '') + '</td>';
        }).join('') + '</tr>';
    }).join('');

    var foot = '';
    var F = T.footer;
    if (F && F.AVG && sp.foot) {
      var fr = rangeOf(weeks.map(function (w) { return F.AVG[w]; }));
      foot = '<tr class="foot"><td class="foot-gap" colspan="' + (1 + sp.cols.length) + '"></td>' +
        '<td class="foot-label">PROM:</td>' +
        weeks.map(function (w) { var v = F.AVG[w]; return '<td class="wk" style="' + bg(v, sp.foot, fr) + '">' + (isNum(v) ? pts(v) : '') + '</td>'; }).join('') + '</tr>';
    }
    return '<div class="table-scroll"><table class="data-table stat-table"><thead>' + head + '</thead><tbody>' + body + '</tbody>' +
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
        '<td class="sum" style="' + bg(r.W, SC.wins, rW) + '">' + r.W + '-' + r.L + (r.T ? '-' + r.T : '') + '</td>' +
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
    var year = Number(params.temporada) || st.current;
    if (!st.seasons[year]) year = st.current;
    var group = GROUPS.filter(function (g) { return g.id === sub; })[0] || GROUPS[0];
    var code = group.tables.indexOf(params.tabla) >= 0 ? params.tabla : group.tables[0];
    var C = computed(year);

    var subnav = '<nav class="tabs sub-nav">' + GROUPS.map(function (g) {
      return '<a class="tab-btn' + (g === group ? ' active' : '') + '" href="' + buildHash('estadisticas/' + g.id, { temporada: year === st.current ? null : year }) + '">' + g.label + '</a>';
    }).join('') + '</nav>';
    var sel = group.tables.length > 1 ? '<div class="stat-selector">' + group.tables.map(function (c) {
      return '<button type="button" class="stat-btn' + (c === code ? ' active' : '') + '" data-code="' + esc(c) + '">' + esc(CODE[c]) + '</button>';
    }).join('') + '</div>' : '';

    var html = seasonSelect('stats-season', year) + subnav +
      '<div class="solid-box">' + sel +
      '<h3 class="box-title stat-title">' + esc(TITLE[code]) + '</h3>' +
      '<p class="box-desc">' + esc(DESC[code]) + '</p>' +
      (C.playedWeeks.length ? statTable(code, C) : '<p class="box-note">Aún no hay semanas terminadas.</p>') +
      '</div>';

    var sec = $('#section-estadisticas');
    sec.innerHTML = html;
    bindSeasonSelect(sec, year, function (y) { setParams('estadisticas/' + group.id, { temporada: y === st.current ? null : y, tabla: code === group.tables[0] ? null : code }); });
    $all('.stat-btn', sec).forEach(function (b) {
      b.addEventListener('click', function () {
        setParams('estadisticas/' + group.id, { temporada: year === st.current ? null : year, tabla: b.dataset.code === group.tables[0] ? null : b.dataset.code });
      });
    });
  }

  // ---------------------------------------------------------------- history (all seasons)

  // computeHistory over every loaded season (2026 counts live, Stage 7).
  function history() {
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
  var DIF0 = [K.red, K.grey, K.green, 0];

  var PO_LABEL = { c: 'Campeón', r: 'Subcampeón', s: 'Semifinal' };

  // ---------------------------------------------------------------- MANAGERS

  function renderManagers(params, sub) {
    if (sub) return renderPerfil(sub);
    var H = history();
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
    var H = history(), m = H.managers[id];
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
        '<td>' + s.W + '</td><td>' + s.L + '</td>' +
        '<td>' + pts(s.PF) + '</td><td>' + pts(s.PA) + '</td>' +
        '<td style="' + bg(d, DIF0, difR) + '">' + signed(d) + '</td>' +
        '<td class="po-td">' + po + '</td></tr>';
    }).join('');
    var seasonsHtml = '<div class="solid-box"><h3 class="box-title">Temporada por temporada</h3>' +
      '<div class="table-scroll"><table class="data-table"><thead><tr><th>Año</th><th class="left">Equipo</th><th>Pos</th><th>G</th><th>P</th>' +
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
        '<td style="' + (h.W > h.L ? wlStyle('W') : h.L > h.W ? wlStyle('L') : '') + '">' + recStr(h) + '</td>' +
        '<td style="' + bg(x.pct, [K.red, K.grey, K.green, 0.5], [0, 1]) + '">' + pct(x.pct) + '</td>' +
        '<td>' + pts(h.PF) + '</td><td>' + pts(h.PA) + '</td>' +
        '<td style="' + bg(x.dif, DIF0, oDif) + '">' + signed(x.dif) + '</td></tr>';
    }).join('');
    var h2hHtml = '<div class="solid-box"><h3 class="box-title">Cara a cara</h3>' +
      '<div class="table-scroll"><table class="data-table"><thead><tr><th class="left">Rival</th><th>PJ</th><th>G-P</th><th>%</th>' +
      '<th>PF</th><th>PC</th><th>DIF</th></tr></thead><tbody>' + h2hRows + '</tbody></table></div></div>';

    // Team names over time
    var namesHtml = '<div class="solid-box"><h3 class="box-title">Nombres de equipo</h3><ul class="name-list">' +
      m.teamNames.slice().reverse().map(function (n) {
        return '<li><span class="team-name">' + esc(n.team) + '</span><span class="muted">' + yearsLabel(n.seasons) + '</span></li>';
      }).join('') + '</ul></div>';

    var html = '<a class="back-link" href="#managers">&larr; Managers</a>' + head + tilesHtml +
      seasonsHtml + h2hHtml + namesHtml;
    $('#section-managers').innerHTML = html;
  }

  // ---------------------------------------------------------------- HISTORIA

  // Pages inside Historia (sub-nav). Each one is added as it is built.
  var HIST_PAGES = [
    { id: 'campeones', label: 'Campeones', render: histCampeones },
    { id: 'tabla', label: 'Tabla histórica', render: histTabla }
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
    var H = history();
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
        '<td style="' + bg(t.W, SC.wins, rW) + '">' + t.W + '</td>' +
        '<td style="' + bg(t.L, SC.losses, rL) + '">' + t.L + '</td>' + (anyT ? '<td>' + t.T + '</td>' : '') +
        '<td style="' + bg(t.pct, [K.red, K.grey, K.green, 0.5], [0.3, 0.7]) + '">' + fmt(t.pct * 100, 1) + '%</td>' +
        '<td style="' + bg(t.PF, SC.mm, rPF) + '">' + pts(t.PF) + '</td>' +
        '<td style="' + bg(t.PA, SC.mmPa, rPA) + '">' + pts(t.PA) + '</td>' +
        '<td style="' + bg(t.DIF, DIF0, rD) + '">' + signed(t.DIF) + '</td>' +
        '<td style="' + bg(t.avgPF, SC.good3, rAvg) + '">' + pts(t.avgPF) + '</td>' +
        '<td style="' + bg(t.titles, SC.blueUp, rT) + '">' + t.titles + '</td></tr>';
    }).join('');
    var table = '<div class="solid-box"><h3 class="box-title">Tabla histórica</h3><div class="table-scroll">' +
      '<table class="data-table"><thead><tr><th>Pos</th><th class="left">Manager</th><th title="Temporadas">Temp.</th><th title="Partidos jugados">PJ</th>' +
      '<th>G</th><th>P</th>' + (anyT ? '<th>E</th>' : '') + '<th>%</th><th>PF</th><th>PC</th><th>DIF</th>' +
      '<th title="Puntos a favor por partido">PF/PJ</th><th>Títulos</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<p class="box-note">Solo temporada regular, ' + H.seasons[0].season + '–' + H.seasons[H.seasons.length - 1].season +
      (live ? ' (incluye la temporada ' + live.season + ', en curso)' : '') + '. Orden: triunfos, luego puntos a favor (PF).</p></div>';

    // Final regular-season position per season (same manager order).
    var seasons = H.seasons;
    var head = '<tr><th class="left">Manager</th>' + seasons.map(function (s) {
      return '<th title="' + s.teams + ' equipos">' + s.season + (s.inProgress ? '*' : '') + '</th>';
    }).join('') + '<th>PROM</th><th>MEJOR</th></tr>';
    var rAvgPos = col(function (m) { return m.totals.avgPos; });
    var grid = list.map(function (m) {
      return '<tr><td class="left team-td"><a class="mgr-link" href="#managers/' + esc(m.managerId) + '">' + avatar(m.managerId, 'sm') + '<span>' + esc(m.shortName) + '</span></a></td>' +
        seasons.map(function (s) {
          var p = H.positions[s.season][m.managerId];
          if (!p || !isNum(p.R)) return '<td class="pos-empty"></td>';
          return '<td style="' + bg(p.R, SC.rank, [1, s.teams]) + '"><a class="pos-link" href="#posiciones?temporada=' + s.season + '">' + p.R + 'º</a></td>';
        }).join('') +
        '<td style="' + bg(m.totals.avgPos, [K.green, K.grey, K.red], rAvgPos) + '">' + (isNum(m.totals.avgPos) ? fmt(m.totals.avgPos, 1) : '') + '</td>' +
        '<td>' + (isNum(m.totals.bestPos) ? m.totals.bestPos + 'º' : '') + '</td></tr>';
    }).join('');
    var posBox = '<div class="solid-box"><h3 class="box-title">Posición por temporada</h3><div class="table-scroll">' +
      '<table class="data-table pos-grid"><thead>' + head + '</thead><tbody>' + grid + '</tbody></table></div>' +
      '<p class="box-note">Posición final de la temporada regular. ' + (live ? '* ' + live.season + ': posición actual (temporada en curso); no cuenta en PROM ni MEJOR. ' : '') +
      'Cada año lleva a la tabla de esa temporada.</p></div>';
    return table + posBox;
  }

  // Campeones: playoff results per season (newest first) + titles by manager.
  function histCampeones() {
    var H = history();
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
    var rT = rangeOf(list.map(function (x) { return x.t.titles; })), rF = rangeOf(list.map(function (x) { return x.t.finals; }));
    var rP = rangeOf(list.map(function (x) { return x.t.playoffs; }));
    var body = list.map(function (x) {
      return '<tr><td class="left team-td"><a class="mgr-link" href="#managers/' + esc(x.id) + '">' + avatar(x.id, 'sm') + '<span>' + esc(x.m.shortName) + '</span></a></td>' +
        '<td style="' + bg(x.t.titles, SC.blueUp, rT) + '">' + x.t.titles + '</td>' +
        '<td style="' + bg(x.t.finals, SC.blueUp, rF) + '">' + x.t.finals + '</td>' +
        '<td style="' + bg(x.t.playoffs, SC.blueUp, rP) + '">' + x.t.playoffs + '</td>' +
        '<td>' + x.done + '</td>' +
        '<td style="' + bg(x.rate, [K.red, K.grey, K.green, 0.4], [0, 1]) + '">' + pct(x.rate) + '</td>' +
        '<td class="left ch-years">' + (x.years.length ? x.years.map(function (y) { return '<span class="trophy">' + ICON_TROPHY + y + '</span>'; }).join('') : '<span class="muted">–</span>') + '</td></tr>';
    }).join('');
    var titles = '<div class="solid-box"><h3 class="box-title">Títulos por manager</h3><div class="table-scroll">' +
      '<table class="data-table"><thead><tr><th class="left">Manager</th><th>Títulos</th><th>Finales</th><th>Playoffs</th>' +
      '<th title="Temporadas terminadas">Temp.</th><th title="Playoffs / temporadas terminadas">% Playoffs</th><th class="left">Campeón</th></tr></thead><tbody>' +
      body + '</tbody></table></div>' +
      '<p class="box-note">Playoffs = semifinales jugadas. Solo cuentan temporadas terminadas.</p></div>';
    return champs + titles;
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
