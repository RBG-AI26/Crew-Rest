# Crew Rest

Small standalone web app to calculate staggered crew rest breaks.

## GitHub Pages deployment

This repo now deploys to GitHub Pages with a GitHub Actions workflow on every push to `main`.

If GitHub Pages is currently showing a 404 page, check the repository setting once:

```text
Settings -> Pages -> Source -> GitHub Actions
```

The published site URL for this repo is:

[`https://rbg-ai26.github.io/Crew-Rest/`](https://rbg-ai26.github.io/Crew-Rest/)

## How to run

Open `index.html` directly in a browser, or run a local server:

```bash
cd "/Users/russellgillson/Documents/MyApps/Crew Rest"
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
