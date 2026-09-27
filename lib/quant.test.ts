import assert from "node:assert/strict";
import test from "node:test";
import type { Candle, PoolSnapshot, StrategyConfig } from "./types";
import {
  decideExit,
  defaultConfig,
  evaluatePool,
  executionCostBps,
  fillPrice,
  positionSizeUsd,
  runBacktest,
  sanitizeConfig,
} from "./quant.ts";

function pool(overrides: Partial<PoolSnapshot> = {}): PoolSnapshot {
  const nowIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  return {
    id: "solana_pool",
    network: "solana",
    poolAddress: "pool",
    name: "TEST / SOL",
    symbol: "TEST",
    quoteSymbol: "SOL",
    baseAddress: "base",
    dex: "pumpswap",
    priceUsd: 0.01,
    liquidityUsd: 180_000,
    fdvUsd: 2_000_000,
    marketCapUsd: 2_000_000,
    poolCreatedAt: nowIso,
    priceChange: { m5: 1.2, m15: 4, h1: 18, h6: 30, h24: 40 },
    tx: {
      m5: { buys: 20, sells: 10 },
      h1: { buys: 200, sells: 120, buyers: 140, sellers: 90 },
      h24: { buys: 1000, sells: 800 },
    },
    volume: { m5: 5_000, h1: 90_000, h24: 800_000 },
    ...overrides,
  };
}

function config(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return { ...defaultConfig, ...overrides };
}

test("execution cost matches constant-product impact plus fee", () => {
  const bps = executionCostBps(500, 100_000, 30);
  assert.equal(bps, 130);
  assert.equal(executionCostBps(40_000, 100_000, 30), null);
});

test("buy fill is worse than the mid and sell fill is worse the other way", () => {
  assert.ok(fillPrice(1, "buy", 100) > 1);
  assert.ok(fillPrice(1, "sell", 100) < 1);
});

test("position size respects cash, cap, and pool depth", () => {
  assert.equal(positionSizeUsd(10_000, 100_000, config()), 400);
  assert.equal(positionSizeUsd(10_000, 10_000, config()), 150);
  assert.equal(positionSizeUsd(10_000, 1_000, config()), 0);
});

test("a liquid pool with confirmed flow can be entered", () => {
  const evaluation = evaluatePool(pool(), config());
  assert.equal(evaluation.signal, "enter");
  assert.ok(evaluation.score >= 68);
});

test("thin liquidity and a non-major quote are rejected", () => {
  const thin = evaluatePool(pool({ liquidityUsd: 5_000, volume: { m5: 100, h1: 1_000, h24: 4_000 } }), config());
  assert.equal(thin.signal, "reject");
  assert.equal(thin.gates.find((gate) => gate.id === "liquidity")?.pass, false);

  const stockQuote = evaluatePool(pool({ quoteSymbol: "SPYx", name: "CAT / SPYx" }), config());
  assert.equal(stockQuote.signal, "reject");
});

test("stops, targets, and time stops fire in that spirit", () => {
  const now = Date.now();
  const pos = { entryPrice: 1, peakPrice: 1.3, openedAt: now - 60 * 60_000 };
  assert.equal(decideExit(pos, 0.8, 80, now, config()), "stop");
  assert.equal(decideExit(pos, 1.6, 80, now, config()), "take_profit");
  assert.equal(decideExit(pos, 1.1, 80, now, config()), "trail");
  assert.equal(
    decideExit({ entryPrice: 1, peakPrice: 1.05, openedAt: now - 11 * 60_000 }, 1.02, 10, now, config()),
    "score",
  );
  assert.equal(
    decideExit(
      { entryPrice: 1, peakPrice: 1.02, openedAt: now - 5 * 60 * 60_000 },
      1.01,
      90,
      now,
      config(),
    ),
    "time",
  );
});

test("sanitize keeps exit score below the entry score", () => {
  const next = sanitizeConfig({ entryScore: 50, exitScore: 80, stopLossPct: -1 });
  assert.ok(next.exitScore < next.entryScore);
  assert.equal(next.stopLossPct, 0.02);
});

function candle(index: number, close: number, volume: number, overrides: Partial<Candle> = {}): Candle {
  const open = overrides.open ?? close * 0.99;
  const high = overrides.high ?? Math.max(open, close);
  const low = overrides.low ?? Math.min(open, close) * 0.995;
  return {
    time: 1_700_000_000_000 + index * 5 * 60_000,
    open,
    high,
    low,
    close,
    volume,
    ...overrides,
  };
}

test("backtest fills on the next bar open, not the signal close", () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 13; i++) {
    const close = 1 + i * 0.01;
    candles.push(candle(i, close, i === 12 ? 500 : 100));
  }
  candles.push(candle(13, 1.2, 100, { open: 2, high: 2.05, low: 1.95, close: 2 }));
  candles.push(candle(14, 2, 100, { open: 2, high: 2.02, low: 1, close: 1.2 }));

  const result = runBacktest({
    candles,
    liquidityUsd: 200_000,
    config: config(),
    barMinutes: 5,
    lookback: 12,
    volumeLookback: 12,
    volumeMultiple: 1.7,
  });

  assert.equal(result.trades.length, 1);
  const trade = result.trades[0];
  assert.ok(Math.abs(trade.entryPrice - 2 * 1.007) < 0.01);
  assert.equal(trade.reason, "止损");
  assert.ok(trade.pnlUsd < 0);
});

test("backtest can take profit after a confirmed push", () => {
  const candles: Candle[] = [];
  for (let i = 0; i < 16; i++) {
    const close = 1 + i * 0.012;
    const volume = i === 12 ? 400 : 100;
    candles.push(candle(i, close, volume));
  }
  const entryOpen = candles[13].open;
  candles.push(
    candle(16, entryOpen * 1.8, 100, {
      open: entryOpen * 1.7,
      high: entryOpen * 1.9,
      low: entryOpen * 1.65,
      close: entryOpen * 1.8,
    }),
  );

  const result = runBacktest({
    candles,
    liquidityUsd: 200_000,
    config: config({ timeStopMinutes: 10_000 }),
    barMinutes: 5,
    lookback: 12,
    volumeLookback: 12,
    volumeMultiple: 1.7,
  });

  assert.ok(result.trades.some((trade) => trade.reason === "止盈" && trade.pnlUsd > 0));
});
