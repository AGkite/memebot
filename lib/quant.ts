import type {
  BacktestResult,
  BacktestTrade,
  Candle,
  Evaluation,
  ExitCode,
  PoolSnapshot,
  StrategyConfig,
} from "./types";

export const defaultConfig: StrategyConfig = {
  minLiquidityUsd: 40_000,
  maxFdvToLiquidity: 120,
  minPoolAgeMinutes: 45,
  maxPoolAgeHours: 0,
  minHourlyTx: 30,
  requireMajorQuote: true,
  maxPositionUsd: 400,
  maxPositions: 4,
  maxLiquidityShare: 0.015,
  entryScore: 68,
  exitScore: 40,
  stopLossPct: 0.14,
  takeProfitPct: 0.5,
  trailActivatePct: 0.2,
  trailGivebackPct: 0.12,
  timeStopMinutes: 240,
  feeBps: 30,
  maxSlippageBps: 180,
  minH1ChangePct: 2,
  maxH1ChangePct: 90,
  minImbalance: 0.04,
  dailyLossLimitPct: 0.08,
  initialCash: 10_000,
};

const MAJOR_QUOTES = new Set([
  "SOL",
  "WSOL",
  "USDC",
  "USDT",
  "USD1",
  "ETH",
  "WETH",
  "BNB",
  "WBNB",
]);

