import { MarketDataError } from "@/lib/gecko";
import { isNetworkId, validPoolAddress } from "@/lib/networks";
import {
  getBook,
  manualBuy,
  manualSell,
  resetBook,
  runTick,
  setArmed,
  updateConfig,
} from "@/lib/portfolio";
import type { StrategyConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getBook());
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | {
        op?: string;
        network?: string;
        armed?: boolean;
        config?: Partial<StrategyConfig>;
        poolAddress?: string;
        positionId?: string;
      }
    | null;

  if (!body?.op) {
    return Response.json({ error: "缺少操作。" }, { status: 400 });
  }

  try {
    if (body.op === "arm") {
      return Response.json(await setArmed(Boolean(body.armed)));
    }
    if (body.op === "config") {
      return Response.json(await updateConfig(body.config ?? {}));
    }
    if (body.op === "reset") {
      return Response.json(await resetBook());
    }
    if (body.op === "tick") {
      if (!body.network || !isNetworkId(body.network)) {
        return Response.json({ error: "不支持这条链。" }, { status: 400 });
      }
      return Response.json(await runTick(body.network));
    }
    if (body.op === "buy") {
      if (!body.network || !isNetworkId(body.network) || !body.poolAddress || !validPoolAddress(body.poolAddress)) {
        return Response.json({ error: "池子地址不合法。" }, { status: 400 });
      }
      return Response.json(await manualBuy(body.network, body.poolAddress));
    }
    if (body.op === "sell") {
      if (!body.positionId) return Response.json({ error: "缺少持仓。" }, { status: 400 });
      return Response.json(await manualSell(body.positionId));
    }
    return Response.json({ error: "不认识这个操作。" }, { status: 400 });
  } catch (error) {
    const message = error instanceof MarketDataError ? error.message : error instanceof Error ? error.message : "账本操作失败。";
    return Response.json({ error: message }, { status: 502 });
  }
}
