"use client";

import { useState } from "react";
import { EquityChart } from "@/components/equity-chart";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPct, formatPrice, formatTime, formatUsd } from "@/lib/format";
import { networkLabel } from "@/lib/networks";
import type { BookSummary, StrategyConfig } from "@/lib/types";

type RuleForm = {
  minLiquidityUsd: string;
  minPoolAgeMinutes: string;
  entryScore: string;
  exitScore: string;
  stopLossPct: string;
  takeProfitPct: string;
  maxPositionUsd: string;
  timeStopMinutes: string;
  minH1ChangePct: string;
  maxH1ChangePct: string;
};

function toForm(config: StrategyConfig): RuleForm {
  return {
    minLiquidityUsd: String(config.minLiquidityUsd),
    minPoolAgeMinutes: String(config.minPoolAgeMinutes),
    entryScore: String(config.entryScore),
    exitScore: String(config.exitScore),
    stopLossPct: String(Math.round(config.stopLossPct * 1000) / 10),
    takeProfitPct: String(Math.round(config.takeProfitPct * 1000) / 10),
    maxPositionUsd: String(config.maxPositionUsd),
    timeStopMinutes: String(config.timeStopMinutes),
    minH1ChangePct: String(config.minH1ChangePct),
    maxH1ChangePct: String(config.maxH1ChangePct),
  };
}

const fields: { key: keyof RuleForm; label: string; suffix: string }[] = [
  { key: "minLiquidityUsd", label: "最低流动性", suffix: "美元" },
  { key: "minPoolAgeMinutes", label: "最短池龄", suffix: "分钟" },
  { key: "entryScore", label: "开仓分数", suffix: "分" },
  { key: "exitScore", label: "离场分数", suffix: "分" },
  { key: "stopLossPct", label: "止损", suffix: "%" },
  { key: "takeProfitPct", label: "止盈", suffix: "%" },
  { key: "maxPositionUsd", label: "单笔上限", suffix: "美元" },
  { key: "timeStopMinutes", label: "最长持有", suffix: "分钟" },
  { key: "minH1ChangePct", label: "1 小时涨幅下限", suffix: "%" },
  { key: "maxH1ChangePct", label: "1 小时涨幅上限", suffix: "%" },
];

function RuleEditor({
  config,
  busy,
  onSave,
  onReset,
}: {
  config: StrategyConfig;
  busy: boolean;
  onSave: (config: Partial<StrategyConfig>) => Promise<void>;
  onReset: () => void;
}) {
  const [form, setForm] = useState<RuleForm>(() => toForm(config));
  const [formError, setFormError] = useState<string | null>(null);

  async function save() {
    const numbers = Object.fromEntries(
      Object.entries(form).map(([key, value]) => [key, Number(value)]),
    ) as Record<keyof RuleForm, number>;
    if (Object.values(numbers).some((value) => !Number.isFinite(value))) {
      setFormError("每一项都要是数字。");
      return;
    }
    setFormError(null);
    await onSave({
      minLiquidityUsd: numbers.minLiquidityUsd,
      minPoolAgeMinutes: numbers.minPoolAgeMinutes,
      entryScore: numbers.entryScore,
      exitScore: numbers.exitScore,
      stopLossPct: numbers.stopLossPct / 100,
      takeProfitPct: numbers.takeProfitPct / 100,
      maxPositionUsd: numbers.maxPositionUsd,
      timeStopMinutes: numbers.timeStopMinutes,
      minH1ChangePct: numbers.minH1ChangePct,
      maxH1ChangePct: numbers.maxH1ChangePct,
    });
  }

  return (
    <section className="rounded-2xl border border-border bg-card/80 p-4">
      <h2 className="text-sm font-medium">规则</h2>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">
        单笔不超过池子流动性的 {(config.maxLiquidityShare * 100).toFixed(1)}%，手续费 {config.feeBps} bps，滑点上限 {config.maxSlippageBps} bps。今日回撤 {Math.round(config.dailyLossLimitPct * 100)}% 停止开新仓。
      </p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {fields.map((field) => (
          <div key={field.key} className="space-y-1.5">
            <Label htmlFor={field.key} className="text-xs text-muted-foreground">
              {field.label}
            </Label>
            <div className="relative">
              <Input
                id={field.key}
                inputMode="decimal"
                value={form[field.key]}
                onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                className="num pr-12"
              />
              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] text-muted-foreground">
                {field.suffix}
              </span>
            </div>
          </div>
        ))}
      </div>
      {formError ? <p className="mt-3 text-xs text-down">{formError}</p> : null}
      <div className="mt-4 flex gap-2">
        <Button disabled={busy} onClick={() => void save()}>
          保存规则
        </Button>
        <Button variant="outline" disabled={busy} onClick={onReset}>
          清空账本
        </Button>
      </div>
    </section>
  );
}

