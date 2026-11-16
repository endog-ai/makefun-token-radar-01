// MERIDIAN — token-radar-01 farm-plan engine (builder B).
//
// One deterministic farm plan per protocol. A plan is a list of concrete,
// followable steps for farming a future token allocation from a pre-token
// protocol: set up a wallet, fund it on the protocol's primary chain, take
// the category's core position, keep the wallet active weekly, hold long
// enough to count across snapshots, then claim and log everything.
//
// Costs are gas + fees + slippage ONLY. Deposit amounts are CAPITAL — they
// are named in the step text so the farmer knows the position size, but they
// are never counted in cost_usd. A step that only reads a page costs $0.00.
//
// Gas per transaction, by chain (USD):
//   Ethereum 8.00, Arbitrum 0.25, Optimism 0.20, Base 0.10, Polygon 0.05,
//   Solana 0.01, Binance 0.15, Avalanche 0.30, zkSync Era 0.30, Linea 0.20,
//   Scroll 0.25, Blast 0.15, Mantle 0.10, Berachain 0.10, Sui 0.02,
//   Aptos 0.02, Near 0.01, Tron 1.00, Bitcoin 2.00, any other chain 1.00.
// A bridge step adds a $5-$15 bridge fee on top of gas. A two-transaction
// step (approve + execute, borrow + re-supply, repay + withdraw) costs 2x gas.
//
// Time per step is 5-60 minutes, except hold-to-accrue steps, which run in
// whole days (time_min = days * 1440). Hold length follows the model's
// implied value: a larger implied value needs a shorter qualifying hold.
// Everything is deterministic: no randomness, no dates, no clock reads.

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

/** One farm step: its action (with its $ cost and time stated inline), what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost_usd: number;
  time_min: number;
}

/** Gas in USD for one simple transaction on a chain. Unknown chains cost $1.00. */
const GAS_USD: Record<string, number> = {
  Ethereum: 8.0,
  Arbitrum: 0.25,
  Optimism: 0.2,
  Base: 0.1,
  Polygon: 0.05,
  Solana: 0.01,
  Binance: 0.15,
  Avalanche: 0.3,
  "zkSync Era": 0.3,
  Linea: 0.2,
  Scroll: 0.25,
  Blast: 0.15,
  Mantle: 0.1,
  Berachain: 0.1,
  Sui: 0.02,
  Aptos: 0.02,
  Near: 0.01,
  Tron: 1.0,
  Bitcoin: 2.0,
};

/** Chains reached by bridging USDC out of Ethereum (EVM L2s and sidechains). */
const BRIDGE_CHAINS = new Set([
  "Arbitrum",
  "Optimism",
  "Base",
  "Polygon",
  "zkSync Era",
  "Linea",
  "Scroll",
  "Blast",
  "Mantle",
  "Berachain",
  "Avalanche",
  "Binance",
]);

/** The bridge fee on top of gas, by destination chain: $5-$15. */
function bridgeFeeUsd(chain: string): number {
  if (chain === "Ethereum") return 12;
  if (chain === "Bitcoin") return 10;
  if (chain === "Tron") return 8;
  if (chain === "Solana") return 5;
  return 7;
}

