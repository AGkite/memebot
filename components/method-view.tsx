import { defaultConfig } from "@/lib/quant";

const stop = Math.round(defaultConfig.stopLossPct * 100);
const target = Math.round(defaultConfig.takeProfitPct * 100);
const trailOn = Math.round(defaultConfig.trailActivatePct * 100);
const trailBack = Math.round(defaultConfig.trailGivebackPct * 100);
const dayLimit = Math.round(defaultConfig.dailyLossLimitPct * 100);
const share = (defaultConfig.maxLiquidityShare * 100).toFixed(1);

export function MethodView() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-2xl border border-border bg-card/80 p-5">
        <p className="text-xs tracking-[0.16em] text-primary uppercase">01 边界</p>
        <h2 className="mt-2 text-xl font-medium">先做研究台，不接钱包</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          模因币量化如果一上来就签交易，亏的是真钱，而且分不清是信号错了还是成交模型错了。脉冲只做四件事：拉公开池子、硬过滤、打分、在纸面上按滑点成交。没有私钥，没有路由，没有抢开盘。
        </p>
      </article>
      <article className="rounded-2xl border border-border bg-card/80 p-5">
        <p className="text-xs tracking-[0.16em] text-primary uppercase">02 数据</p>
        <h2 className="mt-2 text-xl font-medium">用池子，不用喊单</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          行情来自 GeckoTerminal 的趋势池：价格、流动性、1 小时成交笔数、买卖笔数和成交额。社媒热度很容易被刷，所以不进主信号。同一只币如果有多个池，只留流动性最深的那个。
        </p>
      </article>
      <article className="rounded-2xl border border-border bg-card/80 p-5">
        <p className="text-xs tracking-[0.16em] text-primary uppercase">03 过滤</p>
        <h2 className="mt-2 text-xl font-medium">达不到门槛就没有分数的事</h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
          <li>流动性默认至少 ${defaultConfig.minLiquidityUsd.toLocaleString("en-US")}，否则卖不掉。</li>
          <li>池龄默认至少 {defaultConfig.minPoolAgeMinutes} 分钟。刚开盘的那一下滑点、貔貅和内部抛售都还没露出来。</li>
          <li>报价必须是 SOL、ETH、BNB、USDC、USDT 这类主流资产。</li>
          <li>1 小时成交至少 {defaultConfig.minHourlyTx} 笔，FDV / 流动性不超过 {defaultConfig.maxFdvToLiquidity}。</li>
          <li>1 小时涨幅要落在 {defaultConfig.minH1ChangePct}% 到 {defaultConfig.maxH1ChangePct}%：太弱没动量，太陡多半是末端。</li>
        </ul>
      </article>
      <article className="rounded-2xl border border-border bg-card/80 p-5">
        <p className="text-xs tracking-[0.16em] text-primary uppercase">04 分数</p>
        <h2 className="mt-2 text-xl font-medium">四项加权，再扣结构风险</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          买卖差 28%，1 小时动量 30%，流动性深度 24%，换手 18%。动量喜欢温和上涨，不奖励垂直拉升。换手太低是没人玩，高到离谱则怀疑对倒。非主流报价、FDV 虚高、5 分钟急跌会直接扣分。默认 {defaultConfig.entryScore} 分才允许开仓，跌破 {defaultConfig.exitScore} 分并且至少拿了 10 分钟就离场。
        </p>
      </article>
      <article className="rounded-2xl border border-border bg-card/80 p-5">
        <p className="text-xs tracking-[0.16em] text-primary uppercase">05 成交</p>
        <h2 className="mt-2 text-xl font-medium">按恒定乘积估算滑点</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          假设池子大致平衡，报价资产储备约等于流动性的一半。买入冲击 ≈ 下单金额 / 报价储备，再加 {defaultConfig.feeBps} bps 手续费。单笔默认不超过 ${defaultConfig.maxPositionUsd}，也不超过池子的 {share}%。预估成本超过 {defaultConfig.maxSlippageBps} bps 就放弃。每一轮最多新开 1 只，持仓上限 {defaultConfig.maxPositions} 只。
        </p>
      </article>
      <article className="rounded-2xl border border-border bg-card/80 p-5">
        <p className="text-xs tracking-[0.16em] text-primary uppercase">06 出场</p>
        <h2 className="mt-2 text-xl font-medium">先活下来，再谈打中</h2>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
          <li>止损 {stop}%，止盈 {target}%，都按成交价计算，开仓滑点会吃掉一部分空间。</li>
          <li>浮盈达到 {trailOn}% 之后，从最高价回撤 {trailBack}% 移动止盈。</li>
          <li>持有超过 {defaultConfig.timeStopMinutes} 分钟强制离场。今天回撤达到 {dayLimit}% 就停止开新仓，已有仓位仍会出场。</li>
        </ul>
      </article>
      <article className="rounded-2xl border border-border bg-card/80 p-5 lg:col-span-2">
        <p className="text-xs tracking-[0.16em] text-primary uppercase">07 回测读法</p>
        <h2 className="mt-2 text-xl font-medium">K 线回测不是实盘复刻</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          回测用最近约 24 小时的 5 分钟 K 线。信号在收盘确认，下一根开盘才成交，避免用到当根还没走完的价格。因为 K 线没有买卖笔数，买盘用“收盘靠近高点”近似，所以它和扫描分数不是同一个模型。滑点用现在的流动性套到整段历史上，早期池子更浅，曲线会偏乐观。公开行情也看不出合约能不能卖出。纸面盈利不等于能离场。
        </p>
      </article>
    </div>
  );
}
