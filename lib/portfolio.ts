import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  BookSummary,
  JournalEntry,
  PoolSnapshot,
  PortfolioState,
  Position,
  StrategyConfig,
} from "./types";
import {
  decideExit,
  defaultConfig,
  evaluatePool,
  executionCostBps,
  exitLabel,
  fillPrice,
  liquidationUsd,
  positionSizeUsd,
  sanitizeConfig,
} from "./quant";
import { fetchPool, loadUniverse } from "./gecko";

const DATA_PATH = path.join(process.cwd(), "data", "portfolio.json");

let chain: Promise<void> = Promise.resolve();

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function utcDay(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

function fresh(now = Date.now()): PortfolioState {
  return {
    cash: defaultConfig.initialCash,
    initialCash: defaultConfig.initialCash,
    startedAt: now,
    dayStartEquity: defaultConfig.initialCash,
    dayKey: utcDay(now),
    armed: false,
    config: { ...defaultConfig },
    positions: [],
    trades: [],
    equity: [{ time: now, equity: defaultConfig.initialCash }],
    journal: [
      {
        time: now,
        level: "info",
        text: "纸面账本已建立。打开自动之后，结算一轮才会按规则开仓。",
      },
    ],
    lastTickAt: null,
  };
}

function load(): PortfolioState {
  try {
    const raw = JSON.parse(readFileSync(DATA_PATH, "utf8")) as Partial<PortfolioState>;
    const base = fresh();
    return {
      ...base,
      ...raw,
      cash: Number.isFinite(raw.cash) ? Number(raw.cash) : base.cash,
      initialCash: defaultConfig.initialCash,
      armed: Boolean(raw.armed),
      config: sanitizeConfig(raw.config),
      positions: Array.isArray(raw.positions) ? raw.positions : [],
      trades: Array.isArray(raw.trades) ? raw.trades : [],
      equity: Array.isArray(raw.equity) && raw.equity.length > 0 ? raw.equity : base.equity,
      journal: Array.isArray(raw.journal) ? raw.journal : base.journal,
      dayKey: raw.dayKey || base.dayKey,
      dayStartEquity: Number.isFinite(raw.dayStartEquity) ? Number(raw.dayStartEquity) : base.dayStartEquity,
      startedAt: raw.startedAt || base.startedAt,
      lastTickAt: raw.lastTickAt ?? null,
    };
  } catch {
    return fresh();
  }
}

function save(state: PortfolioState) {
  mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  const temporary = `${DATA_PATH}.tmp`;
  writeFileSync(temporary, JSON.stringify(state));
  renameSync(temporary, DATA_PATH);
}

function pushJournal(state: PortfolioState, entry: JournalEntry) {
  state.journal.unshift(entry);
  if (state.journal.length > 40) state.journal.length = 40;
}

export function equityOf(state: PortfolioState): number {
  const marked = state.positions.reduce((sum, position) => {
    const mid = position.lastPrice > 0 ? position.lastPrice : position.midAtEntry;
    return sum + liquidationUsd(position.qty, mid, position.liquidityUsd, state.config.feeBps);
  }, 0);
  return Math.round((state.cash + marked) * 100) / 100;
}

export function summarize(state: PortfolioState): BookSummary {
  const marks = state.positions.map((position) => {
    const mid = position.lastPrice > 0 ? position.lastPrice : position.midAtEntry;
    const liquidation = liquidationUsd(
      position.qty,
      mid,
      position.liquidityUsd,
      state.config.feeBps,
    );
    const pnlUsd = liquidation - position.costUsd;
    return {
      id: position.id,
      mid,
      liquidation,
      pnlUsd,
      pnlPct: position.costUsd > 0 ? pnlUsd / position.costUsd : 0,
    };
  });
  const equityNow = Math.round((state.cash + marks.reduce((sum, mark) => sum + mark.liquidation, 0)) * 100) / 100;
  const realized = state.trades.reduce((sum, trade) => sum + (trade.pnlUsd ?? 0), 0);
  const unrealized = marks.reduce((sum, mark) => sum + mark.pnlUsd, 0);
  const dayBase = state.dayStartEquity > 0 ? state.dayStartEquity : state.initialCash;
  return {
    ...state,
    equityNow,
    realized,
    unrealized,
    dayPnlPct: ((equityNow - dayBase) / dayBase) * 100,
    returnPct: ((equityNow - state.initialCash) / state.initialCash) * 100,
    marks,
  };
}

function rollDay(state: PortfolioState, now: number) {
  const key = utcDay(now);
  if (key === state.dayKey) return;
  state.dayKey = key;
  state.dayStartEquity = equityOf(state);
}

function tryOpen(
  state: PortfolioState,
  pool: PoolSnapshot,
  score: number,
  now: number,
  journal: boolean,
): string | null {
  if (state.positions.some((position) => position.network === pool.network && position.poolAddress === pool.poolAddress)) {
    return `${pool.symbol} 已经在持仓里。`;
  }
  const size = positionSizeUsd(state.cash, pool.liquidityUsd, state.config);
  if (size <= 0) return `${pool.symbol} 算出来的仓位不足 25 美元，不开。`;
  const bps = executionCostBps(size, pool.liquidityUsd, state.config.feeBps);
  if (bps == null || bps > state.config.maxSlippageBps) {
    return `${pool.symbol} 预估滑点 ${bps == null ? "过大" : `${Math.round(bps)} bps`}，超过上限 ${state.config.maxSlippageBps} bps。`;
  }
  const fill = fillPrice(pool.priceUsd, "buy", bps);
  if (!(fill > 0)) return `${pool.symbol} 没有可用价格。`;
  const qty = size / fill;
  state.cash = Math.round((state.cash - size) * 100) / 100;
  const position: Position = {
    id: crypto.randomUUID(),
    network: pool.network,
    poolAddress: pool.poolAddress,
    symbol: pool.symbol,
    quoteSymbol: pool.quoteSymbol,
    dex: pool.dex,
    openedAt: now,
    entryPrice: fill,
    midAtEntry: pool.priceUsd,
    qty,
    costUsd: size,
    liquidityUsd: pool.liquidityUsd,
    slippageBps: bps,
    peakPrice: pool.priceUsd,
    lastPrice: pool.priceUsd,
    lastScore: score,
  };
  state.positions.push(position);
  state.trades.push({
    id: crypto.randomUUID(),
    time: now,
    side: "buy",
    symbol: pool.symbol,
    network: pool.network,
    poolAddress: pool.poolAddress,
    price: fill,
    qty,
    usd: size,
    slippageBps: bps,
    reason: "开仓",
  });
  if (state.trades.length > 200) state.trades.splice(0, state.trades.length - 200);
  const text = `开仓 ${pool.symbol}，花费 $${size.toFixed(2)}，成交价偏离中间价 ${Math.round(bps)} bps，分数 ${score.toFixed(1)}。`;
  if (journal) pushJournal(state, { time: now, level: "trade", text });
  return null;
}

function closePosition(
  state: PortfolioState,
  position: Position,
  mid: number,
  liquidityUsd: number,
  reason: string,
  now: number,
) {
  const gross = position.qty * mid;
  const quoted = executionCostBps(gross, liquidityUsd, state.config.feeBps);
  const forced = quoted == null;
  const bps = quoted ?? 5_000;
  const fill = fillPrice(mid, "sell", bps);
  const proceeds = position.qty * fill;
  const pnlUsd = proceeds - position.costUsd;
  state.cash = Math.round((state.cash + proceeds) * 100) / 100;
  state.positions = state.positions.filter((item) => item.id !== position.id);
  state.trades.push({
    id: crypto.randomUUID(),
    time: now,
    side: "sell",
    symbol: position.symbol,
    network: position.network,
    poolAddress: position.poolAddress,
    price: fill,
    qty: position.qty,
    usd: proceeds,
    slippageBps: bps,
    reason,
    pnlUsd,
    pnlPct: position.costUsd > 0 ? pnlUsd / position.costUsd : 0,
  });
  if (state.trades.length > 200) state.trades.splice(0, state.trades.length - 200);
  const forcedText = forced ? "流动性不够模型成交，按 50% 冲击强平。" : "";
  pushJournal(state, {
    time: now,
    level: "trade",
    text: `平仓 ${position.symbol}（${reason}），盈亏 $${pnlUsd.toFixed(2)}。${forcedText}`,
  });
}

function rememberEquity(state: PortfolioState, now: number) {
  state.equity.push({ time: now, equity: equityOf(state) });
  if (state.equity.length > 400) state.equity.splice(0, state.equity.length - 400);
}

async function snapshotFor(position: Position, scanned: Map<string, PoolSnapshot>) {
  const key = `${position.network}:${position.poolAddress}`;
  const found = scanned.get(key);
  if (found) return found;
  try {
    return await fetchPool(position.network, position.poolAddress);
  } catch {
    return null;
  }
}

export function getBook(): BookSummary {
  return summarize(load());
}

export function setArmed(armed: boolean): Promise<BookSummary> {
  return exclusive(async () => {
    const state = load();
    state.armed = armed;
    pushJournal(state, {
      time: Date.now(),
      level: "info",
      text: armed
        ? "自动开仓已打开。下一轮结算会从当前链的扫描结果里最多买 1 只。"
        : "自动开仓已关闭。之后只更新价格并检查出场。",
    });
    save(state);
    return summarize(state);
  });
}

export function updateConfig(input: Partial<StrategyConfig>): Promise<BookSummary> {
  return exclusive(async () => {
    const state = load();
    state.config = sanitizeConfig({ ...state.config, ...input });
    pushJournal(state, { time: Date.now(), level: "info", text: "规则已更新，下一轮扫描和结算会用新门槛。" });
    save(state);
    return summarize(state);
  });
}

export function resetBook(): Promise<BookSummary> {
  return exclusive(async () => {
    const previous = load();
    const state = fresh();
    state.config = previous.config;
    state.journal = [
      {
        time: state.startedAt,
        level: "info",
        text: "纸面账本已清空，规则保留。",
      },
    ];
    save(state);
    return summarize(state);
  });
}

export async function runTick(network: string): Promise<BookSummary> {
  return exclusive(async () => {
    const state = load();
    const now = Date.now();
    rollDay(state, now);
    let pools: PoolSnapshot[] = [];
    try {
      pools = await loadUniverse(network, "");
    } catch (error) {
      pushJournal(state, {
        time: now,
        level: "warn",
        text: `行情拉取失败：${error instanceof Error ? error.message : "未知错误"}`,
      });
    }
    const scanned = new Map(pools.map((pool) => [`${pool.network}:${pool.poolAddress}`, pool]));

    for (const position of [...state.positions]) {
      const snap = await snapshotFor(position, scanned);
      if (!snap || !(snap.priceUsd > 0)) {
        pushJournal(state, { time: now, level: "warn", text: `${position.symbol} 这轮没有价格，跳过出场检查。` });
        continue;
      }
      position.lastPrice = snap.priceUsd;
      position.liquidityUsd = snap.liquidityUsd;
      const evaluation = evaluatePool(snap, state.config, now);
      position.lastScore = evaluation.score;
      position.peakPrice = Math.max(position.peakPrice, snap.priceUsd);
      const exit = decideExit(position, snap.priceUsd, evaluation.score, now, state.config);
      if (exit) closePosition(state, position, snap.priceUsd, snap.liquidityUsd, exitLabel(exit), now);
    }

    const equityNow = equityOf(state);
    const dayPnl = state.dayStartEquity > 0 ? (equityNow - state.dayStartEquity) / state.dayStartEquity : 0;

    if (!state.armed) {
      pushJournal(state, { time: now, level: "info", text: "自动未开启，这轮只更新持仓和出场条件。" });
    } else if (dayPnl <= -state.config.dailyLossLimitPct) {
      pushJournal(state, {
        time: now,
        level: "warn",
        text: `今日回撤 ${(dayPnl * 100).toFixed(1)}%，达到 ${Math.round(state.config.dailyLossLimitPct * 100)}% 上限，停止新开仓。`,
      });
    } else if (state.positions.length >= state.config.maxPositions) {
      pushJournal(state, { time: now, level: "info", text: "持仓已满，这轮不加仓。" });
    } else if (pools.length === 0) {
      pushJournal(state, { time: now, level: "warn", text: "没有扫描结果，无法开新仓。" });
    } else {
      const ranked = pools
        .map((pool) => ({ pool, evaluation: evaluatePool(pool, state.config, now) }))
        .filter((item) => item.evaluation.signal === "enter")
        .filter(
          (item) =>
            !state.positions.some(
              (position) =>
                position.network === item.pool.network && position.poolAddress === item.pool.poolAddress,
            ),
        )
        .sort((a, b) => b.evaluation.score - a.evaluation.score);

      if (ranked.length === 0) {
        pushJournal(state, { time: now, level: "info", text: "这轮没有同时通过硬过滤和开仓分数的池子。" });
      } else {
        const top = ranked[0];
        const rejection = tryOpen(state, top.pool, top.evaluation.score, now, true);
        if (rejection) pushJournal(state, { time: now, level: "warn", text: rejection });
        else if (ranked.length > 1) {
          pushJournal(state, {
            time: now,
            level: "info",
            text: `另外 ${ranked.length - 1} 只也达线，这轮只开分数最高的一只。`,
          });
        }
      }
    }

    state.lastTickAt = now;
    rememberEquity(state, now);
    save(state);
    return summarize(state);
  });
}

export async function manualBuy(network: string, poolAddress: string): Promise<BookSummary> {
  return exclusive(async () => {
    const state = load();
    const now = Date.now();
    const pool = await fetchPool(network, poolAddress);
    if (!pool) {
      pushJournal(state, { time: now, level: "warn", text: "没有找到这个池子。" });
      save(state);
      return summarize(state);
    }
    const evaluation = evaluatePool(pool, state.config, now);
    if (evaluation.signal !== "enter") {
      pushJournal(state, { time: now, level: "warn", text: `${pool.symbol} 没有开仓：${evaluation.note}` });
      save(state);
      return summarize(state);
    }
    if (state.positions.length >= state.config.maxPositions) {
      pushJournal(state, { time: now, level: "warn", text: "持仓已满。" });
      save(state);
      return summarize(state);
    }
    const rejection = tryOpen(state, pool, evaluation.score, now, true);
    if (rejection) pushJournal(state, { time: now, level: "warn", text: rejection });
    rememberEquity(state, now);
    save(state);
    return summarize(state);
  });
}

export async function manualSell(positionId: string): Promise<BookSummary> {
  return exclusive(async () => {
    const state = load();
    const now = Date.now();
    const position = state.positions.find((item) => item.id === positionId);
    if (!position) {
      pushJournal(state, { time: now, level: "warn", text: "持仓不存在。" });
      save(state);
      return summarize(state);
    }
    let mid = position.lastPrice > 0 ? position.lastPrice : position.midAtEntry;
    let liquidity = position.liquidityUsd;
    try {
      const pool = await fetchPool(position.network, position.poolAddress);
      if (pool && pool.priceUsd > 0) {
        mid = pool.priceUsd;
        liquidity = pool.liquidityUsd;
      }
    } catch {
      pushJournal(state, { time: now, level: "warn", text: `${position.symbol} 最新价格拉取失败，按上次价格平仓。` });
    }
    closePosition(state, position, mid, liquidity, exitLabel("manual"), now);
    rememberEquity(state, now);
    save(state);
    return summarize(state);
  });
}
