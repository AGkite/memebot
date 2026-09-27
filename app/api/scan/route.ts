import { MarketDataError, loadUniverse } from "@/lib/gecko";
import { isNetworkId } from "@/lib/networks";
import { getBook } from "@/lib/portfolio";
import { evaluatePool } from "@/lib/quant";
import type { ScoredPool } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const network = url.searchParams.get("network") ?? "solana";
  const query = (url.searchParams.get("q") ?? "").slice(0, 40);
  if (!isNetworkId(network)) {
    return Response.json({ error: "不支持这条链。" }, { status: 400 });
  }

  try {
    const book = getBook();
    const pools = await loadUniverse(network, query);
    const scored: ScoredPool[] = pools
      .map((pool) => ({
        ...pool,
        evaluation: evaluatePool(pool, book.config),
      }))
      .sort((a, b) => b.evaluation.score - a.evaluation.score);
    return Response.json({
      network,
      query,
      fetchedAt: Date.now(),
      entryScore: book.config.entryScore,
      pools: scored,
    });
  } catch (error) {
    const message = error instanceof MarketDataError ? error.message : "行情暂时拉不下来。";
    return Response.json({ error: message }, { status: 502 });
  }
}
