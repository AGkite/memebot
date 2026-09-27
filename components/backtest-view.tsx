"use client";

import { EquityChart } from "@/components/equity-chart";
import { Button } from "@/components/ui/button";
import { formatPct, formatPrice, formatTime, formatUsd } from "@/lib/format";
import { networkLabel } from "@/lib/networks";
import type { BacktestResult, ScoredPool } from "@/lib/types";

export function BacktestView({
  pools,
  selected,
  result,
  bars,
  busy,
  error,
  onRun,
}: {
  pools: ScoredPool[];
  selected: ScoredPool | null;
  result: BacktestResult | null;
  bars: number | null;
  busy: boolean;
  error: string | null;
  onRun: () => void;
}) {
  const summary = result?.summary;

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-border bg-card/70 p-4">
        <div>
          <h2 className="text-sm font-medium">用当前选中的池子回测</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {selected
              ? `${selected.symbol} / ${selected.quoteSymbol || "?"} · ${networkLabel(selected.network)} · 流动性 ${formatUsd(selected.liquidityUsd, 0)}`
              : "先在扫描里点一只池子。"}
            回测读取约一天的 5 分钟 K 线，出场规则跟纸面账本相同，进场只用动量和成交量。
          </p>
        </div>
        <Button disabled={!selected || busy} onClick={onRun}>
          {busy ? "正在回测…" : "跑这段 K 线"}
        </Button>
      </section>

      {error ? (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-down">{error}</p>
      ) : null}

      {!result || !summary ? (
        <section className="rounded-2xl border border-dashed border-border px-4 py-12 text-sm text-muted-foreground">
          {pools.length === 0
            ? "扫描结果还没到，回测需要一个真实池子地址。"
            : `可选池子 ${pools.length} 个。选中一只之后再跑，避免拿着空数据假装有曲线。`}
        </section>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["收益", formatPct(summary.returnPct), summary.returnPct >= 0],
              ["最大回撤", formatPct(-summary.maxDrawdownPct).replace("+", ""), false],
              ["胜率", summary.tradeCount ? `${summary.winRatePct.toFixed(0)}%` : "—", true],
              ["盈亏比", summary.profitFactor == null ? "无亏损交易" : summary.profitFactor.toFixed(2), true],
            ].map(([label, value, positive]) => (
              <div key={String(label)} className="rounded-2xl border border-border bg-card/70 px-4 py-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className={`num mt-1 text-2xl ${label === "收益" ? (positive ? "text-up" : "text-down") : ""} ${label === "最大回撤" ? "text-down" : ""}`}>
                  {value}
                </div>
              </div>
            ))}
          </section>
          <section className="rounded-2xl border border-border bg-card/70 p-4">
            <div className="mb-2 flex justify-between text-xs text-muted-foreground">
              <span>{bars ?? "—"} 根 5 分钟 K 线 · {summary.tradeCount} 笔 · 平均持有 {summary.avgHoldBars.toFixed(1)} 根</span>
              <span className="num">
                {formatUsd(summary.startEquity, 0)} → {formatUsd(summary.endEquity)}
              </span>
            </div>
            <EquityChart points={result.equity} />
            <p className="mt-3 text-xs leading-5 text-muted-foreground">{summary.note}</p>
          </section>
          <section className="overflow-x-auto rounded-2xl border border-border bg-card/70">
            {result.trades.length === 0 ? (
              <p className="px-4 py-8 text-sm text-muted-foreground">这段 K 线里没有同时满足动量和放量的开仓。</p>
            ) : (
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 font-medium">进场</th>
                    <th className="px-3 py-2 font-medium">出场</th>
                    <th className="px-3 py-2 font-medium">买价</th>
                    <th className="px-3 py-2 font-medium">卖价</th>
                    <th className="px-3 py-2 font-medium">原因</th>
                    <th className="px-4 py-2 font-medium">盈亏</th>
                  </tr>
                </thead>
                <tbody>
                  {result.trades.map((trade) => (
                    <tr key={`${trade.entryTime}-${trade.exitTime}`} className="border-b border-border/70">
                      <td className="num px-4 py-2.5">{formatTime(trade.entryTime)}</td>
                      <td className="num px-3 py-2.5">{formatTime(trade.exitTime)}</td>
                      <td className="num px-3 py-2.5">{formatPrice(trade.entryPrice)}</td>
                      <td className="num px-3 py-2.5">{formatPrice(trade.exitPrice)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{trade.reason}</td>
                      <td className={`num px-4 py-2.5 ${trade.pnlUsd >= 0 ? "text-up" : "text-down"}`}>
                        {formatUsd(trade.pnlUsd)} · {formatPct(trade.pnlPct * 100)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
