"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { BacktestView } from "@/components/backtest-view";
import { BookView } from "@/components/book-view";
import { MethodView } from "@/components/method-view";
import { ScannerView } from "@/components/scanner-view";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatPct, formatTime, formatUsd } from "@/lib/format";
import { NETWORKS } from "@/lib/networks";
import type { BacktestResult, BookSummary, JournalEntry, ScoredPool, StrategyConfig } from "@/lib/types";

type ScanResponse = {
  pools: ScoredPool[];
  fetchedAt: number;
};

type BacktestResponse = {
  result: BacktestResult;
  bars: number;
};

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `请求失败（${response.status}）`);
  return payload;
}

export function Desk() {
  const [network, setNetwork] = useState("solana");
  const [query, setQuery] = useState("");
  const [pools, setPools] = useState<ScoredPool[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNonce, setScanNonce] = useState(0);
  const [book, setBook] = useState<BookSummary | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const [flash, setFlash] = useState<JournalEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [buying, setBuying] = useState(false);
  const [auto, setAuto] = useState(false);
  const [backtest, setBacktest] = useState<BacktestResult | null>(null);
  const [bars, setBars] = useState<number | null>(null);
  const [backtestError, setBacktestError] = useState<string | null>(null);
  const [backtesting, setBacktesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await readJson<BookSummary>(await fetch("/api/book"));
        if (!cancelled) setBook(next);
      } catch (error) {
        if (!cancelled) setBookError(error instanceof Error ? error.message : "账本读取失败");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      void (async () => {
        setScanning(true);
        setScanError(null);
        try {
          const data = await readJson<ScanResponse>(
            await fetch(`/api/scan?network=${network}&q=${encodeURIComponent(query)}`),
          );
          if (cancelled) return;
          setPools(data.pools);
          setFetchedAt(data.fetchedAt);
          setSelectedId((current) =>
            current && data.pools.some((pool) => pool.id === current) ? current : (data.pools[0]?.id ?? null),
          );
        } catch (error) {
          if (!cancelled) setScanError(error instanceof Error ? error.message : "扫描失败");
        } finally {
          if (!cancelled) setScanning(false);
        }
      })();
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [network, query, scanNonce]);

  const mutate = useCallback(async (body: unknown) => {
    setBusy(true);
    setBookError(null);
    try {
      const next = await readJson<BookSummary>(
        await fetch("/api/book", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      setBook(next);
      setFlash(next.journal[0] ?? null);
      return next;
    } catch (error) {
      setBookError(error instanceof Error ? error.message : "操作失败");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!auto) return;
    const timer = setInterval(() => {
      void mutate({ op: "tick", network });
    }, 60_000);
    return () => clearInterval(timer);
  }, [auto, network, mutate]);

  const selected = pools.find((pool) => pool.id === selectedId) ?? null;
  const entryScore = book?.config.entryScore ?? 68;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[1440px] flex-col px-4 pb-16">
      <div className="border-b border-primary/30 py-2 text-xs text-muted-foreground">
        纸面研究，不是投资建议。不连接钱包，不下真实单。模因币可以在几分钟内归零，公开行情也看不出合约能不能卖出。
      </div>

      <header className="sticky top-0 z-20 -mx-4 border-b border-border/80 bg-background/80 px-4 py-4 backdrop-blur-md">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-block size-2.5 rounded-sm bg-primary" />
              <p className="text-xs tracking-[0.22em] text-primary uppercase">Pulse</p>
            </div>
            <h1 className="mt-1 text-3xl font-medium tracking-tight">脉冲</h1>
            <p className="text-sm text-muted-foreground">模因币扫描、打分、回测和纸面成交。</p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={book?.armed ?? false}
                disabled={!book || busy}
                onCheckedChange={(checked) => void mutate({ op: "arm", armed: checked })}
              />
              自动开仓
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={auto} onCheckedChange={setAuto} />
              每 60 秒结算
            </label>
            <Button disabled={busy} onClick={() => void mutate({ op: "tick", network })}>
              {busy ? "结算中…" : "结算一轮"}
            </Button>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[
            ["净值", book ? formatUsd(book.equityNow) : "—", book ? Math.sign(book.returnPct) : 0],
            ["现金", book ? formatUsd(book.cash) : "—", 0],
            ["已实现", book ? formatUsd(book.realized) : "—", book ? Math.sign(book.realized) : 0],
            ["未实现", book ? formatUsd(book.unrealized) : "—", book ? Math.sign(book.unrealized) : 0],
            ["今日", book ? formatPct(book.dayPnlPct) : "—", book ? Math.sign(book.dayPnlPct) : 0],
          ].map(([label, value, direction]) => (
            <div key={String(label)}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className={`num text-lg ${direction === 1 ? "text-up" : direction === -1 ? "text-down" : ""}`}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      {bookError ? (
        <p className="mt-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-down">
          {bookError}
        </p>
      ) : null}
      {flash ? (
        <p
          className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
            flash.level === "warn"
              ? "border-destructive/40 bg-destructive/10 text-down"
              : "border-border bg-card/70 text-foreground"
          }`}
        >
          {flash.text}
        </p>
      ) : null}

      <Tabs defaultValue="scan" className="mt-5 gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="scan">扫描</TabsTrigger>
            <TabsTrigger value="book">组合</TabsTrigger>
            <TabsTrigger value="backtest">回测</TabsTrigger>
            <TabsTrigger value="method">方法</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="链"
              value={network}
              onChange={(event) => setNetwork(event.target.value)}
              className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
            >
              {NETWORKS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索代币或池子"
              className="w-44"
              aria-label="搜索"
            />
            <Button variant="outline" size="icon" disabled={scanning} onClick={() => setScanNonce((value) => value + 1)} aria-label="刷新扫描">
              <RefreshCw className={scanning ? "animate-spin" : ""} />
            </Button>
            <span className="text-xs text-muted-foreground">
              {scanning ? "正在拉池子…" : fetchedAt ? `更新于 ${formatTime(fetchedAt)}` : ""}
            </span>
          </div>
        </div>

        {scanError ? (
          <p className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-down">
            {scanError} 过十几秒再刷新，公开接口会限流。
          </p>
        ) : null}

        <TabsContent value="scan">
          {scanning && pools.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border px-4 py-16 text-sm text-muted-foreground">
              正在读取 {NETWORKS.find((item) => item.id === network)?.label} 趋势池，并按当前规则打分。
            </div>
          ) : (
            <ScannerView
              pools={pools}
              selectedId={selectedId}
              onSelect={setSelectedId}
              entryScore={entryScore}
              buying={buying}
              onBuy={(pool) => {
                setBuying(true);
                void mutate({ op: "buy", network: pool.network, poolAddress: pool.poolAddress }).finally(() =>
                  setBuying(false),
                );
              }}
            />
          )}
        </TabsContent>
        <TabsContent value="book">
          {book ? (
            <BookView
              book={book}
              busy={busy}
              onSell={(positionId) => void mutate({ op: "sell", positionId })}
              onReset={() => {
                if (window.confirm("清空纸面账本？规则会保留，持仓和成交会删掉。")) {
                  void mutate({ op: "reset" });
                }
              }}
              onSave={async (config: Partial<StrategyConfig>) => {
                const next = await mutate({ op: "config", config });
                if (next) setScanNonce((value) => value + 1);
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">正在读取纸面账本…</p>
          )}
        </TabsContent>
        <TabsContent value="backtest">
          <BacktestView
            pools={pools}
            selected={selected}
            result={backtest}
            bars={bars}
            busy={backtesting}
            error={backtestError}
            onRun={() => {
              if (!selected) return;
              setBacktesting(true);
              setBacktestError(null);
              void (async () => {
                try {
                  const data = await readJson<BacktestResponse>(
                    await fetch("/api/backtest", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ network: selected.network, poolAddress: selected.poolAddress }),
                    }),
                  );
                  setBacktest(data.result);
                  setBars(data.bars);
                } catch (error) {
                  setBacktestError(error instanceof Error ? error.message : "回测失败");
                } finally {
                  setBacktesting(false);
                }
              })();
            }}
          />
        </TabsContent>
        <TabsContent value="method">
          <MethodView />
        </TabsContent>
      </Tabs>
    </div>
  );
}