/** Position size (capital, not cost) from the protocol's own TVL. */
function capitalUsd(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** Qualifying hold in days from the model's implied value: bigger value, shorter hold. */
function holdDays(impliedUsd: number): number {
  const v = Number.isFinite(impliedUsd) ? impliedUsd : 0;
  if (v >= 100_000_000) return 30;
  if (v >= 10_000_000) return 45;
  return 60;
}

function gasUsd(chain: string): number {
  return GAS_USD[chain] ?? 1.0;
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

/** Build one step, stating its $ cost and time inline in the text. */
function step(core: string, costUsd: number, timeMin: number): FarmStep {
  const cost = Math.round(costUsd * 100) / 100;
  const timeLabel =
    timeMin >= 1440 && timeMin % 1440 === 0 ? `${timeMin / 1440} days` : `${timeMin} min`;
  return { text: `${core} (${usd(cost)} cost, ~${timeLabel}).`, cost_usd: cost, time_min: timeMin };
}

/** Everything a category template needs, derived from the protocol record. */
interface Ctx {
  name: string;
  chain: string;
  gas: number;
  capital: number;
  hold: number;
}

/** Step 1, every plan: a fresh wallet holding only the farming funds. */
function setupStep(c: Ctx): FarmStep {
  return step(
    `Set up a fresh wallet for the ${c.name} farm, keep its seed phrase offline, and load it with $${c.capital} USDC for positions plus gas on ${c.chain}`,
    0,
    10,
  );
}

/** Step 2, every plan: get the USDC onto the protocol's primary chain. */
function fundStep(c: Ctx): FarmStep {
  if (BRIDGE_CHAINS.has(c.chain)) {
    return step(
      `Bridge $${c.capital} USDC from Ethereum to ${c.chain} for the ${c.name} farm and keep the receipt hash for the farm log`,
      bridgeFeeUsd(c.chain) + c.gas,
      20,
    );
  }
  return step(
    `Acquire $${c.capital} USDC natively on ${c.chain} for the ${c.name} farm, by on-ramp or by transfer from an exchange`,
    c.gas,
    10,
  );
}

/** The hold step, every plan: stay in the position across snapshots. */
function holdStep(c: Ctx): FarmStep {
  return step(
    `Leave the ${c.name} position untouched for at least ${c.hold} days so the activity counts across more than one snapshot and the yield accrues`,
    0,
    c.hold * 1440,
  );
}

/** The last step, every plan: write the farm log. */
function logStep(c: Ctx): FarmStep {
  return step(
    `Write the wallet address, the dates and every transaction hash for ${c.name} into a farm log so the position can be repeated or unwound cleanly`,
    0,
    5,
  );
}

/** A weekly check-in step with category-specific wording. */
function weekly(c: Ctx, action: string, cost: number, timeMin: number): FarmStep {
  return step(action, cost, timeMin);
}

/** A claim-and-exit step with category-specific wording. */
function claim(c: Ctx, action: string, cost: number, timeMin: number): FarmStep {
  return step(action, cost, timeMin);
}

/** Dexs: swap, add liquidity, keep the LP receipt, harvest fees. */
function dexsPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Swap half of the USDC for the paired asset in ${c.name}'s main pool on ${c.chain} so the liquidity is balanced`,
      c.gas + 0.3,
      10,
    ),
    step(
      `Add $${c.capital} of liquidity (USDC plus the paired asset) to ${c.name}'s main pool on ${c.chain} and keep the LP receipt in the farm wallet`,
      c.gas * 2,
      15,
    ),
    weekly(
      c,
      `Swap a small amount through ${c.name} on ${c.chain} once a week to keep the wallet active in the pool`,
      c.gas,
      10,
    ),
    holdStep(c),
    claim(
      c,
      `Claim any accrued trading fees or points from ${c.name} on ${c.chain}, then remove the liquidity only after the hold ends`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Lending: supply, loop the borrow once, watch the health factor. */
function lendingPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Supply $${c.capital} USDC to ${c.name}'s lending market on ${c.chain} and confirm the supply receipt`,
      c.gas,
      10,
    ),
    step(
      `Borrow up to half of the supplied collateral in a stable asset on ${c.name}, then re-supply the borrowed amount to loop the position once`,
      c.gas * 2,
      20,
    ),
    weekly(
      c,
      `Check the borrow rate and health factor on ${c.name} weekly and top up collateral if the ratio tightens`,
      c.gas,
      10,
    ),
    holdStep(c),
    claim(
      c,
      `Repay the looped borrow on ${c.name}, withdraw the supply from ${c.chain}, and claim any accrued interest or points`,
      c.gas * 2,
      20,
    ),
    logStep(c),
  ];
}

