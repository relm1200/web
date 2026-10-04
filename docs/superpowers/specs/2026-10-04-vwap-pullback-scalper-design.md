# VWAP Pullback Scalper — Design

**Date:** 2026-10-04
**Status:** Awaiting review
**Deliverable:** One TradingView Pine Script v5 strategy, run by the user in the Strategy Tester.

## Goal

Backtest a forex scalping strategy that buys pullbacks to session VWAP in the
direction of the trend (and sells rallies to it in a downtrend), to find out
whether it has an edge **after realistic trading costs**.

Success = a script that produces trustworthy Strategy Tester results (no
repainting, costs included) on 6–12 months of EURUSD and GBPUSD data, which the
user shares back for evaluation.

Out of scope: live alerts, auto-execution, multi-pair portfolio testing,
parameter optimisation tooling.

## Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Platform | TradingView Pine Script v5 (strategy) |
| Style | Scalping, 1m–5m chart |
| Trend filter | VWAP slope **and** higher-timeframe EMA must agree |
| Entry | Touch-and-reclaim of VWAP, enter on close |
| Exit | Structural stop + fixed R-multiple target |
| Session | London, defaults for EURUSD / GBPUSD, configurable |

## Rules

All times are Europe/London (Pine `"Europe/London"` timezone, so DST is handled).

1. **Session VWAP.** Anchored VWAP resets at the session start (default 07:00).
   Uses the chart's tick volume (forex has no central volume).
2. **Trend filter** — evaluated on the signal bar's close:
   - **Long allowed** when VWAP now > VWAP `slopeLen` bars ago (default 10) **and**
     at least `aboveRatio` (default 60%) of the last `slopeLen` closes were above
     VWAP **and** close > HTF EMA.
   - **Short allowed** is the exact mirror.
   - HTF EMA: length 50 on 15m by default, read with
     `request.security(..., lookahead = barmerge.lookahead_off)` from the
     *previous closed* HTF bar (`ema[1]`) so it never repaints.
3. **Entry (touch and reclaim):**
   - Long: within the last `touchLookback` bars (default 5) some bar's low ≤
     VWAP, and the current bar closes > VWAP after the previous close was ≤
     VWAP or the touching bar is the current bar. Enter at bar close
     (`process_orders_on_close = true`).
   - Short: mirror (high ≥ VWAP, close back below).
   - Only when flat, inside the entry window (session start → `noNewEntries`,
     default 11:00), and below `maxTrades` for the session (default 3).
4. **Stop:** lowest low of the pullback (lowest low over the bars since the
   VWAP touch, inclusive) minus `stopBuffer` pips (default 1.0). Mirror for shorts.
   If stop distance < `minStopPips` (default 2) the signal is skipped (too tight
   to survive spread).
5. **Target:** entry ± `rMultiple` × stop distance (default 1.5).
6. **Session flat:** any open position is closed at `flatTime` (default 12:00).
7. **Position size:** quantity so that a stop-out loses `riskPct` of current
   equity (default 0.5%). Uses `syminfo.mintick`/`syminfo.pointvalue` to convert
   pips to account currency.

## Costs

- `strategy(..., slippage = …)` set from a `slippagePips` input (default 0.2).
- Spread modelled as commission per trade from a `spreadPips` input (default 0.8),
  converted to cash-per-contract.
- Both visible in the inputs so results can be stress-tested at worse costs.

## Chart output

- Session VWAP line (coloured by allowed trend direction).
- HTF EMA line.
- Background shading for the entry window and the post-entry window.
- Entry/exit markers (built-in strategy markers), stop and target lines for the
  open trade.

## Inputs (grouped)

- **Session:** start, no-new-entries time, flat time.
- **Trend:** `slopeLen`, `aboveRatio`, HTF timeframe, EMA length.
- **Entry/exit:** `touchLookback`, `stopBuffer`, `minStopPips`, `rMultiple`,
  `maxTrades`.
- **Risk & costs:** `riskPct`, `spreadPips`, `slippagePips`.

## Verification

Pine cannot be run from this repo, so verification is:

1. Script compiles in the Pine editor with no warnings.
2. Visual spot-check on a few sessions: every entry follows a VWAP touch and
   reclaim, sits on the trend side of both filters, and is inside the entry
   window; no trades exist after the flat time.
3. Repaint check: results are unchanged after reloading the chart and after
   replaying bars (Bar Replay).
4. Backtest 6–12 months on EURUSD and GBPUSD (5m), and record net profit,
   profit factor, win rate, max drawdown, trade count and average R. Re-run
   with costs doubled. If the edge disappears at 2× costs, it is not robust.

## File layout

- `pine/vwap-pullback-scalper.pine` — the strategy.
- `pine/README.md` — how to load it, what each input does, how to report results.
