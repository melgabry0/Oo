This folder is intentionally empty.

Wortschatz generates every sound effect (card flip, correct/wrong answer,
achievement fanfare, level-up chime) on the fly with the Web Audio API
(see the `Sound` module in app.js) instead of shipping audio files.

Why: it keeps the app at zero binary asset weight, works instantly offline
with nothing to fetch or cache, and needs no third-party sound library.
