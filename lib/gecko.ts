import type { Candle, PoolSnapshot } from "./types";
import { isNetworkId } from "./networks";

export class MarketDataError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

const BASE = "https://api.geckoterminal.com/api/v2";
const cache = new Map<string, { at: number; data: unknown }>();

async function fetchJson(url: string): Promise<unknown> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < 15_000) return hit.data;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "PulseMemeQuant/0.1 (paper research)",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 429 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 800));
        continue;
      }
      if (!response.ok) {
        throw new MarketDataError(`行情接口返回 ${response.status}`, response.status);
      }
      const data = await response.json();
      cache.set(url, { at: Date.now(), data });
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("行情请求失败");
      if (attempt === 0 && !(error instanceof MarketDataError)) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
    }
  }
  throw lastError ?? new MarketDataError("行情请求失败");
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function positiveOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = num(value);
  return parsed > 0 ? parsed : null;
}

function splitPair(name: string): { base: string; quote: string } {
  const parts = name.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return { base: parts[0], quote: parts[parts.length - 1] };
  return { base: name || "???", quote: "" };
}

type RawPool = {
  id?: string;
  attributes?: Record<string, unknown>;
  relationships?: {
    base_token?: { data?: { id?: string } };
    quote_token?: { data?: { id?: string } };
    dex?: { data?: { id?: string } };
  };
};

function addressFromId(id: string | undefined): string {
  if (!id) return "";
  const index = id.indexOf("_");
  return index >= 0 ? id.slice(index + 1) : id;
}

export function dedupeByBase(pools: PoolSnapshot[]): PoolSnapshot[] {
  const best = new Map<string, PoolSnapshot>();
  for (const pool of pools) {
    const key = `${pool.network}:${pool.baseAddress || pool.poolAddress}`;
    const previous = best.get(key);
    if (!previous || pool.liquidityUsd > previous.liquidityUsd) best.set(key, pool);
  }
  return [...best.values()];
}

export function parsePools(payload: unknown, fallbackNetwork: string): PoolSnapshot[] {
  const json = payload as { data?: RawPool[]; included?: { id?: string; attributes?: Record<string, unknown> }[] };
  const rows = Array.isArray(json?.data) ? json.data : [];
  const included = new Map<string, { attributes?: Record<string, unknown> }>();
  if (Array.isArray(json?.included)) {
    for (const item of json.included) {
      if (item?.id) included.set(item.id, item);
    }
  }

  const pools: PoolSnapshot[] = [];
  for (const row of rows) {
    const attrs = row.attributes ?? {};
    const poolAddress = String(attrs.address ?? "");
    const priceUsd = num(attrs.base_token_price_usd);
    if (!poolAddress || !(priceUsd > 0)) continue;

    const rawId = String(row.id ?? "");
    const network = rawId.includes("_") ? rawId.slice(0, rawId.indexOf("_")) : fallbackNetwork;
    if (!isNetworkId(network) && network !== fallbackNetwork) continue;

    const name = String(attrs.name ?? "");
    const pair = splitPair(name);
    const baseId = row.relationships?.base_token?.data?.id;
    const quoteId = row.relationships?.quote_token?.data?.id;
    const base = baseId ? included.get(baseId) : undefined;
    const quote = quoteId ? included.get(quoteId) : undefined;
    const priceChange = (attrs.price_change_percentage ?? {}) as Record<string, unknown>;
    const tx = (attrs.transactions ?? {}) as Record<string, Record<string, unknown>>;
    const volume = (attrs.volume_usd ?? {}) as Record<string, unknown>;

    pools.push({
      id: rawId || `${network}_${poolAddress}`,
      network,
      poolAddress,
      name,
      symbol: String(base?.attributes?.symbol ?? pair.base),
      quoteSymbol: String(quote?.attributes?.symbol ?? pair.quote),
      baseAddress: addressFromId(baseId) || poolAddress,
      dex: String(row.relationships?.dex?.data?.id ?? ""),
      priceUsd,
      liquidityUsd: num(attrs.reserve_in_usd),
      fdvUsd: positiveOrNull(attrs.fdv_usd),
      marketCapUsd: positiveOrNull(attrs.market_cap_usd),
      poolCreatedAt: attrs.pool_created_at ? String(attrs.pool_created_at) : null,
      priceChange: {
        m5: num(priceChange.m5),
        m15: num(priceChange.m15),
        h1: num(priceChange.h1),
        h6: num(priceChange.h6),
        h24: num(priceChange.h24),
      },
      tx: {
        m5: { buys: num(tx.m5?.buys), sells: num(tx.m5?.sells) },
        h1: {
          buys: num(tx.h1?.buys),
          sells: num(tx.h1?.sells),
          buyers: num(tx.h1?.buyers),
          sellers: num(tx.h1?.sellers),
        },
        h24: { buys: num(tx.h24?.buys), sells: num(tx.h24?.sells) },
      },
      volume: {
        m5: num(volume.m5),
        h1: num(volume.h1),
        h24: num(volume.h24),
      },
    });
  }

  return dedupeByBase(pools);
}

