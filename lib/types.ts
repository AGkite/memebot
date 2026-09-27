export type PriceChange = {
  m5: number;
  m15: number;
  h1: number;
  h6: number;
  h24: number;
};

export type PoolSnapshot = {
  id: string;
  network: string;
  poolAddress: string;
  name: string;
  symbol: string;
  quoteSymbol: string;
  baseAddress: string;
  dex: string;
  priceUsd: number;
  liquidityUsd: number;
  fdvUsd: number | null;
  marketCapUsd: number | null;
  poolCreatedAt: string | null;
  priceChange: PriceChange;
  tx: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number; buyers: number; sellers: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    m5: number;
    h1: number;
    h24: number;
  };
};

export type StrategyConfig = {
  minLiquidityUsd: number;
  maxFdvToLiquidity: number;
  minPoolAgeMinutes: number;
  maxPoolAgeHours: number;
  minHourlyTx: number;
  requireMajorQuote: boolean;
  maxPositionUsd: number;
  maxPositions: number;
  maxLiquidityShare: number;
  entryScore: number;
  exitScore: number;
  stopLossPct: number;
  takeProfitPct: number;
  trailActivatePct: number;
  trailGivebackPct: number;
  timeStopMinutes: number;
  feeBps: number;
  maxSlippageBps: number;
  minH1ChangePct: number;
  maxH1ChangePct: number;
  minImbalance: number;
  dailyLossLimitPct: number;
  initialCash: number;
};

export type Gate = {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
};

export type ScoreParts = {
  flow: number;
  momentum: number;
  liquidity: number;
  turnover: number;
};

export type Signal = "enter" | "watch" | "reject";

export type Evaluation = {
  score: number;
  parts: ScoreParts;
  gates: Gate[];
  signal: Signal;
  note: string;
  imbalance: number;
  turnover: number;
  ageMinutes: number | null;
};

export type ExitCode = "stop" | "take_profit" | "trail" | "score" | "time" | "manual";

export type Position = {
  id: string;
  network: string;
  poolAddress: string;
  symbol: string;
  quoteSymbol: string;
  dex: string;
  openedAt: number;
  entryPrice: number;
  midAtEntry: number;
  qty: number;
  costUsd: number;
  liquidityUsd: number;
  slippageBps: number;
  peakPrice: number;
  lastPrice: number;
  lastScore: number;
};

export type Trade = {
  id: string;
  time: number;
  side: "buy" | "sell";
  symbol: string;
  network: string;
  poolAddress: string;
  price: number;
  qty: number;
  usd: number;
  slippageBps: number;
  reason: string;
  pnlUsd?: number;
  pnlPct?: number;
};

export type EquityPoint = {
  time: number;
  equity: number;
};

export type JournalEntry = {
  time: number;
  level: "info" | "trade" | "warn";
  text: string;
};

export type PortfolioState = {
  cash: number;
  initialCash: number;
  startedAt: number;
  dayStartEquity: number;
  dayKey: string;
  armed: boolean;
  config: StrategyConfig;
  positions: Position[];
  trades: Trade[];
  equity: EquityPoint[];
  journal: JournalEntry[];
  lastTickAt: number | null;
};

export type PositionMark = {
  id: string;
  mid: number;
  liquidation: number;
  pnlUsd: number;
  pnlPct: number;
};

export type BookSummary = PortfolioState & {
  equityNow: number;
  realized: number;
  unrealized: number;
  dayPnlPct: number;
  returnPct: number;
  marks: PositionMark[];
};

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BacktestTrade = {
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  pnlPct: number;
  pnlUsd: number;
  reason: string;
  barsHeld: number;
};

export type BacktestResult = {
  trades: BacktestTrade[];
  equity: EquityPoint[];
  summary: {
    startEquity: number;
    endEquity: number;
    returnPct: number;
    maxDrawdownPct: number;
    tradeCount: number;
    winRatePct: number;
    profitFactor: number | null;
    avgHoldBars: number;
    openAtEnd: boolean;
    note: string;
  };
};

export type ScoredPool = PoolSnapshot & {
  evaluation: Evaluation;
};