/** RWA: mint the tokenised real-world asset, hold it, claim its yield. */
function rwaPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Mint $${c.capital} of ${c.name}'s tokenised real-world asset on ${c.chain} and confirm the mint receipt`,
      c.gas + 1,
      15,
    ),
    weekly(
      c,
      `Check ${c.name}'s yield accrual and net asset value update weekly and record the new balance in the farm log`,
      0,
      5,
    ),
    holdStep(c),
    claim(
      c,
      `Claim the accrued yield from ${c.name} on ${c.chain} and redeem the tokenised asset only after the hold ends`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Risk Curators: deposit into curated vaults, split across two risk profiles. */
function riskCuratorsPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Deposit $${c.capital} USDC into a ${c.name}-curated vault on ${c.chain} and keep the vault shares in the farm wallet`,
      c.gas,
      10,
    ),
    step(
      `Compare the vaults ${c.name} curates on ${c.chain} and split the deposit across two vaults with different risk profiles`,
      c.gas,
      15,
    ),
    weekly(
      c,
      `Review ${c.name}'s curator reports weekly and move the deposit if a vault's risk score worsens`,
      c.gas,
      10,
    ),
    holdStep(c),
    claim(
      c,
      `Withdraw the vault shares from ${c.name} on ${c.chain} and claim any accrued curator rewards`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Yield: deposit into the best vault, stake the receipt in the gauge, compound weekly. */
function yieldPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Deposit $${c.capital} USDC into ${c.name}'s highest-yield vault on ${c.chain}`,
      c.gas,
      10,
    ),
    step(
      `Stake the vault receipt token in ${c.name}'s rewards gauge on ${c.chain} so the position earns the extra reward stream`,
      c.gas,
      10,
    ),
    weekly(
      c,
      `Harvest and re-compound the ${c.name} yield weekly so the position grows instead of sitting idle`,
      c.gas,
      10,
    ),
    holdStep(c),
    claim(
      c,
      `Claim all ${c.name} rewards on ${c.chain} and withdraw the vault position only after the hold ends`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Yield Aggregator: deposit, let it route, auto-compound, check the routing report. */
function yieldAggregatorPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Deposit $${c.capital} USDC into ${c.name} on ${c.chain} and let its aggregator route the funds to the best vault`,
      c.gas,
      10,
    ),
    step(
      `Turn on auto-compounding in ${c.name} so harvested yield is re-deposited without a manual transaction`,
      c.gas,
      10,
    ),
    weekly(
      c,
      `Check ${c.name}'s routing report weekly to confirm the funds still sit in the best available vault`,
      0,
      5,
    ),
    holdStep(c),
    claim(
      c,
      `Claim the aggregated yield from ${c.name} on ${c.chain} and withdraw the position only after the hold ends`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** CDP: lock collateral, mint stables below 50%, watch the ratio, repay to unlock. */
function cdpPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Lock $${c.capital} of collateral in a ${c.name} CDP vault on ${c.chain} and confirm the vault is open`,
      c.gas,
      15,
    ),
    step(
      `Mint stablecoins against the collateral at a safe ratio below 50% on ${c.name}`,
      c.gas,
      10,
    ),
    weekly(
      c,
      `Check the ${c.name} vault's collateral ratio weekly and add collateral if the price of the locked asset falls`,
      0,
      5,
    ),
    holdStep(c),
    claim(
      c,
      `Repay the minted stablecoins on ${c.name} and unlock the collateral from the ${c.chain} vault`,
      c.gas * 2,
      20,
    ),
    logStep(c),
  ];
}