export function parsePool(payload: unknown, fallbackNetwork: string): PoolSnapshot | null {
  const json = payload as { data?: RawPool; included?: unknown[] };
  if (!json?.data) return null;
  return parsePools({ data: [json.data], included: json.included }, fallbackNetwork)[0] ?? null;
}

async function fetchPage(network: string, page: number): Promise<PoolSnapshot[]> {
  const url = `${BASE}/networks/${network}/trending_pools?include=base_token,quote_token,dex&page=${page}`;
  const payload = await fetchJson(url);
  return parsePools(payload, network).filter((pool) => pool.network === network);
}

export async function fetchTrending(network: string): Promise<PoolSnapshot[]> {
  const first = await fetchPage(network, 1);
  let second: PoolSnapshot[] = [];
  try {
    second = await fetchPage(network, 2);
  } catch {
    second = [];
  }
  return dedupeByBase([...first, ...second]);
}

export async function fetchSearch(network: string, query: string): Promise<PoolSnapshot[]> {
  const url = `${BASE}/search/pools?query=${encodeURIComponent(query)}&network=${network}`;
  const payload = await fetchJson(url);
  return parsePools(payload, network).filter((pool) => pool.network === network);
}

export async function loadUniverse(network: string, query: string): Promise<PoolSnapshot[]> {
  const q = query.trim();
  if (q.length >= 2) return fetchSearch(network, q);
  return fetchTrending(network);
}

export async function fetchPool(network: string, address: string): Promise<PoolSnapshot | null> {
  const url = `${BASE}/networks/${network}/pools/${address}?include=base_token,quote_token,dex`;
  const payload = await fetchJson(url);
  return parsePool(payload, network);
}

export function parseCandles(payload: unknown): Candle[] {
  const json = payload as { data?: { attributes?: { ohlcv_list?: unknown[] } } };
  const list = json?.data?.attributes?.ohlcv_list;
  if (!Array.isArray(list)) return [];
  const candles: Candle[] = [];
  for (const row of list) {
    if (!Array.isArray(row) || row.length < 6) continue;
    let time = Number(row[0]);
    if (!Number.isFinite(time)) continue;
    if (time < 1e12) time *= 1000;
    const candle = {
      time,
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    };
    if (candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0) {
      candles.push(candle);
    }
  }
  candles.sort((a, b) => a.time - b.time);
  return candles;
}

export async function fetchOhlcv(
  network: string,
  address: string,
  aggregate = 5,
  limit = 288,
): Promise<Candle[]> {
  const url = `${BASE}/networks/${network}/pools/${address}/ohlcv/minute?aggregate=${aggregate}&limit=${limit}&currency=usd`;
  const payload = await fetchJson(url);
  return parseCandles(payload);
}