export function BookView({
  book,
  busy,
  onSave,
  onReset,
  onSell,
}: {
  book: BookSummary;
  busy: boolean;
  onSave: (config: Partial<StrategyConfig>) => Promise<void>;
  onReset: () => void;
  onSell: (positionId: string) => void;
}) {
  const marks = new Map(book.marks.map((mark) => [mark.id, mark]));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-4">
        <section className="rounded-2xl border border-border bg-card/70 p-4">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">净值</h2>
              <p className="text-xs text-muted-foreground">含预估卖出成本，不是中间价浮盈。</p>
            </div>
            <div className={`num text-lg ${book.returnPct >= 0 ? "text-up" : "text-down"}`}>
              {formatPct(book.returnPct)}
            </div>
          </div>
          <EquityChart points={book.equity} />
        </section>

        <section className="rounded-2xl border border-border bg-card/70">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium">持仓</h2>
          </div>
          {book.positions.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">
              还没有持仓。打开自动并结算一轮，或在扫描里对达线的池子按规则开仓。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 font-medium">代币</th>
                    <th className="px-3 py-2 font-medium">成交价</th>
                    <th className="px-3 py-2 font-medium">现价</th>
                    <th className="px-3 py-2 font-medium">分数</th>
                    <th className="px-3 py-2 font-medium">浮动盈亏</th>
                    <th className="px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {book.positions.map((position) => {
                    const mark = marks.get(position.id);
                    const pnl = mark?.pnlPct ?? 0;
                    return (
                      <tr key={position.id} className="border-b border-border/70">
                        <td className="px-4 py-3">
                          <div className="font-medium">{position.symbol}</div>
                          <div className="text-xs text-muted-foreground">
                            {networkLabel(position.network)} · {formatTime(position.openedAt)}
                          </div>
                        </td>
                        <td className="num px-3 py-3">{formatPrice(position.entryPrice)}</td>
                        <td className="num px-3 py-3">{formatPrice(mark?.mid ?? position.lastPrice)}</td>
                        <td className="num px-3 py-3">{position.lastScore.toFixed(1)}</td>
                        <td className={`num px-3 py-3 ${pnl >= 0 ? "text-up" : "text-down"}`}>
                          {formatUsd(mark?.pnlUsd ?? 0)} · {formatPct(pnl * 100)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => onSell(position.id)}>
                            平仓
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card/70">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-medium">成交</h2>
          </div>
          {book.trades.length === 0 ? (
            <p className="px-4 py-8 text-sm text-muted-foreground">成交记录会留在这里，刷新页面也不会丢。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="px-4 py-2 font-medium">时间</th>
                    <th className="px-3 py-2 font-medium">方向</th>
                    <th className="px-3 py-2 font-medium">代币</th>
                    <th className="px-3 py-2 font-medium">金额</th>
                    <th className="px-3 py-2 font-medium">原因</th>
                    <th className="px-4 py-2 font-medium">盈亏</th>
                  </tr>
                </thead>
                <tbody>
                  {[...book.trades].reverse().slice(0, 20).map((trade) => (
                    <tr key={trade.id} className="border-b border-border/70">
                      <td className="num px-4 py-2.5 text-muted-foreground">{formatTime(trade.time)}</td>
                      <td className="px-3 py-2.5">{trade.side === "buy" ? "买入" : "卖出"}</td>
                      <td className="px-3 py-2.5">{trade.symbol}</td>
                      <td className="num px-3 py-2.5">{formatUsd(trade.usd)}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{trade.reason}</td>
                      <td className={`num px-4 py-2.5 ${trade.pnlUsd == null ? "" : trade.pnlUsd >= 0 ? "text-up" : "text-down"}`}>
                        {trade.pnlUsd == null ? "—" : formatUsd(trade.pnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <RuleEditor
          key={JSON.stringify(book.config)}
          config={book.config}
          busy={busy}
          onSave={onSave}
          onReset={onReset}
        />
        <section className="rounded-2xl border border-border bg-card/80 p-4">
          <h2 className="text-sm font-medium">日志</h2>
          <ul className="mt-3 space-y-3">
            {book.journal.length === 0 ? (
              <li className="text-sm text-muted-foreground">还没有结算记录。</li>
            ) : (
              book.journal.slice(0, 12).map((entry, index) => (
                <li key={`${entry.time}-${index}`} className="text-sm">
                  <div className="text-xs text-muted-foreground">{formatTime(entry.time)}</div>
                  <p className={entry.level === "warn" ? "text-down" : entry.level === "trade" ? "text-foreground" : "text-muted-foreground"}>
                    {entry.text}
                  </p>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}