/** Derivatives: post margin, open one small hedged position, roll it weekly. */
function derivativesPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Deposit $${c.capital} USDC as margin on ${c.name} on ${c.chain}`,
      c.gas,
      10,
    ),
    step(
      `Open one small hedged perpetual position on ${c.name} with low leverage, sized so a normal move cannot liquidate it`,
      c.gas + 0.5,
      15,
    ),
    weekly(
      c,
      `Roll or close the ${c.name} hedge weekly and re-open it only if the funding rate still favours the position`,
      c.gas,
      10,
    ),
    holdStep(c),
    claim(
      c,
      `Close the perpetual position on ${c.name}, withdraw the margin from ${c.chain}, and claim any trading rewards`,
      c.gas * 2,
      20,
    ),
    logStep(c),
  ];
}

/** Basis Trading: fund the basis vault, let the spot-long / perp-short trade run. */
function basisTradingPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Deposit $${c.capital} USDC into ${c.name}'s basis vault on ${c.chain}`,
      c.gas,
      10,
    ),
    step(
      `Let ${c.name} run its spot-long and perpetual-short basis trade, and read its funding-rate report to confirm the trade is live`,
      0,
      10,
    ),
    weekly(
      c,
      `Check ${c.name}'s funding-rate report weekly; a negative funding rate for several days is the signal to exit`,
      0,
      5,
    ),
    holdStep(c),
    claim(
      c,
      `Withdraw the basis position from ${c.name} on ${c.chain} and claim the accrued basis yield`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Chain: fund the chain, stake its native asset, use one native app a week. */
function chainPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Stake $${c.capital} of ${c.chain}'s native asset through ${c.name}'s validator set and keep the staking receipt`,
      c.gas,
      15,
    ),
    weekly(
      c,
      `Use one native app on ${c.chain} each week through ${c.name} — a swap, a lend, or a vote — to build on-chain activity`,
      c.gas,
      10,
    ),
    weekly(
      c,
      `Check ${c.name}'s chain rewards page weekly and record the staking balance in the farm log`,
      0,
      5,
    ),
    holdStep(c),
    claim(
      c,
      `Claim the staking rewards from ${c.name} on ${c.chain} and unstake only after the hold ends`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Restaking: stake the base asset, then restake the receipt with an operator. */
function restakingPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Stake $${c.capital} of the base asset through ${c.name} on ${c.chain} and keep the staking receipt`,
      c.gas,
      10,
    ),
    step(
      `Restake the receipt token with one of ${c.name}'s operators on ${c.chain} so the same capital secures a second service`,
      c.gas,
      15,
    ),
    weekly(
      c,
      `Check ${c.name}'s operator rewards weekly and switch operators only if one stops paying`,
      0,
      5,
    ),
    holdStep(c),
    claim(
      c,
      `Claim the restaking rewards from ${c.name} on ${c.chain} and unwind the restake only after the hold ends`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Payments: open a channel, route small payments weekly, settle on close. */
function paymentsPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Open a payment channel through ${c.name} on ${c.chain} with $${c.capital} of capacity and confirm the channel is live`,
      c.gas + 1,
      20,
    ),
    weekly(
      c,
      `Route a few small payments through the ${c.name} channel each week to keep it active and earn routing fees`,
      0.1,
      10,
    ),
    weekly(
      c,
      `Check the ${c.name} channel balance weekly and rebalance it if one side runs dry`,
      0,
      5,
    ),
    holdStep(c),
    claim(
      c,
      `Close the ${c.name} channel on ${c.chain}, settle the final balance to the farm wallet, and record the routing fees earned`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Insurance: buy cover, stake in the underwriting pool, claim the yield. */
function insurancePlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Buy $${c.capital} of cover from ${c.name} on ${c.chain} for the position you plan to protect and keep the policy receipt`,
      c.gas + 2,
      15,
    ),
    step(
      `Stake $${c.capital} in ${c.name}'s underwriting pool on ${c.chain} so the farm also earns underwriting yield`,
      c.gas,
      10,
    ),
    weekly(
      c,
      `Check ${c.name}'s underwriting pool yield and any open claims weekly`,
      0,
      5,
    ),
    holdStep(c),
    claim(
      c,
      `Claim the underwriting yield from ${c.name} on ${c.chain} and withdraw the stake only after the hold ends`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** CeDeFi: deposit into the CeDeFi vault, verify the account, check the CeFi yield report. */
function cedefiPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Deposit $${c.capital} USDC into ${c.name}'s CeDeFi vault on ${c.chain}`,
      c.gas,
      10,
    ),
    step(
      `Complete ${c.name}'s account verification from its own app and link the farm wallet to the verified account`,
      0,
      15,
    ),
    weekly(
      c,
      `Check ${c.name}'s centralised yield report weekly and confirm the vault balance matches it`,
      0,
      5,
    ),
    holdStep(c),
    claim(
      c,
      `Withdraw the vault balance from ${c.name} on ${c.chain} and claim any accrued CeDeFi yield`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Onchain Capital Allocator: allocate to a vault, split across two strategies. */
function allocatorPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Allocate $${c.capital} USDC to a ${c.name} vault on ${c.chain} and keep the vault shares in the farm wallet`,
      c.gas,
      10,
    ),
    step(
      `Split the allocation across two ${c.name} strategies on ${c.chain} with different risk profiles`,
      c.gas,
      15,
    ),
    weekly(
      c,
      `Review ${c.name}'s allocator report weekly and rebalance only if one strategy drifts far from target`,
      c.gas,
      10,
    ),
    holdStep(c),
    claim(
      c,
      `Withdraw the allocation from ${c.name} on ${c.chain} and claim any accrued allocator rewards`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Staking Pool: stake, use the liquid receipt in DeFi, unstake after the hold. */
function stakingPoolPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Stake $${c.capital} of the pool asset with ${c.name} on ${c.chain} and keep the staking receipt`,
      c.gas,
      10,
    ),
    step(
      `Hold the liquid staking receipt from ${c.name} and use it in one ${c.chain} DeFi position, such as a lend or an LP`,
      c.gas,
      10,
    ),
    weekly(
      c,
      `Check ${c.name}'s staking rewards weekly and record the receipt token balance in the farm log`,
      0,
      5,
    ),
    holdStep(c),
    claim(
      c,
      `Unstake from ${c.name} on ${c.chain} and claim the accrued staking rewards only after the hold ends`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Indexes: buy the index token, track its composition and rebalances, redeem after the hold. */
function indexesPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Buy $${c.capital} of ${c.name}'s index token on ${c.chain} and keep it in the farm wallet`,
      c.gas + 0.3,
      10,
    ),
    step(
      `Read ${c.name}'s index composition and next rebalance date so you know what the token holds`,
      0,
      10,
    ),
    weekly(
      c,
      `Check ${c.name}'s index rebalance and net asset value weekly`,
      0,
      5,
    ),
    holdStep(c),
    claim(
      c,
      `Sell or redeem the ${c.name} index token on ${c.chain} only after the hold ends`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/** Generic fallback: deposit, use one more feature, stay active weekly, claim, log. */
function genericPlan(c: Ctx): FarmStep[] {
  return [
    setupStep(c),
    fundStep(c),
    step(
      `Deposit $${c.capital} USDC into ${c.name} on ${c.chain} and keep the position open`,
      c.gas,
      10,
    ),
    step(
      `Use one more ${c.name} feature on ${c.chain} — a swap, a stake, or a vote — so the wallet shows more than a single deposit`,
      c.gas,
      10,
    ),
    weekly(
      c,
      `Make one qualifying action on ${c.name} each week, such as a deposit, a swap, or a vote`,
      c.gas,
      10,
    ),
    holdStep(c),
    claim(
      c,
      `Claim any rewards or points from ${c.name} on ${c.chain} and withdraw only after the hold ends`,
      c.gas,
      15,
    ),
    logStep(c),
  ];
}

/**
 * A protocol's farm plan: 7-8 concrete steps, each naming the protocol and
 * its primary chain, costed in gas + fees + slippage only (deposits are
 * capital, named in the text but never counted as cost) and timed in
 * minutes — except the hold step, which runs in whole days.
 * Deterministic: the same protocol and implied value always give the same plan.
 */
export function farmSteps(p: SnapshotProtocol, impliedUsd: number): FarmStep[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : "Ethereum";
  const ctx: Ctx = {
    name: p.name,
    chain,
    gas: gasUsd(chain),
    capital: capitalUsd(p),
    hold: holdDays(impliedUsd),
  };
  const category = (p.category ?? "").trim().toLowerCase();
  switch (category) {
    case "dexs":
      return dexsPlan(ctx);
    case "lending":
      return lendingPlan(ctx);
    case "rwa":
      return rwaPlan(ctx);
    case "risk curators":
      return riskCuratorsPlan(ctx);
    case "yield":
      return yieldPlan(ctx);
    case "yield aggregator":
      return yieldAggregatorPlan(ctx);
    case "cdp":
      return cdpPlan(ctx);
    case "derivatives":
      return derivativesPlan(ctx);
    case "basis trading":
      return basisTradingPlan(ctx);
    case "chain":
      return chainPlan(ctx);
    case "restaking":
      return restakingPlan(ctx);
    case "payments":
      return paymentsPlan(ctx);
    case "insurance":
      return insurancePlan(ctx);
    case "cedefi":
      return cedefiPlan(ctx);
    case "onchain capital allocator":
      return allocatorPlan(ctx);
    case "staking pool":
      return stakingPoolPlan(ctx);
    case "indexes":
      return indexesPlan(ctx);
    default:
      return genericPlan(ctx);
  }
}
