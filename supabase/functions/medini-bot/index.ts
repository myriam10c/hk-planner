import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Phase 2 : utilise env vars + schema trading (tables bot_* isolées du schema public)
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const NTFY_TOPIC = "medini-bot-hillal";

const PAIRS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT"];
const PAIR_DISPLAY: Record<string, string> = {
  BTCUSDT: "BTC/USDT", ETHUSDT: "ETH/USDT", SOLUSDT: "SOL/USDT",
  DOGEUSDT: "DOGE/USDT", AVAXUSDT: "AVAX/USDT", LINKUSDT: "LINK/USDT"
};

// ===== STRATÉGIE V3 OPTIMISÉE =====
const TIMEFRAME = "4h";
const EMA_FAST = 9, EMA_SLOW = 21, EMA_TREND = 50;
const RSI_PERIOD = 14, RSI_MIN = 35, RSI_MAX = 70;
const VOL_MA_PERIOD = 20;
const VOL_THRESHOLD = 0.8;
const CROSS_WINDOW = 4;

interface Config {
  sl_pct: number; tp_pct: number; risk_pct: number;
  max_trades: number; active_capital: number; btc_dd_threshold: number;
  trading_mode: string;
}

async function notify(title: string, message: string, priority = "default", tags = "") {
  try {
    await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST",
      headers: { "Title": title, "Priority": priority, "Tags": tags },
      body: message,
    });
  } catch (e) {
    console.log(`Notification error: ${e}`);
  }
}

