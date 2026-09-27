"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAge, formatPct, formatPrice, formatUsd } from "@/lib/format";
import { networkLabel } from "@/lib/networks";
import type { ScoredPool, Signal } from "@/lib/types";

const signalLabel: Record<Signal, string> = {
  enter: "可开仓",
  watch: "观察",
  reject: "过滤",
};

function tone(value: number) {
  if (value > 0) return "text-up";
  if (value < 0) return "text-down";
  return "text-muted-foreground";
}

function PartBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="num">{value.toFixed(0)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export function ScannerView({
  pools,
  selectedId,
  onSelect,
  onBuy,
  buying,
  entryScore,
}: {
  pools: ScoredPool[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBuy: (pool: ScoredPool) => void;
  buying: boolean;
  entryScore: number;
}) {
  const [filter, setFilter] = useState<"all" | Signal>("all");
  const visible = pools.filter((pool) => filter === "all" || pool.evaluation.signal === filter);
  const selected = pools.find((pool) => pool.id === selectedId) ?? visible[0] ?? null;
  const ready = pools.filter((pool) => pool.evaluation.signal === "enter").length;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0 rounded-2xl border border-border bg-card/70">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-sm font-medium">趋势池</h2>
            <p className="text-xs text-muted-foreground">
              {pools.length} 个池子，{ready} 个达到 {entryScore} 分开仓线
            </p>
          </div>
          <div className="flex gap-1">
            {(
              [
                ["all", "全部"],
                ["enter", "可开仓"],
                ["watch", "观察"],
                ["reject", "过滤"],
              ] as const
            ).map(([id, label]) => (
              <Button
                key={id}
                size="sm"
                variant={filter === id ? "default" : "ghost"}
                onClick={() => setFilter(id)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b border-border">
                <th className="px-4 py-2 font-medium">代币</th>
                <th className="px-3 py-2 font-medium">价格</th>
                <th className="px-3 py-2 font-medium">1 小时</th>
                <th className="px-3 py-2 font-medium">流动性</th>
                <th className="px-3 py-2 font-medium">换手</th>
                <th className="px-3 py-2 font-medium">买卖差</th>
                <th className="px-3 py-2 font-medium">分数</th>
                <th className="px-4 py-2 font-medium">状态</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    这个筛选下没有池子。换一条链，或把搜索清空后再拉一次趋势榜。
                  </td>
                </tr>
              ) : (
                visible.map((pool) => {
                  const active = pool.id === selected?.id;
                  return (
                    <tr
                      key={pool.id}
                      onClick={() => onSelect(pool.id)}
                      aria-selected={active}
                      className={`cursor-pointer border-b border-border/70 ${active ? "bg-primary/10" : "hover:bg-muted/50"}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{pool.symbol}</div>
                        <div className="text-xs text-muted-foreground">
                          {networkLabel(pool.network)} · {pool.quoteSymbol || "未知报价"}
                        </div>
                      </td>
                      <td className="num px-3 py-3">{formatPrice(pool.priceUsd)}</td>
                      <td className={`num px-3 py-3 ${tone(pool.priceChange.h1)}`}>
                        {formatPct(pool.priceChange.h1)}
                      </td>
                      <td className="num px-3 py-3">{formatUsd(pool.liquidityUsd, 0)}</td>
                      <td className="num px-3 py-3">{pool.evaluation.turnover.toFixed(2)}x</td>
                      <td className={`num px-3 py-3 ${tone(pool.evaluation.imbalance)}`}>
                        {pool.evaluation.imbalance >= 0 ? "+" : ""}
                        {pool.evaluation.imbalance.toFixed(2)}
                      </td>
                      <td className="num px-3 py-3 font-medium">{pool.evaluation.score.toFixed(1)}</td>
                      <td className="px-4 py-3">
                        <Badge
                          variant={
                            pool.evaluation.signal === "enter"
                              ? "default"
                              : pool.evaluation.signal === "watch"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {signalLabel[pool.evaluation.signal]}
                        </Badge>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="rounded-2xl border border-border bg-card/80 p-4 lg:sticky lg:top-24 lg:self-start">
        {selected ? (
          <div className="space-y-4">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-medium tracking-tight">{selected.symbol}</h2>
                  <p className="text-sm text-muted-foreground">
                    {selected.name || `${selected.symbol} / ${selected.quoteSymbol}`} · {selected.dex || "DEX"}
                  </p>
                </div>
                <div className="num text-right text-2xl">{selected.evaluation.score.toFixed(1)}</div>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{selected.evaluation.note}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">中间价</div>
                <div className="num">{formatPrice(selected.priceUsd)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">池龄</div>
                <div>{formatAge(selected.evaluation.ageMinutes)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">5 分钟</div>
                <div className={`num ${tone(selected.priceChange.m5)}`}>{formatPct(selected.priceChange.m5)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">24 小时</div>
                <div className={`num ${tone(selected.priceChange.h24)}`}>{formatPct(selected.priceChange.h24)}</div>
              </div>
            </div>
            <div className="space-y-2">
              <PartBar label="买卖差" value={selected.evaluation.parts.flow} />
              <PartBar label="动量" value={selected.evaluation.parts.momentum} />
              <PartBar label="流动性" value={selected.evaluation.parts.liquidity} />
              <PartBar label="换手" value={selected.evaluation.parts.turnover} />
            </div>
            <ul className="space-y-1.5 text-xs">
              {selected.evaluation.gates.map((gate) => (
                <li key={gate.id} className="flex gap-2">
                  <span className={gate.pass ? "text-up" : "text-down"}>{gate.pass ? "通过" : "未过"}</span>
                  <span className="text-muted-foreground">
                    {gate.label}：{gate.detail}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button disabled={buying || selected.evaluation.signal !== "enter"} onClick={() => onBuy(selected)}>
                {buying ? "正在试开…" : "按规则开仓"}
              </Button>
              <Button
                variant="outline"
                render={
                  <a
                    href={`https://www.geckoterminal.com/${selected.network}/pools/${selected.poolAddress}`}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                查看池子
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">拉到池子之后，这里会拆开分数和每一条门槛。</p>
        )}
      </aside>
    </div>
  );
}
