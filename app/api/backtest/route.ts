import { fetchOhlcv, fetchPool, MarketDataError } from "@/lib/gecko";
import { isNetworkId, validPoolAddress } from "@/lib/networks";
import { getBook } from "@/lib/portfolio";
import { runBacktest } from "@/lib/quant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    network?: string;
    poolAddress?: string;
  } | null;
  const network = body?.network ?? "";
  const poolAddress = body?.poolAddress ?? "";
  if (!isNetworkId(network) || !validPoolAddress(poolAddress)) {
    return Response.json({ error: "请选择一个有效的池子。" }, { status: 400 });
  }

  try {
    const [pool, candles] = await Promise.all([
      fetchPool(network, poolAddress),
      fetchOhlcv(network, poolAddress, 5, 288),
    ]);
    if (!pool) return Response.json({ error: "没有找到这个池子。" }, { status: 404 });
    const book = getBook();
    const result = runBacktest({
      candles,
      liquidityUsd: pool.liquidityUsd,
      config: book.config,
      barMinutes: 5,
      lookback: 12,
      volumeLookback: 12,
      volumeMultiple: 1.7,
    });
    return Response.json({
      result,
      pool: {
        symbol: pool.symbol,
        quoteSymbol: pool.quoteSymbol,
        network: pool.network,
        poolAddress: pool.poolAddress,
        liquidityUsd: pool.liquidityUsd,
      },
      bars: candles.length,
    });
  } catch (error) {
    const message = error instanceof MarketDataError ? error.message : "回测数据拉取失败。";
    return Response.json({ error: message }, { status: 502 });
  }
}
