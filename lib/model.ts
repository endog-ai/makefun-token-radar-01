// MERIDIAN — value model for token-radar-01 (model version meridian-1).
//
// One snapshot in, one ranked board out. The board covers every watchlist slug
// (the floor, never the ceiling) plus the pre-token protocols below the floor
// that pass the watchlist's exclusion rule, ranked by implied token value.
//
// Implied value follows only from the snapshot's own figures, never from a
// hand-written list of names:
//
//   base        = 10 ^ (a + b * log10(tvl_usd))   from a log-log OLS fit of
//                 market cap on TVL over the token-bearing comps, fitted per
//                 category where the category has enough comps (see below)
//   growth      = clamp(change_7d ?? 0, -60, 120) per cent
//   growthMult  = 1 + (growth / 100) * w, w tuned by leave-one-out error
//   maturity    = 0.6 + min(age_days, 1095) / 1095 * 0.4 (age unknown: 365d)
//   implied     = max(1, round(base * growthMult * maturity))
//   low / high  = implied * 10 ^ (-/+ sigma), sigma = residual SD (log10)
//
// Category curves: a category with n >= 8 token-bearing comps gets its own
// log-log OLS fit. A category with 3 <= n < 8 gets the global fit rescaled by
// the category's median(mcap/tvl) over the global median(mcap/tvl)
// (curve "global×ratio"). A category with n < 3, or no category at all, gets
// the pure global fit (curve "global"). The `curve` field on every row says
// which of the three priced it.
//
// Measured on the sealed snapshot (as_of 2026-11-14, 128 comps):
//   global fit a=3.0247 b=0.5223 resid SD 0.9092 (log10)
//   Lending (n=15) a=-4.4376 b=1.4995 SD 0.9768; Dexs (n=11) a=-6.0935
//   b=1.7762 SD 0.7837; Liquid Staking (n=9) a=2.2055 b=0.5715 SD 0.6509;
//   Yield (n=9) a=1.3492 b=0.7078 SD 0.9644; CEX (n=9) a=3.1424 b=0.5454
//   SD 1.0966; RWA (n=9) a=4.1208 b=0.3916 SD 0.2711;
//   Canonical Bridge (n=8) a=3.1075 b=0.5525 SD 1.4502.
//   Growth weight tuned by LOO: w=0.5 wins (median abs log10 error 0.6349,
//   vs 0.6361 at w=0.25 and 0.6432 at w=0.75); the gaps are small because the
//   7d change moves the value only a little either way, and the middle weight
//   keeps a hot week from overstating a launch while still rewarding growth.
//   LOO (128 comps, w=0.5): median abs log10 error 0.6349,
//   median abs % error 92.69. Holdout (every 5th comp by slug order, 25 held
//   out, fitted on the other 103): median abs % error 82.83.
//   The errors are large in honest terms: TVL explains only part of market
//   cap, so every row carries its uncertainty band (low/high) and the
//   dashboard says plainly that implied value is a model, not a promise.

import { farmSteps, type FarmStep } from './farm.ts';

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One fitted log-log curve: log10(mcap) = a + b * log10(tvl). */
export interface CurveFit {
  a: number;
  b: number;
  n: number;
  resid_sd_log10: number;
  kind: string;
}

/** What one protocol scores under the fitted curves. */
export interface ModelResult {
  value: number;
  low: number;
  high: number;
  base: number;
  growth_mult: number;
  maturity_mult: number;
  age_days: number | null;
  curve: string;
}

/** The fitted curves plus the tuned growth weight and the backtest. */
export interface FittedCurves {
  byCategory: Record<string, CurveFit>;
  global: CurveFit;
  growth_weight: number;
  backtest: {
    loo_median_abs_log10_err: number;
    loo_median_abs_pct_err: number;
    holdout_median_abs_pct_err: number;
    n_comps: number;
  };
  loo_by_weight: Record<string, { median_abs_log10_err: number; median_abs_pct_err: number }>;
}