export function isMajorQuote(symbol: string): boolean {
  return MAJOR_QUOTES.has(symbol.trim().toUpperCase());
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function poolAgeMinutes(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return (now - t) / 60_000;
}

export function orderFlowImbalance(buys: number, sells: number): number {
  const total = buys + sells;
  if (total <= 0) return 0;
  return (buys - sells) / total;
}

export function fdvToLiquidity(pool: PoolSnapshot): number | null {
  if (pool.fdvUsd == null || pool.fdvUsd <= 0 || pool.liquidityUsd <= 0) return null;
  return pool.fdvUsd / pool.liquidityUsd;
}

/** Triangular score: 0 outside [lo, hi], 100 at peak. */
export function triangle(value: number, lo: number, peak: number, hi: number): number {
  if (!(hi > peak && peak > lo)) return 0;
  if (value <= lo || value >= hi) return 0;
  if (value <= peak) return ((value - lo) / (peak - lo)) * 100;
  return ((hi - value) / (hi - peak)) * 100;
}

/**
 * Constant-product impact for spending `usd` of quote.
 * A balanced pool's quote reserve is about half of reserve_in_usd.
 * Impact ≈ usd / quoteReserve. Trades above half the quote reserve are refused.
 * Returned value is one-way cost in bps, fee included.
 */
export function executionCostBps(
  usd: number,
  liquidityUsd: number,
  feeBps: number,
): number | null {
  if (!(usd > 0) || !(liquidityUsd > 0) || !Number.isFinite(feeBps)) return null;
  const quoteReserve = liquidityUsd / 2;
  if (usd >= quoteReserve * 0.5) return null;
  const impactBps = (usd / quoteReserve) * 10_000;
  return feeBps + impactBps;
}

export function fillPrice(mid: number, side: "buy" | "sell", costBps: number): number {
  const multiplier = costBps / 10_000;
  if (!(mid > 0) || !Number.isFinite(multiplier)) return 0;
  return side === "buy" ? mid * (1 + multiplier) : mid * (1 - multiplier);
}

export function positionSizeUsd(
  cash: number,
  liquidityUsd: number,
  config: StrategyConfig,
): number {
  if (!(cash > 0) || !(liquidityUsd > 0)) return 0;
  const size = Math.min(config.maxPositionUsd, cash, liquidityUsd * config.maxLiquidityShare);
  if (size < 25) return 0;
  return Math.round(size * 100) / 100;
}

export function liquidationUsd(
  qty: number,
  mid: number,
  liquidityUsd: number,
  feeBps: number,
): number {
  if (!(qty > 0) || !(mid > 0)) return 0;
  const gross = qty * mid;
  const bps = executionCostBps(gross, liquidityUsd, feeBps) ?? 5_000;
  return qty * fillPrice(mid, "sell", bps);
}

function liquidityScore(usd: number): number {
  if (!(usd > 0)) return 0;
  const log = Math.log10(usd);
  return clamp(((log - 4) / 2.2) * 100, 0, 100);
}

function flowScore(pool: PoolSnapshot): number {
  const imbalance = orderFlowImbalance(pool.tx.h1.buys, pool.tx.h1.sells);
  const imbalanceScore = clamp(((imbalance + 0.2) / 0.65) * 100, 0, 100);
  const buyers = pool.tx.h1.buyers;
  const sellers = pool.tx.h1.sellers;
  const breadth = buyers + sellers;
  const breadthScore =
    breadth <= 0 ? 40 : clamp((((buyers / breadth - 0.4) / 0.35) * 100), 0, 100);
  return 0.7 * imbalanceScore + 0.3 * breadthScore;
}

function momentumScore(pool: PoolSnapshot): number {
  let score = triangle(pool.priceChange.h1, -8, 16, 85);
  if (pool.priceChange.m15 < -5) score *= 0.7;
  if (pool.priceChange.m5 <= -8) score *= 0.45;
  return clamp(score, 0, 100);
}

function turnoverOf(pool: PoolSnapshot): number {
  if (!(pool.liquidityUsd > 0)) return 0;
  return pool.volume.h1 / pool.liquidityUsd;
}

export function evaluatePool(
  pool: PoolSnapshot,
  config: StrategyConfig,
  now = Date.now(),
): Evaluation {
  const imbalance = orderFlowImbalance(pool.tx.h1.buys, pool.tx.h1.sells);
  const turnover = turnoverOf(pool);
  const ageMinutes = poolAgeMinutes(pool.poolCreatedAt, now);
  const parts = {
    flow: flowScore(pool),
    momentum: momentumScore(pool),
    liquidity: liquidityScore(pool.liquidityUsd),
    turnover: triangle(turnover, 0, 0.55, 4.5),
  };

  let score =
    0.28 * parts.flow +
    0.3 * parts.momentum +
    0.24 * parts.liquidity +
    0.18 * parts.turnover;

  if (config.requireMajorQuote && !isMajorQuote(pool.quoteSymbol)) score -= 20;
  const ratio = fdvToLiquidity(pool);
  if (ratio != null && ratio > 150) score -= 18;
  else if (ratio != null && ratio > 80) score -= 8;
  if (ageMinutes != null && ageMinutes < 30) score -= 12;
  if (pool.priceChange.m5 <= -10) score -= 8;
  score = Math.round(clamp(score, 0, 100) * 10) / 10;

  const hourlyTx = pool.tx.h1.buys + pool.tx.h1.sells;
  const ageMaxMinutes = config.maxPoolAgeHours > 0 ? config.maxPoolAgeHours * 60 : null;
  const gates = [
    {
      id: "liquidity",
      label: "流动性",
      pass: pool.liquidityUsd >= config.minLiquidityUsd,
      detail: `池子 $${Math.round(pool.liquidityUsd).toLocaleString("en-US")}，门槛 $${Math.round(config.minLiquidityUsd).toLocaleString("en-US")}`,
    },
    {
      id: "activity",
      label: "成交笔数",
      pass: hourlyTx >= config.minHourlyTx,
      detail: `1 小时 ${hourlyTx} 笔，门槛 ${config.minHourlyTx} 笔`,
    },
    {
      id: "quote",
      label: "报价资产",
      pass: !config.requireMajorQuote || isMajorQuote(pool.quoteSymbol),
      detail: pool.quoteSymbol
        ? `报价 ${pool.quoteSymbol}`
        : "报价币种未知",
    },
    {
      id: "ageMin",
      label: "最短池龄",
      pass: ageMinutes != null && ageMinutes >= config.minPoolAgeMinutes,
      detail:
        ageMinutes == null
          ? "没有建池时间，无法确认是不是刚开盘"
          : `已存在 ${ageMinutes.toFixed(0)} 分钟，门槛 ${config.minPoolAgeMinutes} 分钟`,
    },
    {
      id: "ageMax",
      label: "最长池龄",
      pass:
        ageMaxMinutes == null ||
        (ageMinutes != null && ageMinutes <= ageMaxMinutes),
      detail:
        ageMaxMinutes == null
          ? "不限制最长池龄"
          : ageMinutes == null
            ? "没有建池时间"
            : `已存在 ${(ageMinutes / 60).toFixed(1)} 小时，上限 ${config.maxPoolAgeHours} 小时`,
    },
    {
      id: "fdv",
      label: "FDV / 流动性",
      pass: ratio == null || ratio <= config.maxFdvToLiquidity,
      detail:
        ratio == null
          ? "没有可用 FDV，跳过这项"
          : `比值 ${ratio.toFixed(1)}，上限 ${config.maxFdvToLiquidity}`,
    },
    {
      id: "momentum",
      label: "1 小时涨幅",
      pass:
        pool.priceChange.h1 >= config.minH1ChangePct &&
        pool.priceChange.h1 <= config.maxH1ChangePct,
      detail: `${pool.priceChange.h1.toFixed(1)}%，允许 ${config.minH1ChangePct}% 到 ${config.maxH1ChangePct}%`,
    },
    {
      id: "imbalance",
      label: "买卖差",
      pass: imbalance >= config.minImbalance,
      detail: `${imbalance >= 0 ? "+" : ""}${imbalance.toFixed(2)}，门槛 ${config.minImbalance.toFixed(2)}`,
    },
    {
      id: "score",
      label: "分数",
      pass: score >= config.entryScore,
      detail: `${score.toFixed(1)}，开仓线 ${config.entryScore}`,
    },
  ];

  const structural = gates
    .filter((gate) =>
      ["liquidity", "activity", "quote", "ageMin", "ageMax", "fdv"].includes(gate.id),
    )
    .every((gate) => gate.pass);
  const timing = gates
    .filter((gate) => ["momentum", "imbalance", "score"].includes(gate.id))
    .every((gate) => gate.pass);

  const failed = gates.find((gate) => !gate.pass);
  const signal = !structural ? "reject" : timing ? "enter" : "watch";
  const note = failed ? `${failed.label}未通过：${failed.detail}` : "通过全部开仓条件";

  return { score, parts, gates, signal, note, imbalance, turnover, ageMinutes };
}

export function decideExit(
  pos: { entryPrice: number; peakPrice: number; openedAt: number },
  price: number,
  score: number,
  now: number,
  config: StrategyConfig,
): ExitCode | null {
  if (!(pos.entryPrice > 0) || !(price > 0)) return null;
  const ret = price / pos.entryPrice - 1;
  if (ret <= -config.stopLossPct) return "stop";
  if (ret >= config.takeProfitPct) return "take_profit";
  const peak = Math.max(pos.peakPrice, price);
  const peakRet = peak / pos.entryPrice - 1;
  if (
    peakRet >= config.trailActivatePct &&
    price <= peak * (1 - config.trailGivebackPct)
  ) {
    return "trail";
  }
  const heldMinutes = (now - pos.openedAt) / 60_000;
  if (heldMinutes >= 10 && score < config.exitScore) return "score";
  if (heldMinutes >= config.timeStopMinutes) return "time";
  return null;
}

export function exitLabel(code: ExitCode | string): string {
  switch (code) {
    case "stop":
      return "止损";
    case "take_profit":
      return "止盈";
    case "trail":
      return "移动止盈";
    case "score":
      return "分数跌破离场线";
    case "time":
      return "持有超时";
    case "manual":
      return "手动平仓";
    default:
      return code;
  }
}

export function sanitizeConfig(input: Partial<StrategyConfig> | null | undefined): StrategyConfig {
  const source = input ?? {};
  const num = (key: keyof StrategyConfig, fallback: number) => {
    const value = source[key];
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const minH1 = clamp(num("minH1ChangePct", defaultConfig.minH1ChangePct), -50, 200);
  const config: StrategyConfig = {
    minLiquidityUsd: clamp(num("minLiquidityUsd", defaultConfig.minLiquidityUsd), 1_000, 5_000_000),
    maxFdvToLiquidity: clamp(num("maxFdvToLiquidity", defaultConfig.maxFdvToLiquidity), 5, 10_000),
    minPoolAgeMinutes: clamp(num("minPoolAgeMinutes", defaultConfig.minPoolAgeMinutes), 0, 24 * 60),
    maxPoolAgeHours: clamp(num("maxPoolAgeHours", defaultConfig.maxPoolAgeHours), 0, 24 * 365),
    minHourlyTx: Math.round(clamp(num("minHourlyTx", defaultConfig.minHourlyTx), 0, 5_000)),
    requireMajorQuote:
      typeof source.requireMajorQuote === "boolean"
        ? source.requireMajorQuote
        : defaultConfig.requireMajorQuote,
    maxPositionUsd: clamp(num("maxPositionUsd", defaultConfig.maxPositionUsd), 25, 100_000),
    maxPositions: Math.round(clamp(num("maxPositions", defaultConfig.maxPositions), 1, 8)),
    maxLiquidityShare: clamp(
      num("maxLiquidityShare", defaultConfig.maxLiquidityShare),
      0.001,
      0.1,
    ),
    entryScore: clamp(num("entryScore", defaultConfig.entryScore), 1, 99),
    exitScore: clamp(num("exitScore", defaultConfig.exitScore), 1, 98),
    stopLossPct: clamp(num("stopLossPct", defaultConfig.stopLossPct), 0.02, 0.6),
    takeProfitPct: clamp(num("takeProfitPct", defaultConfig.takeProfitPct), 0.05, 5),
    trailActivatePct: clamp(num("trailActivatePct", defaultConfig.trailActivatePct), 0.05, 2),
    trailGivebackPct: clamp(num("trailGivebackPct", defaultConfig.trailGivebackPct), 0.03, 0.5),
    timeStopMinutes: clamp(num("timeStopMinutes", defaultConfig.timeStopMinutes), 5, 60 * 24 * 7),
    feeBps: clamp(num("feeBps", defaultConfig.feeBps), 0, 300),
    maxSlippageBps: clamp(num("maxSlippageBps", defaultConfig.maxSlippageBps), 10, 2_000),
    minH1ChangePct: minH1,
    maxH1ChangePct: clamp(
      Math.max(num("maxH1ChangePct", defaultConfig.maxH1ChangePct), minH1 + 1),
      -40,
      500,
    ),
    minImbalance: clamp(num("minImbalance", defaultConfig.minImbalance), -1, 0.9),
    dailyLossLimitPct: clamp(num("dailyLossLimitPct", defaultConfig.dailyLossLimitPct), 0.01, 0.5),
    initialCash: defaultConfig.initialCash,
  };
  if (config.exitScore >= config.entryScore) {
    config.exitScore = Math.max(1, config.entryScore - 1);
  }
  return config;
}

export const BACKTEST_NOTE =
  "5 分钟 K 线。信号在收盘确认，下一根开盘才成交。近似规则是：约 1 小时动量落在设定区间，成交量高于均量 1.7 倍，且收盘靠近这根 K 线高点。出场沿用止损、止盈、移动止盈和持有时间。滑点用当前流动性代替整段历史，早期池子通常更浅，收益会偏乐观。K 线没有买卖笔数。";

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function closeLocation(candle: Candle): number {
  const range = candle.high - candle.low;
  if (!(range > 0)) return 0.5;
  return (candle.close - candle.low) / range;
}

export function runBacktest(input: {
  candles: Candle[];
  liquidityUsd: number;
  config: StrategyConfig;
  barMinutes: number;
  lookback: number;
  volumeLookback: number;
  volumeMultiple: number;
}): BacktestResult {
  const { candles, liquidityUsd, config } = input;
  const barMinutes = input.barMinutes;
  const lookback = input.lookback;
  const volumeLookback = input.volumeLookback;
  const startEquity = config.initialCash;
  let cash = startEquity;
  const trades: BacktestTrade[] = [];
  const equity: BacktestResult["equity"] = [];

  type OpenPos = {
    entryTime: number;
    entryFill: number;
    qty: number;
    costUsd: number;
    peak: number;
    bars: number;
  };

  let pos: OpenPos | null = null;
  let pending = false;

  const mark = (time: number, mid: number) => {
    const liquidation = pos
      ? liquidationUsd(pos.qty, mid, liquidityUsd, config.feeBps)
      : 0;
    equity.push({ time, equity: Math.round((cash + liquidation) * 100) / 100 });
  };

  const closeAt = (time: number, rawPrice: number, reason: string) => {
    if (!pos) return;
    const gross = pos.qty * rawPrice;
    const bps = executionCostBps(gross, liquidityUsd, config.feeBps) ?? 5_000;
    const exitFill = fillPrice(rawPrice, "sell", bps);
    const proceeds = pos.qty * exitFill;
    const pnlUsd = proceeds - pos.costUsd;
    cash = Math.round((cash + proceeds) * 100) / 100;
    trades.push({
      entryTime: pos.entryTime,
      exitTime: time,
      entryPrice: pos.entryFill,
      exitPrice: exitFill,
      pnlUsd,
      pnlPct: pos.costUsd > 0 ? pnlUsd / pos.costUsd : 0,
      reason,
      barsHeld: pos.bars,
    });
    pos = null;
  };

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    if (pending && !pos) {
      const size = positionSizeUsd(cash, liquidityUsd, config);
      const bps =
        size > 0 ? executionCostBps(size, liquidityUsd, config.feeBps) : null;
      if (size > 0 && bps != null && bps <= config.maxSlippageBps && bar.open > 0) {
        const entryFill = fillPrice(bar.open, "buy", bps);
        const qty = size / entryFill;
        cash = Math.round((cash - size) * 100) / 100;
        pos = {
          entryTime: bar.time,
          entryFill,
          qty,
          costUsd: size,
          peak: entryFill,
          bars: 0,
        };
      }
      pending = false;
    }

    if (pos) {
      pos.bars += 1;
      const stopPx = pos.entryFill * (1 - config.stopLossPct);
      const trailOn = pos.peak >= pos.entryFill * (1 + config.trailActivatePct);
      const trailPx = pos.peak * (1 - config.trailGivebackPct);
      const protective = trailOn ? Math.max(stopPx, trailPx) : stopPx;
      const protectiveReason = trailOn && trailPx > stopPx ? "移动止盈" : "止损";
      const takeProfitPx = pos.entryFill * (1 + config.takeProfitPct);

      if (bar.open <= protective) {
        closeAt(bar.time, bar.open, protectiveReason);
      } else if (bar.low <= protective) {
        closeAt(bar.time, protective, protectiveReason);
      } else if (bar.high >= takeProfitPx) {
        closeAt(bar.time, takeProfitPx, "止盈");
      } else {
        pos.peak = Math.max(pos.peak, bar.high);
        if (pos.bars * barMinutes >= config.timeStopMinutes) {
          closeAt(bar.time, bar.close, "持有超时");
        }
      }
    }

    if (!pos && !pending && i >= lookback && i < candles.length - 1) {
      const past = candles[i - lookback].close;
      const momentum = past > 0 ? bar.close / past - 1 : 0;
      const from = Math.max(0, i - volumeLookback + 1);
      const sma = average(candles.slice(from, i + 1).map((candle) => candle.volume));
      const momentumOk =
        momentum >= config.minH1ChangePct / 100 &&
        momentum <= config.maxH1ChangePct / 100;
      const volumeOk = sma > 0 && bar.volume >= sma * input.volumeMultiple;
      const locationOk = closeLocation(bar) >= 0.55;
      if (momentumOk && volumeOk && locationOk) pending = true;
    }

    mark(bar.time, bar.close);
  }

  if (equity.length === 0) {
    equity.push({ time: Date.now(), equity: startEquity });
  }

  let peak = equity[0]?.equity ?? startEquity;
  let maxDrawdown = 0;
  for (const point of equity) {
    peak = Math.max(peak, point.equity);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - point.equity) / peak);
  }

  const wins = trades.filter((trade) => trade.pnlUsd > 0);
  const grossWin = wins.reduce((sum, trade) => sum + trade.pnlUsd, 0);
  const grossLoss = trades
    .filter((trade) => trade.pnlUsd < 0)
    .reduce((sum, trade) => sum + Math.abs(trade.pnlUsd), 0);
  const endEquity = equity[equity.length - 1]?.equity ?? startEquity;
  const shortData = candles.length < lookback + 2;

  return {
    trades,
    equity,
    summary: {
      startEquity,
      endEquity,
      returnPct: startEquity > 0 ? (endEquity / startEquity - 1) * 100 : 0,
      maxDrawdownPct: maxDrawdown * 100,
      tradeCount: trades.length,
      winRatePct: trades.length > 0 ? (wins.length / trades.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
      avgHoldBars:
        trades.length > 0
          ? trades.reduce((sum, trade) => sum + trade.barsHeld, 0) / trades.length
          : 0,
      openAtEnd: pos != null,
      note: shortData
        ? `K 线数量不够做 ${lookback} 根回看。${BACKTEST_NOTE}`
        : liquidityUsd <= 0
          ? `没有流动性，无法估算滑点，没有开仓。${BACKTEST_NOTE}`
          : pos
            ? `回测结束时仍有持仓，净值已按卖出冲击计入。${BACKTEST_NOTE}`
            : BACKTEST_NOTE,
    },
  };
}
