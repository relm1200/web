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
| **Drill** | A chart ends on a pattern. Name it (4 choices) or call its bias (bullish / bearish / indecision). Feedback shows the measured trend and candle proportions next to the pattern's rules, plus why your pick didn't fit. |
| **Spot** | You're told the pattern. Find the candle that completes it on a longer chart that includes what price did afterwards. |
| **Library** | All 22 patterns with a generated example, recognition rules, meaning and confirmation notes, plus forex-specific reading notes. |
| **Progress** | Accuracy per pattern for Drill and Spot, and which pattern you most often confuse it with. Saved in your browser only. |

Options: limit practice to 1-, 2- or 3-candle patterns; turn pattern shading off for a
harder drill; "Focus weak spots" weights questions toward patterns you miss (a
Laplace-smoothed error rate); "Practise this" drills one pattern at a time. Keyboard: `1`–`4`
answer, `Enter` next; in Spot, arrow keys move and `Enter` picks.

### Patterns covered

- **1-candle:** Doji, Dragonfly Doji, Gravestone Doji, Hammer, Hanging Man, Inverted Hammer,
  Shooting Star, Spinning Top, Bullish Marubozu, Bearish Marubozu
- **2-candle:** Bullish/Bearish Engulfing, Bullish/Bearish Harami, Piercing Line, Dark Cloud
  Cover, Tweezer Bottom, Tweezer Top
- **3-candle:** Morning Star, Evening Star, Three White Soldiers, Three Black Crows

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

A chart can legitimately qualify as two patterns (an engulfing candle that also makes the
same low as the previous one is a tweezer bottom too). Any pattern the detector also finds
is never offered as a wrong answer, and the feedback names it.

## Tests

```
npm test
```

The tests check the hand-built boundary cases (hammer vs hanging man, engulfing vs piercing,
doji body limit) and run 3,000+ generated charts. They confirm every drill chart ends on a
valid instance, every Spot chart contains exactly one, and that charts qualifying as a
second pattern stay under 6%.

## Matching it to a specific video or course

To align with a particular lesson, edit the `PATTERNS` entries in `js/patterns.js`: change
the wording in `rules` / `meaning` / `confirm`, adjust thresholds in `test`, or remove
patterns you don't want drilled. Run `npm test` afterwards to make sure the generators
still produce valid charts.

## Disclaimer

Educational use only. Charts are synthetic, not market data. Candlestick patterns describe
probabilities, not certainties.