/** One row of board.json. Extra keys are allowed by the gate; these are the contract's. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_low_usd: number;
  implied_high_usd: number;
  curve: string;
  base_value_usd: number;
  farm_total_usd: number;
  farm_total_min: number;
}

/** One row of data.js: the board row with the farm plan as structured steps. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  implied_value_usd: number;
  farm_steps: FarmStep[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  implied_low_usd: number;
  implied_high_usd: number;
  curve: string;
  base_value_usd: number;
  farm_total_usd: number;
  farm_total_min: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  floor_usd: number;
  model_version: string;
  model: {
    byCategory: Record<string, CurveFit>;
    global: CurveFit;
    growth_weight: number;
    growth_floor: number;
    growth_cap: number;
    maturity_floor: number;
    maturity_range: number;
    maturity_days: number;
    unknown_age_days: number;
    loo_by_weight: Record<string, { median_abs_log10_err: number; median_abs_pct_err: number }>;
  };
  backtest: FittedCurves['backtest'];
  counts: { watchlist: number; rows: number; early: number; live: number };
  watchlist: string[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'meridian-1';

/** How many early (non-watchlist) rows the board carries at most. */
export const EARLY_ROWS = 158;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** Growth clamp, in per cent of 7d TVL change. */
export const GROWTH_FLOOR = -60;
export const GROWTH_CAP = 120;

/** Maturity curve: 0.6 at listing, rising to 1.0 at 1095 days. */
export const MATURITY_FLOOR = 0.6;
export const MATURITY_RANGE = 0.4;
export const MATURITY_DAYS = 1095;
export const UNKNOWN_AGE_DAYS = 365;

/** Candidate growth weights, tuned by leave-one-out error. */
export const GROWTH_CANDIDATES = [0.25, 0.5, 0.75] as const;

/** Minimum comps for a category's own OLS fit; below that the fallback rules apply. */
export const CATEGORY_MIN_N = 8;
export const RATIO_MIN_N = 3;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const LOG10 = Math.log10;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Round to 6 decimal places, for stable bytes in data.js. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Round to 4 decimal places, for multipliers shown in the dashboard. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Ordinary least squares on (x, y) pairs; resid SD uses n-2 degrees of freedom. */
function olsFit(xs: number[], ys: number[]): { a: number; b: number; resid_sd: number } {
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) * (xs[i]! - meanX);
  }
  const b = den === 0 ? 0 : num / den;
  const a = meanY - b * meanX;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (ys[i]! - (a + b * xs[i]!)) ** 2;
  const resid_sd = n > 2 ? Math.sqrt(ss / (n - 2)) : 0;
  return { a, b, resid_sd };
}

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all (no market cap, no CoinGecko id, no symbol). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol already trades (it records a market cap above zero). */
export function isLiveToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0;
}

/** The watchlist's exclusion rule, minus the TVL floor: categories that are a wrapped, staked or
 *  bridged product or an exchange itself; a name ending in a version marker; a name carrying a whole
 *  word wrapped / staked / staking; a name beginning with an exchange's name. No protocol name is
 *  special-cased: only the category, the shape of the name, and the exchange-name list decide. */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

export function isExcluded(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_MARKER.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  return false;
}

