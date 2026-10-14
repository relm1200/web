# Wick Reader Patterns: TradingView indicator

`wick-reader-patterns.pine` is a Pine Script v6 indicator. It marks the trainer's 28
candlestick patterns on a live TradingView chart as they form, and it can optionally label
market structure (HH / HL / LH / LL) with a trend readout. It uses the same rules as the
trainer, so a candle it marks is one the trainer would accept as that pattern.

## Install

1. In TradingView, open a chart and click **Pine Editor** at the bottom.
2. Create a new indicator, delete the template code, and paste in the whole of
   `wick-reader-patterns.pine`.
3. Click **Save**, then **Add to chart**.
4. Open the indicator's settings (gear icon) to turn patterns on or off.

## What you'll see

- **Green labels below candles:** bullish patterns. **Red labels above:** bearish patterns.
  **Amber labels:** indecision (Doji, and Spinning Top if you switch it on).
- Hover a label to see the full pattern name and the rule it met.
- 2-, 3- and 5-candle patterns get a box around their candles.
- With **Label swings** turned on: HH / HL / LH / LL at each swing, a dashed zigzag between
  swings, and a table (top right) showing the current trend.

Short codes: H Hammer, HM Hanging Man, IH Inverted Hammer, SS Shooting Star, DfD Dragonfly
Doji, GvD Gravestone Doji, ST Spinning Top, BuM / BeM Bullish / Bearish Marubozu,
BuE / BeE Engulfing, BuH / BeH Harami, PL Piercing Line, DCC Dark Cloud Cover,
TwB / TwT Tweezer Bottom / Top, MS / ES Morning / Evening Star, 3WS Three White Soldiers,
3BC Three Black Crows, 3IU / 3ID Three Inside Up / Down, 3OU / 3OD Three Outside Up / Down,
R3M / F3M Rising / Falling Three Methods. Switch **Label text** to "Full name" to show names
instead.

## Setup checklist

The Monster Guide (pp. 14 and 20) only takes a reversal pattern when three things line up.
The indicator grades these patterns against them: Hammer, Bullish Engulfing, Piercing Line,
Tweezer Bottom, Morning Star, and their bearish mirrors (Shooting Star, Bearish Engulfing,
Dark Cloud Cover, Tweezer Top, Evening Star).

| Check | Passes when |
|---|---|
| **Trend** | The 20-period average (plotted in amber) has risen at least 1.0 average ranges over the 10 candles before the pattern (fallen, for bearish patterns). |
| **Level** | The pattern reaches a support or resistance level and closes back on the right side. It can stop up to 0.6 average ranges short of the level or go up to 1.5 through it. |
| **Size** | The last candle's range is at least 1.3 times the average range of the 10 candles before the pattern. |

On the chart, the checklist is added to the pattern's label as `✓ Trend ✗ Level ✓ Size`.
Hovering the label shows each measurement. When a level is used, a dotted purple line runs
from the swing that made it. When all three checks pass, the label says **★ SETUP** and the
indicator draws the guide's trade plan: entry at about the close (the next candle's open)
and a stop just beyond the pattern's extreme, with the risk in pips.

**Where the levels come from:** on a live chart nobody has drawn support and resistance, so
the indicator uses every confirmed swing high and swing low from the last 100 candles as a
level. A swing must be confirmed before the pattern starts, so the level can't come from the
pattern itself. Old resistance can act as support and the other way round, as in the
guide's examples. If several levels qualify, the nearest one is used. This is the one place
the indicator goes beyond the trainer, which draws the level for you on each practice chart.

Set **Checklist** to "Only passing setups" to see the grades only on setups that pass, or
"Off" to hide them. Alerts: "Bullish setup passes checklist", "Bearish setup passes
checklist", or the general "Any alert() function call" alert, which also reports passing
setups.

## Settings

| Setting | Default | Meaning |
|---|---|---|
| Only mark closed candles | On | Waits for the candle to close, so a mark never appears mid-candle and then disappears. |
| Show | All | Limit to bullish or bearish patterns. |
| Average range length | 10 | Candles used to measure "normal" candle size. |
| Trend lookback | 6 | Candles before the pattern used to judge the decline or rally. |
| Trend threshold | 1.5 | Net move, in average ranges, that counts as a decline or rally. |
| Swing strength | 2 | Candles on each side a swing high or low must beat. Also sets which swings count as levels for the checklist. |
| Checklist thresholds | 20 / 10 / 1.0 / 0.6 / 1.5 / 1.3 | Average length, slope window, minimum slope, level distance short of / through, size ratio. The guide states the checks in words; these numbers are the trainer's. |

Keep the context settings at their defaults to match the trainer exactly.

## Alerts

- **One alert for everything:** create an alert on this indicator and choose
  **"Any alert() function call"**. It fires once per closed candle and lists every enabled
  pattern that formed, for example `EURUSD 240: Hammer, Tweezer Bottom`.
- **Specific alerts:** pick a condition such as "Bullish Engulfing", "Any bullish pattern" or
  "Structure trend changed".

## Things to know

- **Patterns need context.** Most reversal patterns only count after a decline or rally
  (net move of 1.5 average ranges over the 6 candles before the pattern). The same shape
  in a flat market is not marked. This is deliberate, and it is why Hammer and Hanging Man
  never appear on the same candle.
- **Rules are strict, so marks are rare.** On 600 bars of EUR/USD H4 the indicator marks
  about 40 candles (plus 69 spinning tops if you enable them). See
  `reference/OANDA_EURUSD_4h.md`.
- **Swing labels appear late.** A swing is confirmed only after 2 more candles close (with
  strength 2), so labels are drawn 2 candles back. That is how swings are defined, not
  repainting.
- **Label limit.** TradingView keeps the most recent 500 labels and boxes, so very old marks
  drop off on long histories.
- **Educational use.** A pattern is a probability, not a signal to trade on its own. The
  trainer's Setups tab covers the checklist from the Monster Guide (trend, level, size).

## How it was checked

TradingView's compiler isn't available outside TradingView, so the Pine syntax was checked by
reading the code. The logic was checked automatically (`tests/pine-parity.test.js`):

- The test reads this `.pine` file, translates the pattern rules to JavaScript, and runs
  them bar by bar on thousands of generated charts and on the real EUR/USD data in
  `reference/`. On every bar they must flag exactly the patterns the trainer's detector
  flags.
- A mirror of the market-structure section is checked against the trainer's swing
  detector, including outside bars that are both a swing high and a swing low.
- The Pine `setupCheck` function is translated as well and compared with the trainer's
  `evaluateSetupLive` on every setup pattern in generated setup charts and the real data. It
  must agree on all three checks, the slope, and which level was chosen.

If TradingView reports a compile error when you add the script, send me the message and
line number.

## Checking it on your chart

`reference/OANDA_EURUSD_4h.md` lists every candle the indicator should mark on
OANDA:EURUSD, 4-hour, for the 600 bars ending 14 Oct 2026, the checklist grade for each
setup pattern (1 of 12 passes), and the final swing labels.
Open that chart, add the indicator with default settings, and compare a few rows. Times in
the file are UTC; TradingView shows your chart's timezone.

To make a list for another symbol, save its bars in the same JSON shape and run:

```
node tradingview/reference/make-reference.js path/to/bars.json
```
