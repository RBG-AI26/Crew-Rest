# Crew Rest

Small standalone web app to calculate staggered crew rest breaks.

## How to run

Open `index.html` directly in a browser, or run a local server:

```bash
cd "/Users/russellgillson/Documents/MyApps/Break Rest Calculator"
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## What it calculates

- Break window across the full shift (start to end)
- Staggered off/on schedule in round-robin order
- Balanced or short/long patterned break durations

## Notes

- This mirrors the style of your Numbers sheet, but with a more flexible format.
- If shift end is earlier than shift start, it is treated as an overnight shift.
