# Wick Reader: forex candlestick pattern trainer

An interactive, visual practice tool for identifying Japanese candlestick patterns on
forex charts. Every chart is generated on the fly and checked by a rule-based detector, so
each question has a verifiable answer and you never see the same chart twice.

## Run it

No build step or dependencies. Open `index.html` in a browser.

For a single file to share or host, run `npm run build:single`. It writes
`dist/wick-reader.html` with the CSS and JavaScript inlined.

## What's inside

| View | What you do |
|---|---|
| **Drill** | A chart ends on a pattern. Name it (4 choices), call its bias (bullish / bearish / indecision), or **read the candle** (who's in control, based on the Monster Guide's body-and-wick principles). Feedback shows the measured trend and candle proportions next to the rules, why your pick didn't fit, and the source. |
| **Spot** | You're told the pattern. Find the candle that completes it on a longer chart that includes what price did afterwards. |
| **Setups** | Grade a reversal pattern against the Monster Guide's checklist: with the bigger trend (20-period average), at support/resistance after a pullback, and larger than the earlier candles. Passing setups show the guide's trade plan: entry at the next open, stop beyond the pattern, risk in pips. |
| **Structure** | Market structure practice on generated swing charts. **Label the swings** (mark each numbered swing HH, HL, LH or LL), **call the trend** (uptrend, downtrend or range, with an optional swing-point assist), or **find the swing** (click the most recent HH, HL, LH or LL). Feedback draws the zigzag, labels every swing, measures each comparison in average ranges, and explains which swings decide the trend. |
| **Library** | All 28 patterns with a generated example, rules, meaning, confirmation, source citations and notes where sources disagree, plus forex reading notes and a Sources panel. |
| **Progress** | Accuracy per pattern for Drill and Spot, which pattern you most often confuse it with, and totals for candle reading and setups. Saved in your browser only. |

Options: limit practice to 1-, 2-, 3- or 5-candle patterns; turn pattern shading off for a
harder drill; "Focus weak spots" weights questions toward patterns you miss (a
Laplace-smoothed error rate); "Practise this" drills one pattern at a time. Keyboard: `1`–`5`
answer, `Enter` next; in Spot, arrow keys move and `Enter` picks.

### Patterns covered

- **1-candle:** Doji, Dragonfly Doji, Gravestone Doji, Hammer, Hanging Man, Inverted Hammer,
  Shooting Star, Spinning Top, Bullish Marubozu, Bearish Marubozu
- **2-candle:** Bullish/Bearish Engulfing, Bullish/Bearish Harami, Piercing Line, Dark Cloud
  Cover, Tweezer Bottom, Tweezer Top
- **3-candle:** Morning Star, Evening Star, Three White Soldiers, Three Black Crows, Three
  Inside Up/Down, Three Outside Up/Down
- **5-candle:** Rising Three Methods, Falling Three Methods

## Sources

Pattern rules, meanings and the setup checklist come from two documents. Each pattern in
`js/patterns.js` records which one it follows (`refs`, with page or entry numbers) and any
disagreement (`notes`); both appear in the app.

- *The Monster Guide to Candlestick Patterns*, Rayner Teo (TradingwithRayner): rules for 18
  patterns, the three-step setup checklist (pp. 14, 20) and the candle-reading principles
  (pp. 32–35).
- *58 Candlestick Patterns PDF Manual*, tradingpdf.net (printed 25 Dec 2023): rules for 21
  patterns, including Three Inside/Outside, Hanging Man and Inverted Hammer.

How conflicts are resolved:

| Topic | Sources say | Trainer uses |
|---|---|---|
| Piercing Line / Dark Cloud Cover | Manual: candle 2 opens beyond candle 1's low/high (a gap). Guide: no gap. | No gap, since spot FX rarely gaps. |
| Morning / Evening Star | Manual (Doji Star): doji gapping away. Guide: small-range middle candle. | Guide's version, same reason. |
| Harami | Classic: reversal after a decline. Guide: works better as a continuation. | Classic reversal; the guide's view is shown on the card. |
| Engulfing | Guide's narrative says "closes above the previous high"; both sources' recognition rules compare bodies. | Body rule. |
| Three Inside Up/Down | Manual: candle 3 closes beyond candle 2's close. Many references: beyond candle 1's open. | Manual's rule, noted. |

