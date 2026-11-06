/*
 * De Alba Fantasy League — stats module.
 *
 * One implementation of every season stat, computed from Games-format rows
 * (the 2026 doc's Games tab and data/history_games_2020-2025.json share the
 * format: one row per team per game). No dependencies, no DOM: works in the
 * browser (window.DeAlbaStats) and in node (require).
 *
 * Rules (project doc, sections 4-6):
 *  - Only regular-season games (type REG) with status FINAL count.
 *  - Nothing is hard-coded to a team count or week count: both come from the data.
 *  - Teams are keyed by managerId; team names are only labels.
 *
 * Output tables are plain data (no labels or formatting; the site does that).
 * Every table: { code, cols, rows, footer }, where each row is
 *   { managerId, team, R, <summary cols...>, weeks: { <week>: value|null } }
 * and R is the row's rank in that table (ties share a rank, like Sheets RANK).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeAlbaStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '0.9.0';
  var DEFAULT_PLAYOFF_SPOTS = 4;

  // ---------- small helpers ----------

  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function nums(arr) { return arr.filter(isNum); }
  function sum(arr) { return nums(arr).reduce(function (a, b) { return a + b; }, 0); }
  function avg(arr) { var a = nums(arr); return a.length ? sum(a) / a.length : null; }
  function max(arr) { var a = nums(arr); return a.length ? Math.max.apply(null, a) : null; }
  function min(arr) { var a = nums(arr); return a.length ? Math.min.apply(null, a) : null; }
  function count(arr, pred) { return arr.filter(function (v) { return isNum(v) && pred(v); }).length; }
  function median(arr) {
    var a = nums(arr).slice().sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  // Sheets RANK semantics: 1 + number of values strictly better; ties share a rank.
  function rankDesc(v, arr) { return isNum(v) ? 1 + count(arr, function (x) { return x > v; }) : null; }
  function rankAsc(v, arr) { return isNum(v) ? 1 + count(arr, function (x) { return x < v; }) : null; }

  // Rank rows by a list of numeric keys (lexicographic), best first.
  // desc[i] true = higher is better for key i. Equal keys share a rank.
  function rankRows(rows, keyFn, desc) {
    var keys = rows.map(keyFn);
    function better(a, b) {
      for (var i = 0; i < a.length; i++) {
        if (a[i] === b[i]) continue;
        if (!isNum(a[i])) return false;
        if (!isNum(b[i])) return true;
        return desc[i] ? a[i] > b[i] : a[i] < b[i];
      }
      return false;
    }
    return keys.map(function (k) {
      if (!isNum(k[0])) return null;
      return 1 + keys.filter(function (o) { return isNum(o[0]) && better(o, k); }).length;
    });
  }

  function weekMap(weeks, fn) {
    var out = {};
    weeks.forEach(function (w) { out[w] = fn(w); });
    return out;
  }

  // ---------- season model ----------

  function seasonsIn(games) {
    var s = {};
    games.forEach(function (g) { if (g.type === 'REG') s[g.season] = true; });
    return Object.keys(s).map(Number).sort();
  }

  /*
   * Build the per-season lookup used by every table.
   * opts: { regWeeks (default: highest REG week in the data),
   *         playoffSpots (default 4) }
   */
  function buildModel(games, season, opts) {
    opts = opts || {};
    var reg = games.filter(function (g) { return g.season === season && g.type === 'REG'; });
    if (!reg.length) throw new Error('No regular-season games for season ' + season);

    var teams = [];
    var byManager = {};
    reg.forEach(function (g) {
      if (!byManager[g.managerId]) {
        byManager[g.managerId] = { managerId: g.managerId, team: g.team, teamId: g.teamId };
        teams.push(byManager[g.managerId]);
      }
    });

    var regWeeks = opts.regWeeks || max(reg.map(function (g) { return g.week; }));
    var allWeeks = [];
    for (var w = 1; w <= regWeeks; w++) allWeeks.push(w);

    var game = {}; // game[managerId][week] = FINAL row
    teams.forEach(function (t) { game[t.managerId] = {}; });
    var played = {};
    reg.forEach(function (g) {
      if (g.status !== 'FINAL') return;
      if (game[g.managerId][g.week]) throw new Error('Two games for ' + g.managerId + ' in ' + season + ' W' + g.week);
      game[g.managerId][g.week] = g;
      played[g.week] = true;
    });
    var playedWeeks = allWeeks.filter(function (wk) { return played[wk]; });

    function field(name) {
      return function (m, wk) { var g = game[m][wk]; return g && isNum(g[name]) ? g[name] : null; };
    }
    var get = {
      pf: field('pf'),
      pa: field('pa'),
      projPf: field('projPf'),
      projPa: field('projPa'),
      dif: function (m, wk) { var g = game[m][wk]; return g ? g.pf - g.pa : null; },
      pfVsPr: function (m, wk) { var g = game[m][wk]; return g ? g.pf - g.projPf : null; },
      paVsPr: function (m, wk) { var g = game[m][wk]; return g ? g.pa - g.projPa : null; },
      prDif: function (m, wk) { var g = game[m][wk]; return g ? g.projPf - g.projPa : null; },
      result: function (m, wk) { var g = game[m][wk]; return g ? g.result : null; }
    };

    return {
      season: season,
      teams: teams,
      n: teams.length,
      regWeeks: regWeeks,
      allWeeks: allWeeks,
      playedWeeks: playedWeeks,
      playoffSpots: opts.playoffSpots || DEFAULT_PLAYOFF_SPOTS,
      game: game,
      get: get
    };
  }

  function baseRow(M, t) { return { managerId: t.managerId, team: t.team }; }

  function weeklyValues(M, m, fn) {
    return weekMap(M.allWeeks, function (wk) { return fn(m, wk); });
  }
  function valuesOf(weeks) { return Object.keys(weeks).map(function (k) { return weeks[k]; }); }

  // Footer per week: average of the teams' values (or of absolute values).
  function weekFooter(M, rows, absolute) {
    return weekMap(M.allWeeks, function (wk) {
      var vals = nums(rows.map(function (r) { return r.weeks[wk]; }));
      if (absolute) vals = vals.map(Math.abs);
      return vals.length ? sum(vals) / vals.length : null;
    });
  }

  function setRank(rows, key, ascending) {
    var all = rows.map(function (r) { return r[key]; });
    rows.forEach(function (r) { r.R = ascending ? rankAsc(r[key], all) : rankDesc(r[key], all); });
  }

  // ---------- standings ----------

  function record(M, m, upToWeek) {
    var w = 0, l = 0, t = 0, pf = 0;
    M.playedWeeks.forEach(function (wk) {
      if (upToWeek && wk > upToWeek) return;
      var g = M.game[m][wk];
      if (!g) return;
      if (g.result === 'W') w++; else if (g.result === 'L') l++; else if (g.result === 'T') t++;
      pf += g.pf;
    });
    return { W: w, L: l, T: t, PF: pf };
  }

  // Standings order: wins, then total PF (league tiebreaker).
  function standingsRanks(M, recs) {
    return rankRows(recs, function (r) { return [r.W, r.PF]; }, [true, true]);
  }

  function tableSTD(M) {
    var rows = M.teams.map(function (t) {
      var r = baseRow(M, t);
      var rec = record(M, t.managerId);
      r.W = rec.W; r.L = rec.L; r.T = rec.T; r.PF = rec.PF;
      r.weeks = weeklyValues(M, t.managerId, M.get.result);
      return r;
    });
    var ranks = standingsRanks(M, rows);
    rows.forEach(function (r, i) { r.R = ranks[i]; });
    return { code: 'STD', cols: ['W', 'L', 'T', 'PF'], rows: rows };
  }

  function tableSTDD(M, std) {
    var rows = std.rows.map(function (s) {
      var r = { managerId: s.managerId, team: s.team, R: s.R, W: s.W, L: s.L, T: s.T, PF: s.PF };
      r.weeks = weekMap(M.allWeeks, function (wk) {
        var g = M.game[s.managerId][wk];
        return g ? { result: g.result, pf: g.pf, pa: g.pa, oppManagerId: g.oppManagerId, opp: g.opp } : null;
      });
      return r;
    });
    return { code: 'STD D', cols: ['W', 'L', 'T', 'PF'], rows: rows };
  }

  // Standings position after each week (cumulative wins, then cumulative PF).
  function tableSTDxW(M) {
    var pos = {}; // pos[m][wk]
    M.teams.forEach(function (t) { pos[t.managerId] = {}; });
    M.playedWeeks.forEach(function (wk) {
      var recs = M.teams.map(function (t) { return record(M, t.managerId, wk); });
      var has = M.teams.map(function (t) { return !!M.game[t.managerId][wk]; });
      var ranks = standingsRanks(M, recs);
      M.teams.forEach(function (t, i) { pos[t.managerId][wk] = has[i] ? ranks[i] : null; });
    });
    var rows = M.teams.map(function (t) {
      var r = baseRow(M, t);
      r.weeks = weekMap(M.allWeeks, function (wk) { var p = pos[t.managerId][wk]; return p === undefined ? null : p; });
      var v = nums(valuesOf(r.weeks));
      r.AVG = avg(v);
      r.TOP_PO_PCT = v.length ? count(v, function (x) { return x <= M.playoffSpots; }) / v.length : null;
      r.BEST = min(v);
      r.WORST = max(v);
      return r;
    });
    setRank(rows, 'AVG', true);
    return { code: 'STD xW', cols: ['AVG', 'TOP_PO_PCT', 'BEST', 'WORST'], rows: rows };
  }

  // Record vs each opponent.
  function tableVS(M, std) {
    var rows = std.rows.map(function (s) {
      var r = { managerId: s.managerId, team: s.team, R: s.R, W: s.W, L: s.L, T: s.T, PF: s.PF, vs: {} };
      M.teams.forEach(function (o) {
        if (o.managerId !== s.managerId) r.vs[o.managerId] = { W: 0, L: 0, T: 0 };
      });
      M.playedWeeks.forEach(function (wk) {
        var g = M.game[s.managerId][wk];
        if (g && r.vs[g.oppManagerId] && r.vs[g.oppManagerId][g.result] !== undefined) r.vs[g.oppManagerId][g.result]++;
      });
      return r;
    });
    return { code: 'VS', cols: ['W', 'L', 'T', 'PF'], rows: rows };
  }

  // ---------- points tables (total / avg / max / min) ----------

  function pointsTable(M, code, fn, opts) {
    opts = opts || {};
    var rows = M.teams.map(function (t) {
      var r = baseRow(M, t);
      r.weeks = weeklyValues(M, t.managerId, fn);
      var v = nums(valuesOf(r.weeks));
      r.TOT = v.length ? sum(v) : null;
      r.AVG = avg(v);
      r.MAX = max(v);
      r.MIN = min(v);
      return r;
    });
    setRank(rows, 'TOT', false);
    return { code: code, cols: ['TOT', 'AVG', 'MAX', 'MIN'], rows: rows,
             footer: { AVG: weekFooter(M, rows, opts.absFooter) } };
  }

  // Projected margin: weeks as favorite / underdog.
  function tablePRPFvsPA(M) {
    var rows = M.teams.map(function (t) {
      var r = baseRow(M, t);
      r.weeks = weeklyValues(M, t.managerId, M.get.prDif);
      var v = nums(valuesOf(r.weeks));
      r.FAV = count(v, function (x) { return x > 0; });
      r.UND = count(v, function (x) { return x < 0; });
      r.MAX = max(v);
      r.MIN = min(v);
      return r;
    });
    setRank(rows, 'FAV', false);
    return { code: 'PR PFvsPA', cols: ['FAV', 'UND', 'MAX', 'MIN'], rows: rows,
             footer: { AVG: weekFooter(M, rows, true) } };
  }

  // ---------- rankings ----------

  // Weekly rank among the teams that played that week.
  function tableRkWeek(M, code, fn) {
    var rk = {};
    M.teams.forEach(function (t) { rk[t.managerId] = {}; });
    M.playedWeeks.forEach(function (wk) {
      var vals = M.teams.map(function (t) { return fn(t.managerId, wk); });
      M.teams.forEach(function (t, i) { rk[t.managerId][wk] = rankDesc(vals[i], vals); });
    });
    var half = Math.floor(M.n / 2);
    var rows = M.teams.map(function (t) {
      var r = baseRow(M, t);
      r.weeks = weekMap(M.allWeeks, function (wk) { var v = rk[t.managerId][wk]; return v === undefined ? null : v; });
      var v = nums(valuesOf(r.weeks));
      r.AVG = avg(v);
      r.TOP1 = count(v, function (x) { return x === 1; });
      r.TOPHALF = count(v, function (x) { return x <= half; });
      r.BOTHALF = count(v, function (x) { return x > half; });
      r.BOT1 = count(v, function (x) { return x === M.n; });
      return r;
    });
    setRank(rows, 'AVG', true);
    return { code: code, cols: ['AVG', 'TOP1', 'TOPHALF', 'BOTHALF', 'BOT1'], rows: rows };
  }

  // Rank of each weekly score among all scores of the season.
  function tableRkTot(M, code, fn) {
    var all = [];
    M.teams.forEach(function (t) { M.playedWeeks.forEach(function (wk) { all.push(fn(t.managerId, wk)); }); });
    all = nums(all);
    var total = all.length;
    var rows = M.teams.map(function (t) {
      var r = baseRow(M, t);
      r.weeks = weekMap(M.allWeeks, function (wk) { return rankDesc(fn(t.managerId, wk), all); });
      var v = nums(valuesOf(r.weeks));
      function share(pred) { return v.length ? count(v, pred) / v.length : null; }
      r.AVG = avg(v);
      r.TOP10 = share(function (x) { return x <= total * 0.1; });
      r.TOP25 = share(function (x) { return x <= total * 0.25; });
      r.TOP50 = share(function (x) { return x <= total * 0.5; });
      r.BOT50 = share(function (x) { return x > total * 0.5; });
      r.BOT25 = share(function (x) { return x > total * 0.75; });
      r.BOT10 = share(function (x) { return x > total * 0.9; });
      return r;
    });
    setRank(rows, 'AVG', true);
    return { code: code, cols: ['AVG', 'TOP10', 'TOP25', 'TOP50', 'BOT50', 'BOT25', 'BOT10'], rows: rows };
  }

  // Points in wins / losses.
  function tableByResult(M, code, fn, result) {
    var rows = M.teams.map(function (t) {
      var r = baseRow(M, t);
      r.weeks = weekMap(M.allWeeks, function (wk) {
        return M.get.result(t.managerId, wk) === result ? fn(t.managerId, wk) : null;
      });
      var v = nums(valuesOf(r.weeks));
      r.AVG = avg(v);
      r.MAX = max(v);
      r.MIN = min(v);
      return r;
    });
    setRank(rows, 'AVG', false);
    return { code: code, cols: ['AVG', 'MAX', 'MIN'], rows: rows, footer: { AVG: weekFooter(M, rows) } };
  }

  // Global Wins (all-play): each week, wins = teams outscored.
  function tableGW(M) {
    var rows = M.teams.map(function (t) {
      var r = baseRow(M, t);
      r.weeks = weekMap(M.allWeeks, function (wk) {
        var mine = M.get.pf(t.managerId, wk);
        if (!isNum(mine)) return null;
        var others = M.teams.map(function (o) { return M.get.pf(o.managerId, wk); });
        return M.n - rankDesc(mine, others);
      });
      var v = nums(valuesOf(r.weeks));
      r.W = sum(v);
      r.L = v.length * (M.n - 1) - r.W;
      return r;
    });
    setRank(rows, 'W', false);
    return { code: 'GW', cols: ['W', 'L'], rows: rows };
  }

  // Power ranking: how far above the league's weekly median a team has scored
  // lately (Stage 8, Daniel: who is strongest right now).
  //   weekly value = PF - league median that week (computed for every week)
  //   PWR = plain average of the weekly values over the last PWR_WINDOW played
  //         weeks (fewer early in the season); older weeks do not count.
  //   window = those weeks (the site shows only them).
  // Replaces the legacy formula (finding 7) and the Stage 4 recency-weighted
  // average (decay 0.85), where early weeks still weighed too much.
  var PWR_WINDOW = 5;
  function tablePWR(M) {
    var med = weekMap(M.allWeeks, function (wk) {
      return median(M.teams.map(function (t) { return M.get.pf(t.managerId, wk); }));
    });
    var window = M.playedWeeks.slice(-PWR_WINDOW);
    var weight = weekMap(M.allWeeks, function (wk) {
      return isNum(med[wk]) && window.indexOf(wk) >= 0 ? 1 : null;
    });
    var rows = M.teams.map(function (t) {
      var r = baseRow(M, t);
      var num = 0, den = 0;
      r.weeks = weekMap(M.allWeeks, function (wk) {
        var pf = M.get.pf(t.managerId, wk);
        if (!isNum(pf) || !isNum(med[wk])) return null;
        var v = pf - med[wk];
        if (weight[wk]) { num += v; den += 1; }
        return v;
      });
      r.PWR = den ? num / den : null;
      return r;
    });
    setRank(rows, 'PWR', false);
    return { code: 'PWR', cols: ['PWR'], rows: rows, window: window, footer: { MEDIAN: med, WEIGHT: weight } };
  }

  // ---------- index: leader and last place of every table ----------

  function tableIDX(tables) {
    var out = {};
    Object.keys(tables).forEach(function (code) {
      var rows = tables[code].rows.filter(function (r) { return isNum(r.R); });
      if (!rows.length) return;
      var best = min(rows.map(function (r) { return r.R; }));
      var worst = max(rows.map(function (r) { return r.R; }));
      function ids(rk) { return rows.filter(function (r) { return r.R === rk; }).map(function (r) { return r.managerId; }); }
      out[code] = { first: ids(best), last: ids(worst) };
    });
    return { code: 'IDX', byTable: out };
  }

  // ---------- playoff results (POs) ----------
  // Source: the History doc's "Team seasons" rows (season, team name, manager,
  // playoff_result c/r/s). Playoff games never count for any stat (section 4);
  // only the outcome is shown. Accepts snake_case or camelCase keys.
  function computePlayoffs(teamSeasons, season) {
    function pick(r, a, b) { return r[a] !== undefined ? r[a] : r[b]; }
    var rows = teamSeasons.filter(function (r) { return Number(pick(r, 'season', 'season')) === season; })
      .map(function (r) {
        return { managerId: pick(r, 'manager_id', 'managerId'), team: pick(r, 'team_name', 'team'),
                 result: (pick(r, 'playoff_result', 'playoffResult') || '').trim() || null };
      });
    function who(code) { return rows.filter(function (r) { return r.result === code; }); }
    var c = who('c'), ru = who('r'), s = who('s');
    return {
      code: 'POs',
      season: season,
      champion: c[0] || null,
      runnerUp: ru[0] || null,
      semifinalists: s,
      // complete = the season's playoffs are decided and recorded (1 c, 1 r, 2 s)
      complete: c.length === 1 && ru.length === 1 && s.length === 2,
      rows: rows
    };
  }

  // ---------- league history (all seasons) ----------
  /*
   * computeHistory(games, league, seasonOpts)
   *   games      all Games-format rows, every season (history file + season files)
   *   league     data/league.json ({ managers, teamSeasons })
   *   seasonOpts { <year>: { regWeeks, playoffSpots } } for seasons with a config
   *              (the season files); other seasons use the data defaults.
   * Rules: same as computeSeason (only REG + FINAL games count; playoff games
   * never count). A season still in progress counts live (decided Stage 7):
   * its finished games are in every total; its position is the current one,
   * flagged inProgress. Titles/finals/semifinals come only from Team seasons.
   * Keyed by managerId; team names are only labels.
   */
  function computeHistory(games, league, seasonOpts) {
    seasonOpts = seasonOpts || {};
    var managers = {};
    (league.managers || []).forEach(function (m) {
      managers[m.managerId] = {
        managerId: m.managerId, shortName: m.shortName, fullName: m.fullName, active: !!m.active,
        seasons: [], teamNames: [],
        totals: { seasons: 0, games: 0, W: 0, L: 0, T: 0, PF: 0, PA: 0 },
        h2h: {}
      };
    });
    function mgr(id) {
      if (!managers[id]) throw new Error('Unknown manager ' + id);
      return managers[id];
    }
    var poByKey = {};
    (league.teamSeasons || []).forEach(function (t) {
      poByKey[t.season + '|' + t.managerId] = (t.playoffResult || '').trim() || null;
    });

    var seasonList = [];
    var positions = {}; // positions[season][managerId] = { R, inProgress, playoffResult }

    seasonsIn(games).forEach(function (yr) {
      var cs = computeSeason(games, yr, seasonOpts[yr] || {});
      var inProgress = cs.playedWeeks.length < cs.regWeeks;
      seasonList.push({ season: yr, teams: cs.teams.length, regWeeks: cs.regWeeks,
                        playedWeeks: cs.playedWeeks.length, inProgress: inProgress });
      positions[yr] = {};
      var std = cs.tables['STD'].rows;
      var paRows = {};
      cs.tables['PA'].rows.forEach(function (r) { paRows[r.managerId] = r; });
      std.forEach(function (r) {
        var m = mgr(r.managerId);
        var po = poByKey[yr + '|' + r.managerId] || null;
        var pa = paRows[r.managerId].TOT || 0;
        var gp = r.W + r.L + r.T;
        m.seasons.push({ season: yr, team: r.team, R: gp ? r.R : null, W: r.W, L: r.L, T: r.T,
                         games: gp, PF: r.PF, PA: pa, playoffResult: po, inProgress: inProgress });
        positions[yr][r.managerId] = { R: gp ? r.R : null, inProgress: inProgress, playoffResult: po };
        var tt = m.totals;
        tt.seasons++; tt.games += gp; tt.W += r.W; tt.L += r.L; tt.T += r.T; tt.PF += r.PF; tt.PA += pa;
        // team names over time (consecutive seasons with the same name grouped)
        var last = m.teamNames[m.teamNames.length - 1];
        if (last && last.team === r.team) last.seasons.push(yr);
        else m.teamNames.push({ team: r.team, seasons: [yr] });
      });
      // head-to-head from the same games the season tables use
      games.forEach(function (g) {
        if (g.season !== yr || g.type !== 'REG' || g.status !== 'FINAL') return;
        var h = mgr(g.managerId).h2h;
        var o = h[g.oppManagerId] || (h[g.oppManagerId] = { games: 0, W: 0, L: 0, T: 0, PF: 0, PA: 0 });
        o.games++; o.PF += g.pf; o.PA += g.pa;
        if (o[g.result] !== undefined) o[g.result]++;
      });
    });

    Object.keys(managers).forEach(function (id) {
      var m = managers[id], t = m.totals;
      t.DIF = t.PF - t.PA;
      t.pct = t.games ? (t.W + t.T / 2) / t.games : null;
      t.avgPF = t.games ? t.PF / t.games : null;
      t.avgPA = t.games ? t.PA / t.games : null;
      var done = m.seasons.filter(function (s) { return !s.inProgress; });
      t.titles = m.seasons.filter(function (s) { return s.playoffResult === 'c'; }).length;
      t.finals = m.seasons.filter(function (s) { return s.playoffResult === 'c' || s.playoffResult === 'r'; }).length;
      t.playoffs = m.seasons.filter(function (s) { return !!s.playoffResult; }).length;
      var pos = nums(done.map(function (s) { return s.R; }));
      t.bestPos = min(pos);
      t.worstPos = max(pos);
      t.avgPos = avg(pos);
      t.firstSeason = m.seasons.length ? m.seasons[0].season : null;
      t.lastSeason = m.seasons.length ? m.seasons[m.seasons.length - 1].season : null;
    });

    var champions = seasonList.map(function (s) {
      var po = computePlayoffs(league.teamSeasons || [], s.season);
      return { season: s.season, champion: po.champion, runnerUp: po.runnerUp,
               semifinalists: po.semifinalists, complete: po.complete };
    });

    return { seasons: seasonList, managers: managers, positions: positions, champions: champions };
  }

  // ---------- records (all seasons) ----------
  /*
   * computeRecords(games, seasonOpts, n)
   * Single-game records use every REG + FINAL game (a season in progress counts
   * live). Season records use finished seasons only (decided Stage 7), with
   * per-game averages where season length matters (2020 had 14 weeks).
   * Each record keeps the top n (default 5) and every entry tied with the n-th.
   * Returns { game: [record], season: [record] }, record = { key, entries },
   * entry = { rank, value, ...context }.
   */
  function computeRecords(games, seasonOpts, n) {
    seasonOpts = seasonOpts || {};
    n = n || 5;
    var fin = games.filter(function (g) { return g.type === 'REG' && g.status === 'FINAL'; });

    function top(list, valueFn, desc) {
      var rows = list.map(function (x) { var v = valueFn(x); return isNum(v) ? Object.assign({ value: v }, x) : null; })
        .filter(Boolean);
      rows.sort(function (a, b) { return desc ? b.value - a.value : a.value - b.value; });
      if (!rows.length) return [];
      var cut = rows[Math.min(n, rows.length) - 1].value;
      var vals = rows.map(function (r) { return r.value; });
      return rows.filter(function (r) { return desc ? r.value >= cut - 1e-9 : r.value <= cut + 1e-9; })
        .map(function (r) { r.rank = desc ? rankDesc(r.value, vals) : rankAsc(r.value, vals); return r; });
    }

    // One entry per team per game
    var teamGames = fin.map(function (g) {
      return { season: g.season, week: g.week, managerId: g.managerId, team: g.team,
               oppManagerId: g.oppManagerId, opp: g.opp, pf: g.pf, pa: g.pa,
               projPf: g.projPf, projPa: g.projPa, result: g.result };
    });
    // One entry per matchup, winner first (ties: lower managerId first)
    var matchups = fin.filter(function (g) {
      return g.result === 'W' || (g.result === 'T' && g.managerId < g.oppManagerId);
    }).map(function (g) {
      return { season: g.season, week: g.week, tie: g.result === 'T',
               winner: { managerId: g.managerId, team: g.team, pf: g.pf, proj: g.projPf },
               loser: { managerId: g.oppManagerId, team: g.opp, pf: g.pa, proj: g.projPa },
               margin: g.pf - g.pa, combined: g.pf + g.pa,
               projMargin: isNum(g.projPf) && isNum(g.projPa) ? g.projPf - g.projPa : null };
    });

    var game = [
      { key: 'mostPts', entries: top(teamGames, function (x) { return x.pf; }, true) },
      { key: 'fewestPts', entries: top(teamGames, function (x) { return x.pf; }, false) },
      { key: 'biggestWin', entries: top(matchups, function (x) { return x.tie ? null : x.margin; }, true) },
      { key: 'closest', entries: top(matchups, function (x) { return x.margin; }, false) },
      { key: 'mostCombined', entries: top(matchups, function (x) { return x.combined; }, true) },
      { key: 'fewestCombined', entries: top(matchups, function (x) { return x.combined; }, false) },
      { key: 'mostPtsLoss', entries: top(teamGames, function (x) { return x.result === 'L' ? x.pf : null; }, true) },
      { key: 'fewestPtsWin', entries: top(teamGames, function (x) { return x.result === 'W' ? x.pf : null; }, false) },
      { key: 'overProj', entries: top(teamGames, function (x) { return isNum(x.projPf) ? x.pf - x.projPf : null; }, true) },
      { key: 'underProj', entries: top(teamGames, function (x) { return isNum(x.projPf) ? x.pf - x.projPf : null; }, false) },
      // Upset: the winner's projected margin (most negative = biggest surprise)
      { key: 'upset', entries: top(matchups, function (x) { return !x.tie && isNum(x.projMargin) && x.projMargin < 0 ? x.projMargin : null; }, false) },
      // Most unexpected result: final margin furthest from the projected margin (either way)
      { key: 'unexpected', entries: top(matchups, function (x) { return isNum(x.projMargin) ? Math.abs(x.margin - x.projMargin) : null; }, true) }
    ];

    // Season entries: finished seasons only
    var seasonRows = [];
    seasonsIn(games).forEach(function (yr) {
      var cs = computeSeason(games, yr, seasonOpts[yr] || {});
      if (cs.playedWeeks.length < cs.regWeeks) return;
      var T = cs.tables, by = function (code) { var o = {}; T[code].rows.forEach(function (r) { o[r.managerId] = r; }); return o; };
      var pa = by('PA'), rk = by('Rk PF'), gw = by('GW');
      T['STD'].rows.forEach(function (r) {
        var gp = r.W + r.L + r.T;
        if (!gp) return;
        var a = pa[r.managerId].TOT, g = gw[r.managerId];
        seasonRows.push({ season: yr, managerId: r.managerId, team: r.team, W: r.W, L: r.L, T: r.T, games: gp,
          pfPg: r.PF / gp, paPg: a / gp, difPg: (r.PF - a) / gp, top1: rk[r.managerId].TOP1, weeks: cs.playedWeeks.length,
          gwW: g.W, gwL: g.L, gwPct: g.W + g.L ? g.W / (g.W + g.L) : null });
      });
    });
    var season = [
      { key: 'mostWins', entries: top(seasonRows, function (x) { return x.W; }, true) },
      { key: 'fewestWins', entries: top(seasonRows, function (x) { return x.W; }, false) },
      { key: 'bestPfPg', entries: top(seasonRows, function (x) { return x.pfPg; }, true) },
      { key: 'worstPfPg', entries: top(seasonRows, function (x) { return x.pfPg; }, false) },
      { key: 'fewestPaPg', entries: top(seasonRows, function (x) { return x.paPg; }, false) },
      { key: 'mostPaPg', entries: top(seasonRows, function (x) { return x.paPg; }, true) },
      { key: 'bestDifPg', entries: top(seasonRows, function (x) { return x.difPg; }, true) },
      { key: 'mostTop1', entries: top(seasonRows, function (x) { return x.top1; }, true) },
      { key: 'bestGw', entries: top(seasonRows, function (x) { return x.gwPct; }, true) }
    ];
    return { game: game, season: season };
  }

  // ---------- streaks (all seasons) ----------
  /*
   * computeStreaks(games, n)
   * Win and loss streaks over each manager's REG + FINAL games in order
   * (season, week). Streaks run across seasons and follow the manager
   * (decided Stage 7); a tie ends both. A streak is "active" when it runs
   * through the manager's latest game and that game is in the latest season
   * with games. Lists keep the top n (default 10) plus ties with the n-th.
   * Returns { wins: [run], losses: [run], current: [run] }, run =
   *   { managerId, type 'W'|'L'|'T', length, rank, active, start, end }
   *   (start/end = { season, week, team }).
   */
  function computeStreaks(games, n) {
    n = n || 10;
    var fin = games.filter(function (g) { return g.type === 'REG' && g.status === 'FINAL'; })
      .slice().sort(function (a, b) { return a.season - b.season || a.week - b.week; });
    var latest = fin.length ? fin[fin.length - 1].season : null;
    var byMgr = {};
    fin.forEach(function (g) { (byMgr[g.managerId] = byMgr[g.managerId] || []).push(g); });
    var runs = [], current = [];
    Object.keys(byMgr).sort().forEach(function (id) {
      var list = byMgr[id], run = null;
      function at(g) { return { season: g.season, week: g.week, team: g.team }; }
      list.forEach(function (g, i) {
        if (run && run.type === g.result) { run.length++; run.end = at(g); }
        else {
          run = { managerId: id, type: g.result, length: 1, start: at(g), end: at(g), active: false };
          runs.push(run);
        }
        if (i === list.length - 1) {
          run.active = g.season === latest;
          if (run.active) current.push(run);
        }
      });
    });
    function top(type) {
      var rows = runs.filter(function (r) { return r.type === type; })
        .sort(function (a, b) { return b.length - a.length || b.end.season - a.end.season || b.end.week - a.end.week; });
      if (!rows.length) return [];
      var cut = rows[Math.min(n, rows.length) - 1].length;
      var vals = rows.map(function (r) { return r.length; });
      return rows.filter(function (r) { return r.length >= cut; })
        .map(function (r) { return Object.assign({ rank: rankDesc(r.length, vals) }, r); });
    }
    current.sort(function (a, b) {
      var sa = a.type === 'W' ? a.length : -a.length, sb = b.type === 'W' ? b.length : -b.length;
      return sb - sa;
    });
    return { wins: top('W'), losses: top('L'), current: current, _runs: runs };
  }

  // ---------- one manager's personal records ----------
  /*
   * computeManagerRecords(games, seasonOpts, managerId)
   * The manager's best/worst values for a subset of the league records, same
   * rules (single games: every REG + FINAL game, season in progress counts;
   * seasons: finished only; streaks: across seasons). Each value keeps every
   * tied occurrence, and "league" = true when it equals the league record.
   * Returns [{ key, value, entries, league }].
   */
  function computeManagerRecords(games, seasonOpts, managerId) {
    seasonOpts = seasonOpts || {};
    var fin = games.filter(function (g) { return g.type === 'REG' && g.status === 'FINAL'; });
    var mine = fin.filter(function (g) { return g.managerId === managerId; });
    function best(list, fn, desc) {
      var vals = list.map(fn).filter(isNum);
      if (!vals.length) return null;
      var v = desc ? Math.max.apply(null, vals) : Math.min.apply(null, vals);
      return { value: v, entries: list.filter(function (x) { var y = fn(x); return isNum(y) && Math.abs(y - v) < 1e-9; }) };
    }
    function row(g) {
      return { season: g.season, week: g.week, managerId: g.managerId, team: g.team, oppManagerId: g.oppManagerId,
               opp: g.opp, pf: g.pf, pa: g.pa, projPf: g.projPf, result: g.result };
    }
    var rows = mine.map(row);
    var L = computeRecords(games, seasonOpts, 1);
    var K = computeStreaks(games, 1);
    function leagueTop(list, key) { var r = list.filter(function (x) { return x.key === key; })[0]; return r && r.entries.length ? r.entries[0].value : null; }

    var seasons = [];
    seasonsIn(games).forEach(function (yr) {
      var cs = computeSeason(games, yr, seasonOpts[yr] || {});
      if (cs.playedWeeks.length < cs.regWeeks) return;
      var r = cs.tables.STD.rows.filter(function (x) { return x.managerId === managerId; })[0];
      if (!r) return;
      var gp = r.W + r.L + r.T;
      if (gp) seasons.push({ season: yr, managerId: managerId, team: r.team, W: r.W, L: r.L, T: r.T, pfPg: r.PF / gp });
    });
    var runs = K._runs.filter(function (r) { return r.managerId === managerId; });

    var out = [];
    function add(key, b, leagueValue) {
      if (!b) return;
      out.push({ key: key, value: b.value, entries: b.entries,
                 league: isNum(leagueValue) && Math.abs(b.value - leagueValue) < 1e-9 });
    }
    add('mostPts', best(rows, function (x) { return x.pf; }, true), leagueTop(L.game, 'mostPts'));
    add('fewestPts', best(rows, function (x) { return x.pf; }, false), leagueTop(L.game, 'fewestPts'));
    add('biggestWin', best(rows, function (x) { return x.result === 'W' ? x.pf - x.pa : null; }, true), leagueTop(L.game, 'biggestWin'));
    add('worstLoss', best(rows, function (x) { return x.result === 'L' ? x.pa - x.pf : null; }, true), leagueTop(L.game, 'biggestWin'));
    add('mostWins', best(seasons, function (x) { return x.W; }, true), leagueTop(L.season, 'mostWins'));
    add('bestPfPg', best(seasons, function (x) { return x.pfPg; }, true), leagueTop(L.season, 'bestPfPg'));
    add('winStreak', best(runs, function (r) { return r.type === 'W' ? r.length : null; }, true), K.wins.length ? K.wins[0].length : null);
    add('lossStreak', best(runs, function (r) { return r.type === 'L' ? r.length : null; }, true), K.losses.length ? K.losses[0].length : null);
    return out;
  }

  // ---------- all-time stat tables (Estadísticas > Histórico) ----------
  /*
   * computeAllTime(games, seasonOpts)
   * Tables chosen by Daniel (Stage 7). Rows = managers, one cell per season,
   * built from each season's own tables (computeSeason), so every number
   * matches the season pages. A season in progress counts live (flagged).
   *   PF T / PA T   season total;   summary TOT
   *   PF P / PA P   season average per week;  summary PROM (career total / games), MAX, MIN (season averages)
   *   TOP PF / BOT PF   weeks with the league's best / worst score (Rk PF TOP1 / BOT1); summary TOT
   *   TOP PA / BOT PA   same for the opponent's score (Rk PA TOP1 / BOT1); summary TOT
   *   GW            all-play record per season { W, L, pct }; summary W, L, pct
   * Returns { seasons: [{ season, inProgress }], tables: { code: { code, cols, rows } } },
   * row = { managerId, R, <summary>, seasons: { <year>: value | null } }.
   */
  function computeAllTime(games, seasonOpts) {
    seasonOpts = seasonOpts || {};
    var years = seasonsIn(games), per = {}, ids = {};
    years.forEach(function (y) {
      var cs = computeSeason(games, y, seasonOpts[y] || {});
      var by = {};
      Object.keys(cs.tables).forEach(function (code) {
        if (!cs.tables[code].rows) return;
        by[code] = {};
        cs.tables[code].rows.forEach(function (r) { by[code][r.managerId] = r; ids[r.managerId] = true; });
      });
      per[y] = { cs: cs, by: by, inProgress: cs.playedWeeks.length < cs.regWeeks };
    });
    var managers = Object.keys(ids).sort();
    function played(y, id) {
      var s = per[y].by['STD'][id];
      return s && (s.W + s.L + s.T) > 0 ? s.W + s.L + s.T : 0;
    }
    function build(code, cellFn, summaryFn, cols, rankKey, asc) {
      var rows = managers.map(function (id) {
        var r = { managerId: id, seasons: {} };
        years.forEach(function (y) { r.seasons[y] = played(y, id) ? cellFn(y, id) : null; });
        Object.assign(r, summaryFn(id, r));
        return r;
      });
      var all = rows.map(function (r) { return r[rankKey]; });
      rows.forEach(function (r) { r.R = asc ? rankAsc(r[rankKey], all) : rankDesc(r[rankKey], all); });
      return { code: code, cols: cols, rows: rows };
    }
    function vals(r) { return nums(years.map(function (y) { return r.seasons[y]; })); }
    function totalOf(code, key) {
      return function (y, id) { return per[y].by[code][id][key]; };
    }
    function sumSummary(id, r) { var v = vals(r); return { TOT: v.length ? sum(v) : null }; }
    function avgSummary(totCode) {
      return function (id, r) {
        var tot = 0, gp = 0;
        years.forEach(function (y) { var n = played(y, id); if (n) { tot += per[y].by[totCode][id].TOT; gp += n; } });
        var v = vals(r);
        return { AVG: gp ? tot / gp : null, MAX: max(v), MIN: min(v) };
      };
    }
    var t = {};
    t['PF T'] = build('PF T', totalOf('PF', 'TOT'), sumSummary, ['TOT'], 'TOT');
    t['PF P'] = build('PF P', totalOf('PF', 'AVG'), avgSummary('PF'), ['AVG', 'MAX', 'MIN'], 'AVG');
    t['PA T'] = build('PA T', totalOf('PA', 'TOT'), sumSummary, ['TOT'], 'TOT');
    t['PA P'] = build('PA P', totalOf('PA', 'AVG'), avgSummary('PA'), ['AVG', 'MAX', 'MIN'], 'AVG');
    t['TOP PF'] = build('TOP PF', totalOf('Rk PF', 'TOP1'), sumSummary, ['TOT'], 'TOT');
    t['BOT PF'] = build('BOT PF', totalOf('Rk PF', 'BOT1'), sumSummary, ['TOT'], 'TOT');
    t['TOP PA'] = build('TOP PA', totalOf('Rk PA', 'TOP1'), sumSummary, ['TOT'], 'TOT');
    t['BOT PA'] = build('BOT PA', totalOf('Rk PA', 'BOT1'), sumSummary, ['TOT'], 'TOT');
    t['GW'] = build('GW', function (y, id) {
      var g = per[y].by['GW'][id];
      return { W: g.W, L: g.L, pct: g.W + g.L ? g.W / (g.W + g.L) : null };
    }, function (id, r) {
      var w = 0, l = 0;
      years.forEach(function (y) { var c = r.seasons[y]; if (c) { w += c.W; l += c.L; } });
      return { W: w, L: l, pct: w + l ? w / (w + l) : null };
    }, ['W', 'L', 'pct'], 'pct');
    return { seasons: years.map(function (y) { return { season: y, inProgress: per[y].inProgress }; }), tables: t };
  }

  // ---------- public entry point ----------

  function computeSeason(games, season, opts) {
    var M = buildModel(games, season, opts);
    var g = M.get;
    var t = {};
    t['STD'] = tableSTD(M);
    t['STD D'] = tableSTDD(M, t['STD']);
    t['STD xW'] = tableSTDxW(M);
    t['VS'] = tableVS(M, t['STD']);
    t['PF'] = pointsTable(M, 'PF', g.pf);
    t['PA'] = pointsTable(M, 'PA', g.pa);
    t['DIF'] = pointsTable(M, 'DIF', g.dif, { absFooter: true });
    t['PR PF'] = pointsTable(M, 'PR PF', g.projPf);
    t['PR PA'] = pointsTable(M, 'PR PA', g.projPa);
    t['PF vsPR'] = pointsTable(M, 'PF vsPR', g.pfVsPr);
    t['PA vsPR'] = pointsTable(M, 'PA vsPR', g.paVsPr);
    t['PR PFvsPA'] = tablePRPFvsPA(M);
    t['Rk PF'] = tableRkWeek(M, 'Rk PF', g.pf);
    t['Rk PA'] = tableRkWeek(M, 'Rk PA', g.pa);
    t['Rk PF TOT'] = tableRkTot(M, 'Rk PF TOT', g.pf);
    t['Rk PA TOT'] = tableRkTot(M, 'Rk PA TOT', g.pa);
    t['PF W'] = tableByResult(M, 'PF W', g.pf, 'W');
    t['PF L'] = tableByResult(M, 'PF L', g.pf, 'L');
    t['PA W'] = tableByResult(M, 'PA W', g.pa, 'W');
    t['PA L'] = tableByResult(M, 'PA L', g.pa, 'L');
    t['GW'] = tableGW(M);
    t['PWR'] = tablePWR(M);
    var idx = tableIDX(t);
    t['IDX'] = idx;
    return {
      season: season,
      regWeeks: M.regWeeks,
      playedWeeks: M.playedWeeks,
      playoffSpots: M.playoffSpots,
      teams: M.teams,
      tables: t
    };
  }

  /**
   * computeClinched(games, season, opts) -> { managerId: true } for teams already
   * sure of a playoff spot (Stage 8). Standings order = wins, then PF.
   * Worst case for a team: it loses every remaining regular-season game. It has
   * clinched unless some group of `playoffSpots` other teams can all end with at
   * least as many wins (equal wins is not safe: the PF tiebreak is still open).
   * Each group is checked exactly: games against outsiders are given to the
   * group, games inside the group are tried both ways. Season over = top spots.
   */
  function computeClinched(games, season, opts) {
    opts = opts || {};
    var spots = opts.playoffSpots || DEFAULT_PLAYOFF_SPOTS;
    var reg = games.filter(function (g) { return g.season === season && g.type === 'REG'; });
    var ids = [], wins = {}, pf = {};
    reg.forEach(function (g) {
      if (!(g.managerId in wins)) { ids.push(g.managerId); wins[g.managerId] = 0; pf[g.managerId] = 0; }
      if (g.status === 'FINAL') { if (g.result === 'W') wins[g.managerId]++; pf[g.managerId] += g.pf || 0; }
    });
    var out = {};
    if (ids.length <= spots) { ids.forEach(function (id) { out[id] = true; }); return out; }
    // remaining matches, once each
    var left = reg.filter(function (g) { return g.status !== 'FINAL' && g.managerId < g.oppManagerId; })
      .map(function (g) { return [g.managerId, g.oppManagerId]; });
    if (!left.length) {
      ids.slice().sort(function (a, b) { return wins[b] - wins[a] || pf[b] - pf[a]; })
        .slice(0, spots).forEach(function (id) { out[id] = true; });
      return out;
    }
    function groups(list, k, start, cur, res) {
      if (cur.length === k) { res.push(cur.slice()); return res; }
      for (var i = start; i < list.length; i++) { cur.push(list[i]); groups(list, k, i + 1, cur, res); cur.pop(); }
      return res;
    }
    // can every team in S end with >= target wins, while team t loses all its games?
    function canAllReach(S, target, t) {
      var need = {}, inS = {}, contested = [];
      S.forEach(function (id) { inS[id] = true; need[id] = target - wins[id]; });
      left.forEach(function (m) {
        var a = m[0], b = m[1];
        if (a === t || b === t) { var o = a === t ? b : a; if (inS[o]) need[o]--; return; }
        if (inS[a] && inS[b]) contested.push(m);
        else if (inS[a]) need[a]--;
        else if (inS[b]) need[b]--;
      });
      var total = 0;
      S.forEach(function (id) { if (need[id] > 0) total += need[id]; });
      if (total === 0) return true;
      if (total > contested.length) return false;
      var n = contested.length;
      for (var mask = 0; mask < (1 << n); mask++) {
        var got = {};
        for (var i = 0; i < n; i++) { var w = contested[i][(mask >> i) & 1]; got[w] = (got[w] || 0) + 1; }
        if (S.every(function (id) { return need[id] - (got[id] || 0) <= 0; })) return true;
      }
      return false;
    }
    ids.forEach(function (t) {
      var others = ids.filter(function (id) { return id !== t; });
      var safe = !groups(others, spots, 0, [], []).some(function (S) { return canAllReach(S, wins[t], t); });
      if (safe) out[t] = true;
    });
    return out;
  }

  return {
    VERSION: VERSION,
    seasonsIn: seasonsIn,
    computeSeason: computeSeason,
    computePlayoffs: computePlayoffs,
    computeHistory: computeHistory,
    computeRecords: computeRecords,
    computeStreaks: computeStreaks,
    computeManagerRecords: computeManagerRecords,
    computeAllTime: computeAllTime,
    computeClinched: computeClinched,
    _helpers: { rankDesc: rankDesc, rankAsc: rankAsc, median: median, rankRows: rankRows }
  };
});
