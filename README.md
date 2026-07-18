# Wortschatz — German A2 Vocabulary Trainer

A complete, offline-first study app built from your `Deutsch_A2_Woerterbuch-1.docx`
document — **654 words, verbs and expressions** across **15 real-life topics**,
with Anki-style spaced repetition, three quiz modes, XP/levels, achievements,
and full stats. Vanilla HTML/CSS/JS, no frameworks, no build step, no external
network requests of any kind.

## Quick start

**Option A — just open it.** Double-click `index.html`. Everything works,
including studying, quizzes, stats, and saving your progress.

**Option B — serve it (recommended).** Service workers (the piece that lets
the browser install the app and cache it for offline use) only run on
`http://` / `https://`, not on a double-clicked local file. From this folder:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

**Option C — GitHub Pages.** Push this folder to a repo and enable Pages.
No build step, no config needed — it's already static.

Either way, after the first visit the app keeps working with your Wi-Fi off.

## What's inside

| File | Purpose |
|---|---|
| `index.html` | App shell: every view, overlay, and the hand-drawn icon sprite |
| `style.css` | The full design system (tokens, components, light/dark, responsive) |
| `app.js` | All logic, organized as small modules (see header comment in the file) |
| `cards.json` | The 654 cards + 15 categories as plain JSON |
| `cards.js` | The same data, wrapped so it loads with a `<script>` tag instead of `fetch()` — this is what makes double-clicking `index.html` work, since browsers block `fetch()` of local files under `file://` |
| `manifest.json` | PWA manifest (name, icons, colors) so it can be installed |
| `service-worker.js` | Cache-first offline strategy for everything above |
| `assets/icons/` | Generated app icons (all standard + maskable sizes) |
| `assets/sounds/` | Empty on purpose — sound effects are synthesized live with the Web Audio API instead of shipped as files (see `README.txt` inside) |

## How your vocabulary became data

Your document's structure repeated cleanly 15 times: a topic heading (with its
own emoji), then three tables — **Wörter** (words), **Verben** (verbs), and
**Ausdrücke** (expressions, which is also where full example sentences live).
A extraction pass read every table row in document order and produced:

- **654 cards** total, each with a stable id like `health-w-014`
- **15 categories**: Health, Work, Restaurant, Food, Office, Hotel, Travel,
  Weather, Media, Culture, Books, Police, Internet, Education, Abroad
- A best-effort `gender` tag (der/die/das → m/f/n) on noun entries, parsed from
  the article already present in the German text

## Design

The content is vocabulary for *navigating real life* in a German-speaking
country — clinics, offices, hotels, police stations, the internet. So the app
is styled after German wayfinding/transit signage rather than a cartoon-owl
aesthetic: a dark "petrol" ink or light "platform tile" background, amber +
teal accents, monospace numerals for anything data-like (XP, timers, stats),
and a signature **Line Map** on the Home and Progress screens — your 15
categories drawn as stations on a winding line, each one filling in with color
as you master that topic.

No web fonts are loaded (the app never makes a network request, full stop) —
type is a tuned system-font stack, leaning on the monospace face and tracked
uppercase labels for personality instead.

## Feature notes / judgment calls

- **Spaced repetition**: a simplified SM-2 (the algorithm Anki is built on).
  Again/Hard/Good/Easy adjust an ease factor and interval per card; the
  interval preview shown on each button (e.g. "3d", "<10m") is a live
  simulation, not a guess. Mastery % blends how long the interval has grown
  with your accuracy on that card.
- **Swipe vs. grading**: swiping left/right moves through the deck (like
  flipping physical cards) without touching a card's schedule; only the four
  grade buttons update spaced repetition, per the spec.
- **Typing mode**: accepts anything ≥90% similar (Levenshtein distance) to
  the correct German, and shows a character-level correction when you're
  below that bar.
- **Speed Challenge leaderboard**: this app has no backend or accounts, so
  "leaderboard" is your personal best runs, saved on this device.
- **Themes**: Dark/Light/Auto is one control; Amber/Blue/Green/Purple accent
  is a separate one — together they cover all five theme names from the
  brief without forcing odd combinations like a specific "Green + Light"
  toggle.
- **Data**: your progress lives in `localStorage` only (nothing leaves your
  device). Settings → Your data lets you export a JSON backup, import one
  back, or wipe everything and start over.

## Keyboard shortcuts (while studying)

`Space` flip · `←/→` previous/next · `1`–`4` Again/Hard/Good/Easy ·
`F` favorite · `P` pronounce · `Esc` back

## Browser support

Built and tested against current Chromium. Uses standard, broadly-supported
web platform APIs (Pointer Events, Web Speech, Web Audio, Service Worker,
`backdrop-filter` with a `-webkit-` prefix included) — no bleeding-edge or
experimental features.