async function bitgetPublic(endpoint: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `https://api.bitget.com${endpoint}${qs ? '?' + qs : ''}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.code !== "00000") throw new Error(`Bitget error: ${json.msg}`);
  return json.data;
}

async function getCandles(pair: string, limit = 100): Promise<number[][]> {
  const data = await bitgetPublic("/api/v2/spot/market/candles", {
    symbol: pair, granularity: TIMEFRAME, limit: String(limit)
  });
  return data.reverse().map((c: string[]) => c.map(Number));
}

async function getTicker(pair: string) {
  const data = await bitgetPublic("/api/v2/spot/market/tickers", { symbol: pair });
  return data[0];
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function rsi(closes: number[], period = 14): number[] {
  const result: number[] = new Array(closes.length).fill(NaN);
  const gains: number[] = [], losses: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }
  if (gains.length < period) return result;
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    result[i + 1] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function sma(values: number[], period: number): number[] {
  const result: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    result[i] = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
  }
  return result;
}

Deno.serve(async (req: Request) => {
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(`[${new Date().toISOString()}] ${msg}`); console.log(msg); };

  try {
    // IMPORTANT : service_role key + schema 'trading' (Phase 2)
    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      db: { schema: "trading" },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: configRows } = await db.from("bot_config").select("*");
    const cfg: Record<string, string> = {};
    for (const row of configRows || []) cfg[row.key] = row.value;
    const config: Config = {
      sl_pct: Number(cfg.sl_pct || 2), tp_pct: Number(cfg.tp_pct || 4),
      risk_pct: Number(cfg.risk_pct || 1.5), max_trades: Number(cfg.max_trades || 3),
      active_capital: Number(cfg.active_capital || 3000),
      btc_dd_threshold: Number(cfg.btc_dd_threshold || 5),
      trading_mode: cfg.trading_mode || "paper",
    };

    const nowUTC = new Date();
    log(`Medini Bot V3 scan | UTC ${nowUTC.toISOString()} | Mode: ${config.trading_mode} | TF: ${TIMEFRAME} | 6 paires | 24/7`);

    // ===== CHECK OPEN POSITIONS FOR SL/TP =====
    const { data: openPositions } = await db.from("bot_positions").select("*").eq("status", "open");

    for (const pos of openPositions || []) {
      try {
        const ticker = await getTicker(pos.pair.replace("/", ""));
        const price = Number(ticker.lastPr);

        let exitReason = "";
        if (price <= Number(pos.stop_loss)) exitReason = "closed_sl";
        else if (price >= Number(pos.take_profit)) exitReason = "closed_tp";

        if (exitReason) {
          const pnlUsdt = (price - Number(pos.entry_price)) * Number(pos.quantity);
          const pnlPct = ((price / Number(pos.entry_price)) - 1) * 100;

          await db.from("bot_trades").insert({
            pair: pos.pair, entry_price: pos.entry_price, exit_price: price,
            quantity: pos.quantity, usdt_invested: pos.usdt_invested,
            stop_loss: pos.stop_loss, take_profit: pos.take_profit,
            entry_time: pos.entry_time, exit_time: new Date().toISOString(),
            status: exitReason,
            pnl_usdt: Math.round(pnlUsdt * 100) / 100,
            pnl_pct: Math.round(pnlPct * 100) / 100,
            signal_reason: pos.signal_reason,
          });

          await db.from("bot_positions").delete().eq("id", pos.id);

          const { data: stateRows } = await db.from("bot_state").select("*").eq("key", "paper_balance");
          const currentBalance = Number(stateRows?.[0]?.value || config.active_capital);
          const newBalance = currentBalance + pnlUsdt;
          await db.from("bot_state").upsert({ key: "paper_balance", value: newBalance });

          const isWin = exitReason === "closed_tp";
          const label = isWin ? "TAKE PROFIT" : "STOP LOSS";
          log(`${label} ${pos.pair} @ ${price} | PnL: ${pnlUsdt > 0 ? "+" : ""}${pnlUsdt.toFixed(2)} USDT (${pnlPct.toFixed(1)}%)`);

          await notify(
            `${isWin ? "\u2705" : "\ud83d\udd34"} ${label} \u2014 ${pos.pair}`,
            `Sortie @ ${price}\nEntr\u00e9e @ ${pos.entry_price}\nPnL: ${pnlUsdt > 0 ? "+" : ""}${pnlUsdt.toFixed(2)} USDT (${pnlPct > 0 ? "+" : ""}${pnlPct.toFixed(1)}%)\nBalance: ${newBalance.toFixed(2)} USDT`,
            isWin ? "default" : "high",
            isWin ? "chart_with_upwards_trend,white_check_mark" : "chart_with_downwards_trend,red_circle"
          );
        }
      } catch (e) {
        log(`Erreur check exit ${pos.pair}: ${e}`);
      }
    }

    // ===== BTC DRAWDOWN CHECK =====
    const btcTicker = await getTicker("BTCUSDT");
    const btcChange = Number(btcTicker.change24h || 0) * 100;
    log(`BTC 24h: ${btcChange > 0 ? "+" : ""}${btcChange.toFixed(1)}%`);

    if (btcChange <= -config.btc_dd_threshold) {
      log(`BTC drawdown ${btcChange.toFixed(1)}% > seuil -${config.btc_dd_threshold}% \u2014 BLOQU\u00c9`);
      await notify("\u26a0\ufe0f BTC DRAWDOWN", `BTC 24h: ${btcChange.toFixed(1)}%\nTrades bloqu\u00e9s`, "high", "warning");
    } else {
      // ===== SCAN FOR NEW SIGNALS =====
      const { data: currentOpen } = await db.from("bot_positions").select("pair").eq("status", "open");
      const openPairs = new Set((currentOpen || []).map((p: { pair: string }) => p.pair));
      let openCount = openPairs.size;

      for (const pair of PAIRS) {
        const displayPair = PAIR_DISPLAY[pair];
        if (openPairs.has(displayPair)) continue;
        if (openCount >= config.max_trades) {
          log(`${displayPair}: max trades atteint (${openCount}/${config.max_trades}) \u2014 skip`);
          continue;
        }

        try {
          const candles = await getCandles(pair, 100);
          if (candles.length < 55) { log(`${displayPair}: pas assez de donn\u00e9es`); continue; }

          const closes = candles.map(c => c[4]);
          const volumes = candles.map(c => c[5]);
          const ema9 = ema(closes, EMA_FAST);
          const ema21 = ema(closes, EMA_SLOW);
          const ema50 = ema(closes, EMA_TREND);
          const rsiVals = rsi(closes, RSI_PERIOD);
          const volMa = sma(volumes, VOL_MA_PERIOD);

          const i = candles.length - 2;
          const price = closes[i];

          let recentCross = false;
          let crossCandle = -1;
          for (let j = Math.max(1, i - CROSS_WINDOW + 1); j <= i; j++) {
            if (ema9[j - 1] <= ema21[j - 1] && ema9[j] > ema21[j]) {
              recentCross = true;
              crossCandle = j;
              break;
            }
          }

          const stillAbove = ema9[i] > ema21[i];
          const rsiOk = !isNaN(rsiVals[i]) && rsiVals[i] >= RSI_MIN && rsiVals[i] <= RSI_MAX;
          const volOk = !isNaN(volMa[i]) && volumes[i] > volMa[i] * VOL_THRESHOLD;
          const trendOk = price > ema50[i];

          if (recentCross && stillAbove && rsiOk && volOk && trendOk) {
            const riskUsdt = config.active_capital * (config.risk_pct / 100);
            const maxPosUsdt = riskUsdt / (config.sl_pct / 100);
            const { data: balRow } = await db.from("bot_state").select("value").eq("key", "paper_balance").single();
            const balance = Number(balRow?.value || config.active_capital);
            const { data: allOpen } = await db.from("bot_positions").select("usdt_invested").eq("status", "open");
            const usedCapital = (allOpen || []).reduce((s: number, p: { usdt_invested: number }) => s + Number(p.usdt_invested), 0);
            const available = balance - usedCapital;
            const posUsdt = Math.min(maxPosUsdt, available);

            if (posUsdt >= 10) {
              const qty = posUsdt / price;
              const sl = Math.round(price * (1 - config.sl_pct / 100) * 1e6) / 1e6;
              const tp = Math.round(price * (1 + config.tp_pct / 100) * 1e6) / 1e6;
              const volRatio = (volumes[i] / volMa[i]).toFixed(1);
              const crossAge = i - crossCandle;
              const reason = `V3 EMA9\u00d721 cross (${crossAge === 0 ? 'cette bougie' : crossAge + 'b ago'}) | RSI=${rsiVals[i].toFixed(1)} | Vol=${volRatio}x | TF=${TIMEFRAME}`;

              await db.from("bot_positions").insert({
                pair: displayPair, entry_price: price, quantity: Math.round(qty * 1e8) / 1e8,
                usdt_invested: Math.round(posUsdt * 100) / 100,
                stop_loss: sl, take_profit: tp, status: "open",
                entry_time: new Date().toISOString(),
                signal_reason: reason,
              });

              openCount++;
              openPairs.add(displayPair);

              log(`\ud83d\udcc8 OUVERT ${displayPair} @ ${price} | ${posUsdt.toFixed(0)} USDT | SL: ${sl} | TP: ${tp} | ${reason}`);

              await notify(
                `\ud83d\udcc8 TRADE OUVERT \u2014 ${displayPair}`,
                `Entr\u00e9e @ ${price}\nInvesti: ${posUsdt.toFixed(0)} USDT\nStop Loss: ${sl} (-${config.sl_pct}%)\nTake Profit: ${tp} (+${config.tp_pct}%)\nSignal: ${reason}`,
                "high", "chart_with_upwards_trend,moneybag"
              );
            }
          } else {
            const crossInfo = recentCross ? `cross=${crossCandle > 0 ? (i - crossCandle) + 'b ago' : 'oui'}` : 'cross=non';
            log(`${displayPair}: pas de signal (${crossInfo} above=${stillAbove} rsi=${isNaN(rsiVals[i]) ? 'N/A' : rsiVals[i].toFixed(1)} vol=${volOk ? 'ok' : 'low'} trend=${trendOk ? 'ok' : 'no'})`);
          }
        } catch (e) {
          log(`Erreur ${displayPair}: ${e}`);
        }
      }
    }

    // ===== SUMMARY =====
    const { data: finalOpen } = await db.from("bot_positions").select("*").eq("status", "open");
    const { data: allTrades } = await db.from("bot_trades").select("*");
    const { data: balData } = await db.from("bot_state").select("value").eq("key", "paper_balance").single();
    const balance = Number(balData?.value || config.active_capital);
    const wins = (allTrades || []).filter((t: { pnl_usdt: number }) => Number(t.pnl_usdt) > 0).length;
    const totalTrades = (allTrades || []).length;
    const totalPnl = (allTrades || []).reduce((s: number, t: { pnl_usdt: number }) => s + Number(t.pnl_usdt), 0);
    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : "0";

    log(`Balance: ${balance.toFixed(2)} USDT | Positions: ${(finalOpen || []).length}/${config.max_trades} | Trades: ${totalTrades} (W:${wins}) | PnL: ${totalPnl >= 0 ? "+" : ""}${totalPnl.toFixed(2)} | WR: ${winRate}%`);

    await db.from("bot_logs").insert(logs.map(msg => ({ message: msg, level: "info" })));

    return new Response(JSON.stringify({ success: true, logs }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    log(`ERREUR CRITIQUE: ${err}`);
    await notify("\u274c ERREUR Medini Bot", String(err), "urgent", "warning");
    return new Response(JSON.stringify({ success: false, error: String(err), logs }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
});