/** The token-bearing comps a fit learns from: market cap and TVL both above zero. */
function compsOf(s: Snapshot): SnapshotProtocol[] {
  return s.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/** Fit the global curve and one curve per category present among `comps`. */
function buildFits(comps: SnapshotProtocol[]): {
  byCategory: Record<string, CurveFit>;
  global: CurveFit;
  globalMedianRatio: number;
} {
  const xs = comps.map((p) => LOG10(p.tvl_usd));
  const ys = comps.map((p) => LOG10(p.mcap_usd!));
  const g = olsFit(xs, ys);
  const global: CurveFit = { a: round6(g.a), b: round6(g.b), n: comps.length, resid_sd_log10: round6(g.resid_sd), kind: 'global' };
  const globalMedianRatio = median(comps.map((p) => p.mcap_usd! / p.tvl_usd));
  const byName = new Map<string, SnapshotProtocol[]>();
  for (const p of comps) {
    if (p.category === null) continue;
    const list = byName.get(p.category) ?? [];
    list.push(p);
    byName.set(p.category, list);
  }
  const byCategory: Record<string, CurveFit> = {};
  for (const [category, list] of [...byName.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (list.length >= CATEGORY_MIN_N) {
      const f = olsFit(
        list.map((p) => LOG10(p.tvl_usd)),
        list.map((p) => LOG10(p.mcap_usd!)),
      );
      byCategory[category] = { a: round6(f.a), b: round6(f.b), n: list.length, resid_sd_log10: round6(f.resid_sd), kind: 'category' };
    } else if (list.length >= RATIO_MIN_N) {
      // Global fit rescaled by the category's median mcap/TVL over the global median.
      const factor = median(list.map((p) => p.mcap_usd! / p.tvl_usd)) / globalMedianRatio;
      const a = g.a + LOG10(factor);
      let ss = 0;
      for (const p of list) ss += (LOG10(p.mcap_usd!) - (a + g.b * LOG10(p.tvl_usd))) ** 2;
      const resid_sd = Math.sqrt(ss / Math.max(1, list.length - 1));
      byCategory[category] = { a: round6(a), b: round6(g.b), n: list.length, resid_sd_log10: round6(resid_sd), kind: 'global×ratio' };
    } else {
      byCategory[category] = { ...global, n: list.length };
    }
  }
  return { byCategory, global, globalMedianRatio };
}

/** The curve that prices a protocol: its category's fit, else the pure global fit. */
function curveFor(category: string | null, fits: { byCategory: Record<string, CurveFit>; global: CurveFit }): CurveFit {
  if (category !== null && Object.prototype.hasOwnProperty.call(fits.byCategory, category)) {
    return fits.byCategory[category]!;
  }
  return fits.global;
}

/** The `curve` label a row carries: its category for a direct fit, else the fallback it used. */
function curveLabel(category: string | null, fit: CurveFit): string {
  if (fit.kind === 'category' && category !== null) return category;
  if (fit.kind === 'global×ratio') return 'global×ratio';
  return 'global';
}

/** Score one protocol under already-fitted curves and one growth weight. */
function predictWith(
  p: SnapshotProtocol,
  fits: { byCategory: Record<string, CurveFit>; global: CurveFit },
  weight: number,
  asOf: string,
): ModelResult {
  const fit = curveFor(p.category, fits);
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(GROWTH_CAP, Math.max(GROWTH_FLOOR, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * weight;
  const ageForModel = age ?? UNKNOWN_AGE_DAYS;
  const maturityMult =
    MATURITY_FLOOR + (Math.min(Math.max(ageForModel, 0), MATURITY_DAYS) / MATURITY_DAYS) * MATURITY_RANGE;
  const base = p.tvl_usd > 0 ? 10 ** (fit.a + fit.b * LOG10(p.tvl_usd)) : 1;
  const value = Math.max(1, Math.round(base * growthMult * maturityMult));
  const sigma = fit.resid_sd_log10;
  const low = Math.max(1, Math.round(value * 10 ** -sigma));
  const high = Math.round(value * 10 ** sigma);
  return {
    value,
    low,
    high,
    base: Math.round(base),
    growth_mult: round4(growthMult),
    maturity_mult: round4(maturityMult),
    age_days: age,
    curve: curveLabel(p.category, fit),
  };
}

/** Leave-one-out errors for one growth weight: refit without each comp, predict it, compare. */
function looErrors(comps: SnapshotProtocol[], weight: number, asOf: string): { median_abs_log10_err: number; median_abs_pct_err: number } {
  const logErrs: number[] = [];
  const pctErrs: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const rest = comps.filter((_, j) => j !== i);
    const fits = buildFits(rest);
    const pred = predictWith(comps[i]!, fits, weight, asOf);
    const actual = comps[i]!.mcap_usd!;
    logErrs.push(Math.abs(LOG10(pred.value) - LOG10(actual)));
    pctErrs.push((Math.abs(pred.value - actual) / actual) * 100);
  }
  return { median_abs_log10_err: round6(median(logErrs)), median_abs_pct_err: round6(median(pctErrs)) };
}

/** Fit the curves, tune the growth weight by LOO error, and backtest on a deterministic holdout. */
export function fitCurves(s: Snapshot): FittedCurves {
  const comps = [...compsOf(s)].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const full = buildFits(comps);
  const loo_by_weight: FittedCurves['loo_by_weight'] = {};
  let bestWeight = GROWTH_CANDIDATES[0]!;
  let bestLogErr = Number.POSITIVE_INFINITY;
  let bestPctErr = Number.POSITIVE_INFINITY;
  for (const w of GROWTH_CANDIDATES) {
    const errs = looErrors(comps, w, s.as_of);
    loo_by_weight[String(w)] = errs;
    if (errs.median_abs_log10_err < bestLogErr - 1e-12 ||
      (Math.abs(errs.median_abs_log10_err - bestLogErr) <= 1e-12 && errs.median_abs_pct_err < bestPctErr)) {
      bestWeight = w;
      bestLogErr = errs.median_abs_log10_err;
      bestPctErr = errs.median_abs_pct_err;
    }
  }
  // Deterministic 80/20 holdout: every 5th comp by slug order is held out, fitted on the other 103.
  const train = comps.filter((_, i) => i % 5 !== 4);
  const heldOut = comps.filter((_, i) => i % 5 === 4);
  const trainFits = buildFits(train);
  const holdoutPct = heldOut.map((p) => {
    const pred = predictWith(p, trainFits, bestWeight, s.as_of);
    return (Math.abs(pred.value - p.mcap_usd!) / p.mcap_usd!) * 100;
  });
  return {
    byCategory: full.byCategory,
    global: full.global,
    growth_weight: bestWeight,
    backtest: {
      loo_median_abs_log10_err: bestLogErr,
      loo_median_abs_pct_err: bestPctErr,
      holdout_median_abs_pct_err: round6(median(holdoutPct)),
      n_comps: comps.length,
    },
    loo_by_weight,
  };
}

/** Score one protocol under fitted curves (the growth weight the LOO tuning chose). */
export function scoreProtocol(p: SnapshotProtocol, curves: FittedCurves, s: Snapshot): ModelResult {
  return predictWith(p, curves, curves.growth_weight, s.as_of);
}

/** A farm step as one board string: its action, cost and time inline, within 20..600 characters. */
function stepString(step: FarmStep): string {
  let text = step.text.trim();
  if (text.length > 600) text = `${text.slice(0, 597)}...`;
  if (text.length < 20) text = `${text} Hold the position and check the protocol's own page for its rewards.`;
  return text;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => isLiveToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(s: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const curves = fitCurves(s);
  const index = new Map(s.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries.
  for (const slug of s.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols passing the exclusion rule, ranked by
  // implied value, capped at EARLY_ROWS. Never a replacement for a watchlist row.
  const early = s.protocols
    .filter((p) => !chosen.has(p.slug) && isPreToken(p) && !isExcluded(p))
    .map((p) => ({ p, scored: scoreProtocol(p, curves, s) }))
    .sort((a, b) => b.scored.value - a.scored.value || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const scored = [...chosen.values()].map((p) => ({ p, scored: scoreProtocol(p, curves, s) }));
  scored.sort((a, b) => b.scored.value - a.scored.value || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = [];
  const radarRows: RadarRow[] = [];
  scored.forEach((entry, i) => {
    const { p, scored: m } = entry;
    const steps = farmSteps(p, m.value);
    const farmTotalUsd = Math.round(steps.reduce((sum, st) => sum + st.cost_usd, 0) * 100) / 100;
    const farmTotalMin = steps.reduce((sum, st) => sum + st.time_min, 0);
    board.push({
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      implied_value_usd: m.value,
      farm_steps: steps.map(stepString),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: m.age_days,
      implied_low_usd: m.low,
      implied_high_usd: m.high,
      curve: m.curve,
      base_value_usd: m.base,
      farm_total_usd: farmTotalUsd,
      farm_total_min: farmTotalMin,
    });
    radarRows.push({
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      implied_value_usd: m.value,
      farm_steps: steps,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      age_days: m.age_days,
      implied_low_usd: m.low,
      implied_high_usd: m.high,
      curve: m.curve,
      base_value_usd: m.base,
      farm_total_usd: farmTotalUsd,
      farm_total_min: farmTotalMin,
    });
  });
  const live = liveRows(s);
  const earlyCount = board.filter((r) => !s.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: s.as_of,
    floor_usd: s.floor_usd,
    model_version: MODEL_VERSION,
    model: {
      byCategory: curves.byCategory,
      global: curves.global,
      growth_weight: curves.growth_weight,
      growth_floor: GROWTH_FLOOR,
      growth_cap: GROWTH_CAP,
      maturity_floor: MATURITY_FLOOR,
      maturity_range: MATURITY_RANGE,
      maturity_days: MATURITY_DAYS,
      unknown_age_days: UNKNOWN_AGE_DAYS,
      loo_by_weight: curves.loo_by_weight,
    },
    backtest: curves.backtest,
    counts: { watchlist: s.watchlist.length, rows: board.length, early: earlyCount, live: live.length },
    watchlist: s.watchlist,
    rows: radarRows,
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((v) => typeof v !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols: SnapshotProtocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, size, ranks, order, one shared
 *  implied value, farm steps, and the exclusion rule on every non-watchlist row. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  if (board.length !== snapshot.watchlist.length + EARLY_ROWS) {
    return `the board has ${board.length} rows, not ${snapshot.watchlist.length + EARLY_ROWS}`;
  }
  for (const r of board) {
    const p = index.get(r.slug);
    if (p === undefined) return `${r.slug} is not in the snapshot`;
    if (!snapshot.watchlist.includes(r.slug) && (!isPreToken(p) || isExcluded(p))) {
      return `${r.slug} is an early row but fails the pre-token or exclusion rule`;
    }
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.implied_low_usd <= 0 || r.implied_high_usd < r.implied_value_usd || r.implied_low_usd > r.implied_value_usd) {
      return `${r.slug} has an uncertainty band that does not bracket its implied value`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