Problems found in the sources (also listed in the app): the manual's candle colour
convention is reversed (it calls filled/black bodies bullish); the manual promises 58
patterns but its pages stop at entry #43; gap-based patterns (Abandoned Baby, Kicking,
Doji Stars, Island Reversal) are left out because forex rarely gaps.

The sources describe shapes in words ("small body", "long shadow", "larger than earlier
candles"). The trainer turns these into numbers, shown in each rule. The setup thresholds
(average slope ≥ 1.0 average ranges, within 0.6 of the level, last candle ≥ 1.3× average range)
are the trainer's own; the guide gives no figures.

## Market structure

Defined in `js/structure.js` (standard Dow Theory reading; neither attached PDF defines swing
structure, and the app says so):

- **Swing high / low:** a candle whose high (low) is beyond the 2 candles on each side. Highs
  and lows alternate; of two in a row, the more extreme one is kept. The last 2 candles can't
  confirm a swing yet.
- **HH / LH:** each swing high compared with the previous swing high. **HL / LL:** each swing
  low compared with the previous swing low. The first high and first low are unlabelled.
- **Trend:** uptrend when the latest high is HH and the latest low is HL; downtrend when they
  are LH and LL; otherwise range / no clear trend.

Charts are built from designed swing points (trends, ranges and reversals). A chart is kept
only if the detector finds exactly those swings and every comparison differs by at least 0.3
average ranges, so no label is a judgement call. Answers always come from the detector, not
from the scenario the chart was built from.

## How the rules work

All definitions live in `js/patterns.js` (`PATTERNS`). Each pattern has:

- `test(candles, i, ctx)`: the detection rule, using only proportions (body, wick and
  range ratios), so it works for any pair or price scale.
- `trend`: required context. Trend is the net move over the 6 candles before the pattern,
  measured in average candle ranges (the last 10 candles); ±1.5 or more counts as a trend.
  This separates look-alikes such as Hammer vs Hanging Man and Inverted Hammer vs Shooting
  Star.
- `build(rng, lastClose)`: generates a randomised, idealised instance for the drills.
- Teaching text: `rules`, `meaning`, `confirm`, and `confuse` (look-alikes used as
  distractors).

Forex specifics: spot FX rarely gaps, so stars, piercing lines and dark clouds are judged on
bodies and closes rather than gaps. Prices use real pip sizes and decimal places (5 for
majors, 3 for JPY pairs), with typical H1/H4/D1 candle ranges.

Hammers and shooting stars must close in the top or bottom quarter of their range, and
tweezers need a first candle that shows rejection (Monster Guide). Trend for the Setups
checklist uses the slope of a 20-period moving average instead.

A chart can legitimately qualify as two patterns (an engulfing candle that also makes the
same low as the previous one is a tweezer bottom too). Any pattern the detector also finds
is never offered as a wrong answer, and the feedback names it.

## Tests

```
npm test
```

The tests check hand-built boundary cases (hammer vs hanging man, engulfing vs piercing,
the Monster Guide's top-quarter close for hammers, tweezer rejection, candle reading) and run
thousands of generated charts. They confirm that every drill chart ends on a valid instance,
every Spot chart contains exactly one, every candle-reading chart has exactly one correct
reading, every setup chart matches all 8 pass/fail combinations of the checklist, and that
charts qualifying as a second pattern stay under 6%. Structure tests check swing detection
and labelling on hand-built charts, the trend rule, and that every generated structure chart
re-detects to exactly its designed swings.

## Matching it to a specific video or course

To align with a particular lesson, edit the `PATTERNS` entries in `js/patterns.js`: change
the wording in `rules` / `meaning` / `confirm`, adjust thresholds in `test`, or remove
patterns you don't want drilled. Run `npm test` afterwards to make sure the generators
still produce valid charts.

## Disclaimer

Educational use only. Charts are synthetic, not market data. Candlestick patterns describe
probabilities, not certainties.
