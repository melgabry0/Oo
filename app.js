/* ============================================================================
   WORTSCHATZ — app.js
   Vanilla ES6, no frameworks, no build step, no network requests.
   Organized as small IIFE modules on top-level consts so the whole app is
   still a single file (per spec) while staying easy to navigate:

     Config -> Utils -> Storage -> Data -> SRS -> XP -> Achievements ->
     Sound -> TTS -> Toast -> Nav/View -> LineMap -> Home -> Study -> Quiz ->
     Stats -> Search -> Settings -> App (wires it all up, runs last)
   ============================================================================ */

/* ---------------------------------------------------------------------------
   CONFIG
   --------------------------------------------------------------------------- */
const CONFIG = Object.freeze({
  STORAGE_KEY: 'wortschatz.state.v2',
  APP_VERSION: '1.0.0',

  // ---- SRS (simplified SM-2 / Anki-style) ----
  SRS: {
    EASE_START: 2.5,
    EASE_MIN: 1.3,
    LEARNING_STEP_MIN: 10,      // minutes -- first "Again"/new-card step
    GRADUATING_DAYS: 1,         // first interval once a new/learning card is graded Good
    EASY_GRADUATING_DAYS: 4,
    HARD_EASE_DELTA: -0.15,
    AGAIN_EASE_DELTA: -0.20,
    EASY_EASE_DELTA: 0.15,
    HARD_INTERVAL_MULT: 1.2,
    EASY_INTERVAL_MULT: 1.3,
  },

  // ---- XP awards ----
  XP: {
    REVIEW: 2,           // per card reviewed (any grade)
    CORRECT_BONUS: 3,    // extra for Good/Easy (i.e. "correct")
    EASY_BONUS: 2,       // extra on top of correct for Easy
    DAILY_GOAL: 40,
    QUIZ_COMPLETE: 15,
    QUIZ_CORRECT: 4,
    SPEED_CORRECT: 5,
    SPEED_COMPLETE: 20,
    PERFECT_QUIZ_BONUS: 25,
  },

  LEVELS: [
    { name: 'Beginner', min: 0 },
    { name: 'Student', min: 500 },
    { name: 'Explorer', min: 1500 },
    { name: 'Speaker', min: 3500 },
    { name: 'Advanced', min: 7000 },
    { name: 'Expert', min: 12000 },
    { name: 'Master', min: 20000 },
  ],

  DAILY_GOAL_OPTIONS: [10, 20, 30, 50, 100],

  // hand-tuned hues for the 15 "line" categories (see DESIGN_NOTES)
  CATEGORY_HUES: {
    health: 350, work: 222, restaurant: 18, food: 88, office: 198,
    hotel: 320, travel: 168, weather: 205, media: 280, culture: 258,
    books: 30, police: 232, internet: 188, education: 246, abroad: 142,
  },

  MASTERY_MASTERED_THRESHOLD: 80,
});

const ACHIEVEMENTS = [
  { id: 'cards100', name: '100 Cards', desc: 'Review 100 cards', icon: 'i-cards', check: s => s.totalReviews >= 100 },
  { id: 'cards300', name: '300 Cards', desc: 'Review 300 cards', icon: 'i-cards', check: s => s.totalReviews >= 300 },
  { id: 'cards600', name: '600 Cards', desc: 'Review 600 cards', icon: 'i-cards', check: s => s.totalReviews >= 600 },
  { id: 'streak7', name: '7 Day Streak', desc: 'Study 7 days in a row', icon: 'i-flame', check: s => s.longestStreak >= 7 },
  { id: 'streak30', name: '30 Day Streak', desc: 'Study 30 days in a row', icon: 'i-flame', check: s => s.longestStreak >= 30 },
  { id: 'streak100', name: '100 Day Streak', desc: 'Study 100 days in a row', icon: 'i-flame', check: s => s.longestStreak >= 100 },
  { id: 'perfectQuiz', name: 'Perfect Quiz', desc: 'Finish a quiz with 100% accuracy', icon: 'i-trophy', check: s => s.hadPerfectQuiz },
  { id: 'vocabMaster', name: 'Vocabulary Master', desc: 'Master every card', icon: 'i-star', check: s => s.masteredCount >= s.totalCards && s.totalCards > 0 },
];

/* ---------------------------------------------------------------------------
   UTILS
   --------------------------------------------------------------------------- */
const Utils = (() => {
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function todayStr(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  function dateFromStr(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
  }
  function addMinutes(date, n) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() + n);
    return d;
  }
  function daysBetweenStr(aStr, bStr) {
    const a = dateFromStr(aStr), b = dateFromStr(bStr);
    return Math.round((b - a) / 86400000);
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function sample(arr, n) { return shuffle(arr).slice(0, n); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // Levenshtein edit distance -> normalized similarity ratio in [0,1]
  function levenshtein(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const dp = new Array(n + 1);
    for (let j = 0; j <= n; j++) dp[j] = j;
    for (let i = 1; i <= m; i++) {
      let prev = dp[0];
      dp[0] = i;
      for (let j = 1; j <= n; j++) {
        const tmp = dp[j];
        dp[j] = a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j], dp[j - 1]);
        prev = tmp;
      }
    }
    return dp[n];
  }
  function similarity(a, b) {
    a = (a || '').trim(); b = (b || '').trim();
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    const dist = levenshtein(a, b);
    return 1 - dist / maxLen;
  }

  // strip leading der/die/das/zu for a "core" comparison, kept separate from
  // the strict similarity check so typing quiz can explain gender mistakes
  function stripArticle(s) {
    return s.replace(/^(der|die|das|zu)\s+/i, '').trim();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function formatMinutes(totalMin) {
    if (totalMin < 1) return '0 min';
    if (totalMin < 60) return `${Math.round(totalMin)} min`;
    const h = Math.floor(totalMin / 60), m = Math.round(totalMin % 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  return {
    pad2, todayStr, dateFromStr, addDays, addMinutes, daysBetweenStr, clamp, uid,
    shuffle, sample, pick, levenshtein, similarity, stripArticle, escapeHtml,
    formatMinutes, debounce,
  };
})();

/* ---------------------------------------------------------------------------
   STORAGE  (single localStorage blob; content data lives in cards.json/js,
   this only stores mutable per-user progress & preferences)
   --------------------------------------------------------------------------- */
const Storage = (() => {
  function defaultState() {
    const today = Utils.todayStr();
    return {
      version: 2,
      createdAt: today,
      xp: 0,
      streak: { current: 0, longest: 0, lastStudyDate: null },
      dailyGoal: 20,
      todayProgress: { date: today, reviewed: 0, minutes: 0 },
      theme: { mode: 'system', accent: 'amber', highContrast: false },
      settings: {
        direction: 'en-de',
        ttsRate: 1,
        ttsVoiceURI: null,
        slowMode: false,
        repeatMode: false,
        sound: true,
        haptics: true,
      },
      favorites: {},          // cardId -> true
      progress: {},            // cardId -> SRS record
      achievements: {},        // achId -> ISO date unlocked
      speedScores: { 60: [], 120: [] },
      dailyLog: {},             // 'YYYY-MM-DD' -> {reviewed, correct, wrong, minutes, xp}
      quizHistory: [],          // capped list of recent quiz results
      totalReviews: 0,
      lastSessionCardIds: [],
    };
  }

  function migrate(state) {
    const d = defaultState();
    // shallow+one-level merge so new fields introduced later always exist
    const merged = { ...d, ...state };
    merged.streak = { ...d.streak, ...(state.streak || {}) };
    merged.todayProgress = { ...d.todayProgress, ...(state.todayProgress || {}) };
    merged.theme = { ...d.theme, ...(state.theme || {}) };
    merged.settings = { ...d.settings, ...(state.settings || {}) };
    merged.favorites = state.favorites || {};
    merged.progress = state.progress || {};
    merged.achievements = state.achievements || {};
    merged.speedScores = { ...d.speedScores, ...(state.speedScores || {}) };
    merged.dailyLog = state.dailyLog || {};
    merged.quizHistory = state.quizHistory || [];
    return merged;
  }

  function load() {
    try {
      const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
      if (!raw) return defaultState();
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.warn('Storage load failed, starting fresh:', e);
      return defaultState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.warn('Storage save failed (quota or private mode):', e);
      return false;
    }
  }

  return { defaultState, load, save };
})();

/* ---------------------------------------------------------------------------
   DATA  (vocabulary content -- static, ships in cards.json / cards.js)
   --------------------------------------------------------------------------- */
const Data = (() => {
  async function load() {
    // Prefer a live fetch of cards.json (works great served over http/https,
    // e.g. a local dev server or GitHub Pages, and lets a curious user edit
    // cards.json and see it reflected). fetch() of local files is blocked by
    // browsers under file://, so we fall back to the pre-embedded copy from
    // cards.js in that case -- see index.html script order.
    if (location.protocol !== 'file:') {
      try {
        const res = await fetch('cards.json', { cache: 'no-cache' });
        if (res.ok) return await res.json();
      } catch (e) {
        console.warn('cards.json fetch failed, using embedded data:', e);
      }
    }
    if (window.EMBEDDED_CARDS_DATA) return window.EMBEDDED_CARDS_DATA;
    throw new Error('No vocabulary data available (cards.js missing?)');
  }
  return { load };
})();

/* ---------------------------------------------------------------------------
   SRS  (spaced repetition — Anki-style 4 button grading)
   --------------------------------------------------------------------------- */
const SRS = (() => {
  function makeDefaultRecord() {
    return {
      state: 'new', ease: CONFIG.SRS.EASE_START, intervalDays: 0,
      reps: 0, lapses: 0, correct: 0, wrong: 0,
      due: new Date().toISOString(), last: null, mastery: 0,
    };
  }

  function computeMastery(r) {
    if (r.reps === 0 && r.correct === 0 && r.wrong === 0) return 0;
    const totalAnswers = r.correct + r.wrong;
    const accuracy = totalAnswers ? r.correct / totalAnswers : 0;
    const intervalScore = Math.min(70, (Math.log2(r.intervalDays + 1) / Math.log2(61)) * 70);
    const accuracyScore = accuracy * 30;
    return Math.round(Utils.clamp(intervalScore + accuracyScore, 0, 100));
  }

  function gradeRecord(record, grade, now = new Date()) {
    const S = CONFIG.SRS;
    const r = { ...record };
    let learningMinutes = null;

    if (grade === 'again') {
      r.lapses += 1; r.wrong += 1;
      r.ease = Math.max(S.EASE_MIN, r.ease + S.AGAIN_EASE_DELTA);
      r.state = 'learning';
      r.intervalDays = 0;
      learningMinutes = S.LEARNING_STEP_MIN;
    } else {
      r.correct += 1;
      const graduating = (r.state === 'new' || r.state === 'learning');
      if (grade === 'hard') {
        r.ease = Math.max(S.EASE_MIN, r.ease + S.HARD_EASE_DELTA);
        r.intervalDays = graduating ? S.GRADUATING_DAYS : Math.max(1, Math.round(r.intervalDays * S.HARD_INTERVAL_MULT));
      } else if (grade === 'good') {
        r.intervalDays = graduating ? S.GRADUATING_DAYS : Math.max(1, Math.round(r.intervalDays * r.ease));
      } else if (grade === 'easy') {
        r.ease = r.ease + S.EASY_EASE_DELTA;
        r.intervalDays = graduating ? S.EASY_GRADUATING_DAYS : Math.max(S.EASY_GRADUATING_DAYS, Math.round(r.intervalDays * r.ease * S.EASY_INTERVAL_MULT));
      }
      r.state = 'review';
      r.reps += 1;
    }

    r.last = now.toISOString();
    r.due = (learningMinutes != null ? Utils.addMinutes(now, learningMinutes) : Utils.addDays(now, r.intervalDays)).toISOString();
    r.mastery = computeMastery(r);
    return r;
  }

  function formatInterval(record, learningMinutes) {
    if (learningMinutes != null) return `<${learningMinutes}m`;
    const d = record.intervalDays;
    if (d < 1) return `<${CONFIG.SRS.LEARNING_STEP_MIN}m`;
    if (d === 1) return '1d';
    if (d < 30) return `${d}d`;
    if (d < 365) return `${Math.round(d / 30)}mo`;
    return `${(d / 365).toFixed(1)}y`;
  }

  function previewIntervals(record) {
    return {
      again: `<${CONFIG.SRS.LEARNING_STEP_MIN}m`,
      hard: formatInterval(gradeRecord(record, 'hard')),
      good: formatInterval(gradeRecord(record, 'good')),
      easy: formatInterval(gradeRecord(record, 'easy')),
    };
  }

  function isDue(record, now = new Date()) {
    if (!record) return true;
    return new Date(record.due) <= now;
  }

  return { makeDefaultRecord, computeMastery, gradeRecord, previewIntervals, isDue };
})();

/* ---------------------------------------------------------------------------
   STORE  (single shared source of truth: persisted state + content + derived
   helpers). Exposed as a plain object -- simplicity over strict encapsulation
   since almost every module needs read/write access to the live state.
   --------------------------------------------------------------------------- */
const Store = {
  state: Storage.load(),
  cards: [],
  categories: [],
  cardsById: new Map(),
  cardsByCategory: new Map(),

  init(bundle) {
    this.cards = bundle.cards;
    this.categories = bundle.categories;
    this.cardsById = new Map(this.cards.map(c => [c.id, c]));
    this.cardsByCategory = new Map(this.categories.map(cat => [cat.slug, []]));
    this.cards.forEach(c => this.cardsByCategory.get(c.category).push(c));
    if (this.state.totalCardsCache !== this.cards.length) {
      this.state.totalCardsCache = this.cards.length;
    }
    this.rolloverDayIfNeeded();
  },

  persist() { Storage.save(this.state); },

  rolloverDayIfNeeded() {
    const today = Utils.todayStr();
    if (this.state.todayProgress.date !== today) {
      const last = this.state.streak.lastStudyDate;
      if (last) {
        const gap = Utils.daysBetweenStr(last, today);
        if (gap > 1) this.state.streak.current = 0;
      }
      this.state.todayProgress = { date: today, reviewed: 0, minutes: 0, goalMetToday: false };
      this.persist();
    }
  },

  getRecord(cardId) { return this.state.progress[cardId] || SRS.makeDefaultRecord(); },
  setRecord(cardId, record) { this.state.progress[cardId] = record; },

  isFavorite(cardId) { return !!this.state.favorites[cardId]; },
  toggleFavorite(cardId) {
    if (this.state.favorites[cardId]) delete this.state.favorites[cardId];
    else this.state.favorites[cardId] = true;
    this.persist();
    return this.isFavorite(cardId);
  },

  filterCards({ category, type, favoritesOnly } = {}) {
    let list = category ? (this.cardsByCategory.get(category) || []) : this.cards;
    if (type) list = list.filter(c => c.type === type);
    if (favoritesOnly) list = list.filter(c => this.state.favorites[c.id]);
    return list;
  },

  getDueCards(filter = {}) {
    const now = new Date();
    return this.filterCards(filter).filter(c => SRS.isDue(this.state.progress[c.id], now));
  },
  getNewCards(filter = {}) {
    return this.filterCards(filter).filter(c => !this.state.progress[c.id]);
  },

  get masteredCount() {
    let n = 0;
    for (const id in this.state.progress) if (this.state.progress[id].mastery >= CONFIG.MASTERY_MASTERED_THRESHOLD) n++;
    return n;
  },
  get learnedCount() {
    return Object.keys(this.state.progress).length; // any card with at least one review
  },
  get remainingCount() { return Math.max(0, this.cards.length - this.learnedCount); },
  get overallAccuracy() {
    let c = 0, w = 0;
    for (const id in this.state.progress) { c += this.state.progress[id].correct; w += this.state.progress[id].wrong; }
    const total = c + w;
    return total ? Math.round((c / total) * 100) : 0;
  },
  get totalStudyMinutes() {
    let m = 0;
    for (const day in this.state.dailyLog) m += this.state.dailyLog[day].minutes || 0;
    return m;
  },

  categoryMastery(slug) {
    const list = this.cardsByCategory.get(slug) || [];
    if (!list.length) return 0;
    const sum = list.reduce((acc, c) => acc + (this.state.progress[c.id]?.mastery || 0), 0);
    return Math.round(sum / list.length);
  },

  logActivity({ reviewed = 0, correct = 0, wrong = 0, minutes = 0, xp = 0 }) {
    const today = Utils.todayStr();
    if (!this.state.dailyLog[today]) this.state.dailyLog[today] = { reviewed: 0, correct: 0, wrong: 0, minutes: 0, xp: 0 };
    const log = this.state.dailyLog[today];
    log.reviewed += reviewed; log.correct += correct; log.wrong += wrong; log.minutes += minutes; log.xp += xp;
  },

  addXp(amount) { this.state.xp += amount; },

  getLevel(xp = this.state.xp) {
    let current = CONFIG.LEVELS[0], next = null;
    for (let i = 0; i < CONFIG.LEVELS.length; i++) {
      if (xp >= CONFIG.LEVELS[i].min) current = CONFIG.LEVELS[i];
      else { next = CONFIG.LEVELS[i]; break; }
    }
    return { current, next };
  },

  // returns true the first time today's goal is met (used to trigger streak + celebration)
  recordReviewForGoal() {
    const tp = this.state.todayProgress;
    tp.reviewed += 1;
    if (!tp.goalMetToday && tp.reviewed >= this.state.dailyGoal) {
      tp.goalMetToday = true;
      this.bumpStreak();
      return true;
    }
    return false;
  },

  bumpStreak() {
    const today = Utils.todayStr();
    const st = this.state.streak;
    if (st.lastStudyDate === today) return;
    const gap = st.lastStudyDate ? Utils.daysBetweenStr(st.lastStudyDate, today) : null;
    st.current = (gap === 1 || gap === null) ? st.current + 1 : 1;
    st.lastStudyDate = today;
    st.longest = Math.max(st.longest, st.current);
  },

  computeAchievementStats() {
    return {
      totalReviews: this.state.totalReviews,
      longestStreak: this.state.streak.longest,
      hadPerfectQuiz: !!this.state.hadPerfectQuizEver,
      masteredCount: this.masteredCount,
      totalCards: this.cards.length,
    };
  },

  checkAchievements() {
    const stats = this.computeAchievementStats();
    const unlocked = [];
    ACHIEVEMENTS.forEach(a => {
      if (!this.state.achievements[a.id] && a.check(stats)) {
        this.state.achievements[a.id] = new Date().toISOString();
        unlocked.push(a);
      }
    });
    return unlocked;
  },
};

/* ---------------------------------------------------------------------------
   SOUND  (tiny Web Audio synth -- no audio files, so nothing to fetch/cache)
   --------------------------------------------------------------------------- */
const Sound = (() => {
  let ctx = null;
  function ensureCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function enabled() { return Store.state.settings.sound; }
  function tone(freq, start, dur, type, peak) {
    const c = ensureCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, c.currentTime + start);
    gain.gain.linearRampToValueAtTime(peak, c.currentTime + start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(c.currentTime + start);
    osc.stop(c.currentTime + start + dur + 0.03);
  }
  function safe(fn) { if (!enabled()) return; try { fn(); } catch (e) { /* audio not available -- ignore */ } }

  return {
    flip: () => safe(() => tone(320, 0, 0.09, 'sine', 0.07)),
    tap: () => safe(() => tone(700, 0, 0.05, 'sine', 0.05)),
    correct: () => safe(() => { tone(523.25, 0, 0.11, 'sine', 0.15); tone(783.99, 0.09, 0.16, 'sine', 0.14); }),
    wrong: () => safe(() => tone(196, 0, 0.22, 'sawtooth', 0.08)),
    achievement: () => safe(() => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(f, i * 0.09, 0.18, 'sine', 0.13))),
    levelUp: () => safe(() => [392, 523.25, 659.25, 783.99].forEach((f, i) => tone(f, i * 0.1, 0.24, 'triangle', 0.15))),
  };
})();

/* ---------------------------------------------------------------------------
   TTS  (Web Speech API wrapper)
   --------------------------------------------------------------------------- */
const TTS = (() => {
  let voices = [];
  function refresh() { voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : []; return voices; }
  if (window.speechSynthesis) {
    refresh();
    window.speechSynthesis.onvoiceschanged = refresh;
  }
  function germanVoices() { return voices.filter(v => v.lang && v.lang.toLowerCase().startsWith('de')); }
  function pickVoice() {
    const uri = Store.state.settings.ttsVoiceURI;
    if (uri) { const v = voices.find(v => v.voiceURI === uri); if (v) return v; }
    return germanVoices()[0] || voices[0] || null;
  }
  function speak(text, opts = {}) {
    if (!window.speechSynthesis) { Toast.show({ title: 'Speech not supported', body: 'This browser has no speech synthesis.', icon: 'i-info' }); return false; }
    window.speechSynthesis.cancel();
    const slow = opts.slow != null ? opts.slow : Store.state.settings.slowMode;
    const repeat = opts.repeat != null ? opts.repeat : Store.state.settings.repeatMode;
    const clean = String(text).replace(/–/g, ',');
    const build = () => {
      const u = new SpeechSynthesisUtterance(clean);
      const v = pickVoice();
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'de-DE'; }
      u.rate = slow ? 0.62 : (Store.state.settings.ttsRate || 1);
      return u;
    };
    const u1 = build();
    if (repeat) u1.onend = () => setTimeout(() => window.speechSynthesis.speak(build()), 350);
    window.speechSynthesis.speak(u1);
    return true;
  }
  return { refresh, germanVoices, pickVoice, speak, list: () => voices };
})();

/* ---------------------------------------------------------------------------
   TOAST + CONFETTI
   --------------------------------------------------------------------------- */
const Toast = (() => {
  function show({ title, body = '', icon = 'i-info', variant = '', duration = 3400 }) {
    const stack = document.getElementById('toastStack');
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = `<svg class="icon toast__icon${variant ? ' toast__icon--' + variant : ''}"><use href="#${icon}"/></svg><span class="toast__body"><strong></strong><small></small></span>`;
    el.querySelector('strong').textContent = title;
    el.querySelector('small').textContent = body;
    stack.appendChild(el);
    setTimeout(() => { el.classList.add('is-leaving'); setTimeout(() => el.remove(), 260); }, duration);
  }
  return { show };
})();

const Confetti = (() => {
  const colors = ['#F2B134', '#2E7D8C', '#4FAE7A', '#9A7BEA', '#C1503F'];
  function burst(count = 30) {
    const layer = document.createElement('div');
    layer.className = 'confetti-layer';
    document.body.appendChild(layer);
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'confetti-piece';
      p.style.left = (Math.random() * 100) + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.35) + 's';
      p.style.transform = `rotate(${Math.random() * 360}deg)`;
      layer.appendChild(p);
    }
    setTimeout(() => layer.remove(), 2500);
  }
  return { burst };
})();

/* ---------------------------------------------------------------------------
   OVERLAY  (search / category / confirm / picker sheets)
   --------------------------------------------------------------------------- */
const Overlay = (() => {
  function open(id) { document.getElementById(id).hidden = false; }
  function close(id) { document.getElementById(id).hidden = true; }
  function confirmDialog({ title, message, okLabel = 'Confirm' }) {
    return new Promise(resolve => {
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMessage').textContent = message;
      const okBtn = document.getElementById('btnConfirmOk');
      const cancelBtn = document.getElementById('btnConfirmCancel');
      okBtn.textContent = okLabel;
      open('overlayConfirm');
      const cleanup = (result) => { close('overlayConfirm'); okBtn.onclick = null; cancelBtn.onclick = null; resolve(result); };
      okBtn.onclick = () => cleanup(true);
      cancelBtn.onclick = () => cleanup(false);
    });
  }
  return { open, close, confirmDialog };
})();

/* ---------------------------------------------------------------------------
   NAV  (top-level view switching)
   --------------------------------------------------------------------------- */
const Nav = (() => {
  let current = 'home';
  const onShow = {};
  function show(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('is-active', v.dataset.view === viewName));
    document.querySelectorAll('.bottom-nav__item').forEach(b => b.classList.toggle('is-active', b.dataset.view === viewName));
    current = viewName;
    if (onShow[viewName]) onShow[viewName]();
  }
  return { show, onShow, get current() { return current; } };
})();

/* ---------------------------------------------------------------------------
   LINE MAP  (signature visual — 15 categories as stations on a transit line)
   --------------------------------------------------------------------------- */
const LineMap = (() => {
  function render(container, onStationClick) {
    const categories = Store.categories;
    const cols = 4;
    const colW = 86, rowH = 84, marginX = 48, marginY = 34;
    const stations = categories.map((cat, i) => {
      const row = Math.floor(i / cols);
      const colRaw = i % cols;
      const col = row % 2 === 0 ? colRaw : (cols - 1 - colRaw);
      return { ...cat, x: marginX + col * colW, y: marginY + row * rowH };
    });
    const rows = Math.ceil(categories.length / cols);
    const width = marginX * 2 + (cols - 1) * colW;
    const height = marginY * 2 + (rows - 1) * rowH + 28;
    const pathD = 'M ' + stations.map(s => `${s.x},${s.y}`).join(' L ');

    const stationsSvg = stations.map(s => {
      const pct = Store.categoryMastery(s.slug);
      const hue = CONFIG.CATEGORY_HUES[s.slug] != null ? CONFIG.CATEGORY_HUES[s.slug] : 200;
      const outerR = 15, innerMaxR = 10.5;
      const innerR = pct <= 0 ? 0 : Math.max(3, (pct / 100) * innerMaxR);
      return `<g class="lm-station" data-slug="${s.slug}" transform="translate(${s.x},${s.y})" tabindex="0" role="button" aria-label="${Utils.escapeHtml(s.en)}, ${pct} percent mastered">
        <circle class="lm-station-bg" r="${outerR}"></circle>
        <circle class="lm-station-fill" r="${innerR}" style="fill:hsl(${hue} var(--cat-s) var(--cat-l))"></circle>
        <text class="lm-emoji" y="4" text-anchor="middle">${s.emoji}</text>
        <text y="${outerR + 15}" text-anchor="middle">${pct}%</text>
      </g>`;
    }).join('');

    container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Category mastery line map">
      <path class="lm-path" d="${pathD}"></path>
      ${stationsSvg}
    </svg>`;

    container.querySelectorAll('.lm-station').forEach(el => {
      const go = () => onStationClick(el.dataset.slug);
      el.addEventListener('click', go);
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    });
  }
  return { render };
})();

/* ---------------------------------------------------------------------------
   HOME
   --------------------------------------------------------------------------- */
const Home = (() => {
  function render() {
    const total = Store.cards.length;
    document.getElementById('statTotalCards').textContent = total;
    document.getElementById('statTotalSub').textContent = `${Store.masteredCount} mastered`;

    const goal = Store.state.dailyGoal;
    const reviewedToday = Store.state.todayProgress.reviewed;
    const pct = Utils.clamp(Math.round((reviewedToday / goal) * 100), 0, 100);
    document.getElementById('goalRing').style.setProperty('--pct', pct);
    document.getElementById('goalRingValue').textContent = reviewedToday;
    document.getElementById('goalRingTarget').textContent = goal;

    document.getElementById('statStreak').textContent = Store.state.streak.current;
    document.getElementById('topbarStreak').textContent = Store.state.streak.current;

    const { current, next } = Store.getLevel();
    document.getElementById('statLevelName').textContent = current.name;
    document.getElementById('statXp').textContent = `${Store.state.xp} XP`;
    const span = next ? next.min - current.min : 1;
    const into = next ? Store.state.xp - current.min : span;
    document.getElementById('statLevelBar').style.width = `${Utils.clamp(Math.round((into / span) * 100), 0, 100)}%`;

    const dueCount = Store.getDueCards().length;
    const newCount = Store.getNewCards().length;
    const contTitle = document.getElementById('continueTitle');
    const contSub = document.getElementById('continueSub');
    if (dueCount > 0) { contTitle.textContent = 'Continue learning'; contSub.textContent = `${dueCount} card${dueCount === 1 ? '' : 's'} due for review`; }
    else if (newCount > 0) { contTitle.textContent = 'Start studying'; contSub.textContent = `${newCount} new cards waiting`; }
    else { contTitle.textContent = 'Review anything'; contSub.textContent = 'All caught up — study freely'; }

    document.getElementById('dailyGoalText').textContent = `${reviewedToday} / ${goal} cards`;
    document.getElementById('dailyGoalBar').style.width = `${pct}%`;
    document.getElementById('dailyGoalTime').textContent = `${Utils.formatMinutes(Store.state.todayProgress.minutes)} studied today`;

    renderMiniChart();
    LineMap.render(document.getElementById('lineMap'), (slug) => CategoryDetail.open(slug));
  }

  function renderMiniChart() {
    const el = document.getElementById('miniChart');
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = Utils.addDays(new Date(), -i);
      const key = Utils.todayStr(d);
      const log = Store.state.dailyLog[key];
      days.push({ label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), reviewed: log ? log.reviewed : 0 });
    }
    const max = Math.max(1, ...days.map(d => d.reviewed));
    el.innerHTML = days.map(d => `<div class="mini-chart__col"><div class="mini-chart__bar" style="height:${Math.max(4, (d.reviewed / max) * 100)}%" title="${d.reviewed} reviews"></div><span class="mini-chart__label">${d.label}</span></div>`).join('');
    document.getElementById('weekTotalText').textContent = `${days.reduce((a, d) => a + d.reviewed, 0)} reviews`;
  }

  function init() { Nav.onShow.home = render; }
  return { render, init };
})();

/* ---------------------------------------------------------------------------
   CATEGORY DETAIL (overlay)
   --------------------------------------------------------------------------- */
const CategoryDetail = (() => {
  let currentSlug = null;

  function open(slug) {
    currentSlug = slug;
    const cat = Store.categories.find(c => c.slug === slug);
    document.getElementById('categoryHeadTitle').innerHTML = '';
    const strong = document.createElement('strong');
    strong.textContent = `${cat.emoji} ${cat.en}`;
    const small = document.createElement('small');
    small.textContent = cat.de;
    document.getElementById('categoryHeadTitle').append(strong, small);

    const cards = Store.cardsByCategory.get(slug);
    const mastery = Store.categoryMastery(slug);
    const due = Store.getDueCards({ category: slug }).length;
    document.getElementById('categoryDetailStats').innerHTML =
      `<div><strong>${cards.length}</strong><small>Cards</small></div><div><strong>${mastery}%</strong><small>Mastery</small></div><div><strong>${due}</strong><small>Due</small></div>`;

    renderList(cards);
    Overlay.open('overlayCategory');
  }

  function renderList(cards) {
    const wrap = document.getElementById('categoryCardList');
    wrap.innerHTML = '';
    const tpl = document.getElementById('tpl-search-row');
    cards.forEach(c => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.querySelector('.search-row__de').textContent = c.de;
      node.querySelector('.search-row__en').textContent = c.en;
      node.querySelector('.search-row__tag').textContent = (Store.isFavorite(c.id) ? '★ ' : '') + c.type;
      node.addEventListener('click', () => Search.previewCard(c));
      wrap.appendChild(node);
    });
  }

  function close() { Overlay.close('overlayCategory'); }
  function studyThisCategory() { close(); Study.startSession({ scope: 'category', category: currentSlug }); }

  return { open, close, studyThisCategory, get currentSlug() { return currentSlug; } };
})();

/* ---------------------------------------------------------------------------
   SEARCH (overlay)
   --------------------------------------------------------------------------- */
const Search = (() => {
  let query = '', typeFilter = 'all', favoritesOnly = false;

  function open() {
    document.getElementById('searchInput').value = '';
    query = '';
    render();
    Overlay.open('overlaySearch');
    setTimeout(() => document.getElementById('searchInput').focus(), 260);
  }
  function close() { Overlay.close('overlaySearch'); }

  function render() {
    const wrap = document.getElementById('searchResults');
    wrap.innerHTML = '';
    const q = query.trim().toLowerCase();
    if (!q && !favoritesOnly) { wrap.innerHTML = `<div class="search-empty">Start typing to search all ${Store.cards.length} cards…</div>`; return; }
    const results = Store.cards.filter(c => {
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (favoritesOnly && !Store.isFavorite(c.id)) return false;
      if (!q) return true;
      return c.de.toLowerCase().includes(q) || c.en.toLowerCase().includes(q);
    }).slice(0, 150);
    if (!results.length) { wrap.innerHTML = `<div class="search-empty">No matches for "${Utils.escapeHtml(query)}".</div>`; return; }
    const tpl = document.getElementById('tpl-search-row');
    results.forEach(c => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.querySelector('.search-row__de').textContent = c.de;
      node.querySelector('.search-row__en').textContent = c.en;
      node.querySelector('.search-row__tag').textContent = (Store.isFavorite(c.id) ? '★ ' : '') + c.type;
      node.addEventListener('click', () => previewCard(c));
      wrap.appendChild(node);
    });
  }
  function previewCard(c) { TTS.speak(c.de); }

  function init() {
    document.getElementById('btnSearch').addEventListener('click', open);
    document.getElementById('btnCloseSearch').addEventListener('click', close);
    document.getElementById('searchInput').addEventListener('input', Utils.debounce(e => { query = e.target.value; render(); }, 120));
    document.querySelectorAll('#searchTypeChips .chip').forEach(chip => {
      chip.addEventListener('click', () => {
        if (chip.dataset.favorites) {
          favoritesOnly = !favoritesOnly;
          chip.classList.toggle('is-active', favoritesOnly);
        } else {
          typeFilter = chip.dataset.type;
          document.querySelectorAll('#searchTypeChips .chip[data-type]').forEach(c2 => c2.classList.toggle('is-active', c2 === chip));
        }
        render();
      });
    });
  }
  return { init, open, close, previewCard };
})();

/* ---------------------------------------------------------------------------
   REWARDS  (centralised XP + level-up + achievement announcements)
   --------------------------------------------------------------------------- */
const Rewards = (() => {
  function xp(amount) {
    const before = Store.getLevel().current.name;
    Store.addXp(amount);
    const after = Store.getLevel().current.name;
    if (before !== after) {
      Sound.levelUp();
      Toast.show({ title: `Level up! You're now ${after}`, body: 'Keep the streak going.', icon: 'i-star', variant: 'success', duration: 4400 });
    }
  }
  function checkAchievements() {
    const unlocked = Store.checkAchievements();
    unlocked.forEach(a => {
      Sound.achievement();
      Toast.show({ title: `Achievement unlocked: ${a.name}`, body: a.desc, icon: a.icon, variant: 'success', duration: 4400 });
    });
    return unlocked;
  }
  return { xp, checkAchievements };
})();

/* ---------------------------------------------------------------------------
   CATEGORY PICKER (shared dialog)
   --------------------------------------------------------------------------- */
const CategoryPicker = (() => {
  let cb = null;
  function open(onSelect) {
    cb = onSelect;
    const wrap = document.getElementById('categoryPickerList');
    wrap.innerHTML = '';
    const tpl = document.getElementById('tpl-category-picker-row');
    Store.categories.forEach(cat => {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.querySelector('.category-picker-row__emoji').textContent = cat.emoji;
      node.querySelector('.category-picker-row__label').textContent = cat.en;
      node.querySelector('.category-picker-row__count').textContent = cat.total;
      node.addEventListener('click', () => { Overlay.close('overlayCategoryPicker'); cb && cb(cat.slug); });
      wrap.appendChild(node);
    });
    Overlay.open('overlayCategoryPicker');
  }
  function init() {
    document.getElementById('btnCategoryPickerCancel').addEventListener('click', () => Overlay.close('overlayCategoryPicker'));
  }
  return { open, init };
})();

/* ---------------------------------------------------------------------------
   STUDY  (flashcard sessions: setup -> session -> complete)
   --------------------------------------------------------------------------- */
const Study = (() => {
  let queue = [], index = 0, flipped = false;
  let scope = 'due', scopeCategory = null, direction = 'en-de';
  let sessionStats = { reviewed: 0, correct: 0, wrong: 0, xp: 0, lastActionTime: 0 };
  let lastTapTime = 0;

  function refreshSetupCounts() {
    document.getElementById('scopeDueSub').textContent = `${Store.getDueCards().length} cards due`;
    document.getElementById('scopeNewSub').textContent = `${Store.getNewCards().length} not yet studied`;
    document.getElementById('scopeFavSub').textContent = `${Object.keys(Store.state.favorites).length} saved`;
    document.getElementById('scopeCategorySub').textContent = scopeCategory ? Store.categories.find(c => c.slug === scopeCategory).en : 'Choose a category';
  }

  function showSetup() {
    document.getElementById('studySetup').hidden = false;
    document.getElementById('studySession').hidden = true;
    document.getElementById('sessionComplete').hidden = true;
    refreshSetupCounts();
  }

  function startSession(opts = {}) {
    scope = opts.scope || scope;
    if (opts.category !== undefined) scopeCategory = opts.category;
    direction = opts.direction || direction;

    let pool;
    if (scope === 'due') pool = Store.getDueCards();
    else if (scope === 'new') pool = Store.getNewCards();
    else if (scope === 'favorites') pool = Store.filterCards({ favoritesOnly: true });
    else if (scope === 'category') pool = Store.filterCards({ category: scopeCategory });
    else pool = Store.cards.slice();

    if (!pool.length) {
      Toast.show({ title: 'Nothing to study there', body: 'Try a different scope or check back later.', icon: 'i-info' });
      return;
    }
    queue = Utils.shuffle(pool);
    index = 0;
    sessionStats = { reviewed: 0, correct: 0, wrong: 0, xp: 0, lastActionTime: Date.now() };

    document.getElementById('studySetup').hidden = true;
    document.getElementById('sessionComplete').hidden = true;
    document.getElementById('studySession').hidden = false;
    renderCard();
  }

  function renderCard() {
    if (index >= queue.length || index < 0) { finishSession(); return; }
    const card = queue[index];
    flipped = false;
    const fc = document.getElementById('flashcard');
    fc.classList.remove('is-flipped');
    document.getElementById('gradeButtons').hidden = true;
    document.getElementById('btnRevealCard').hidden = false;

    const cat = Store.categories.find(c => c.slug === card.category);
    document.getElementById('cardCategoryTag').textContent = `${cat.emoji} ${cat.en}`;
    document.getElementById('cardTypeTag').textContent = card.type;

    const frontText = direction === 'en-de' ? card.en : card.de;
    const backText = direction === 'en-de' ? card.de : card.en;
    document.getElementById('cardFrontText').textContent = frontText;
    document.getElementById('cardBackText').textContent = backText;

    document.getElementById('btnFavCard').classList.toggle('is-active', Store.isFavorite(card.id));
    document.getElementById('sessionCount').textContent = `${index + 1}/${queue.length}`;
    document.getElementById('sessionProgressBar').style.width = `${Math.round((index / queue.length) * 100)}%`;

    const record = Store.getRecord(card.id);
    const preview = SRS.previewIntervals(record);
    document.getElementById('gradeAgainSub').textContent = preview.again;
    document.getElementById('gradeHardSub').textContent = preview.hard;
    document.getElementById('gradeGoodSub').textContent = preview.good;
    document.getElementById('gradeEasySub').textContent = preview.easy;
  }

  function toggleFlip() {
    flipped = !flipped;
    document.getElementById('flashcard').classList.toggle('is-flipped', flipped);
    document.getElementById('gradeButtons').hidden = !flipped;
    document.getElementById('btnRevealCard').hidden = flipped;
    Sound.flip();
  }

  function grade(gradeName) {
    if (index >= queue.length) return;
    const card = queue[index];
    const now = new Date();
    const newRecord = SRS.gradeRecord(Store.getRecord(card.id), gradeName, now);
    Store.setRecord(card.id, newRecord);

    const isCorrect = gradeName !== 'again';
    sessionStats.reviewed++;
    isCorrect ? sessionStats.correct++ : sessionStats.wrong++;

    let xpGain = CONFIG.XP.REVIEW + (isCorrect ? CONFIG.XP.CORRECT_BONUS : 0) + (gradeName === 'easy' ? CONFIG.XP.EASY_BONUS : 0);
    sessionStats.xp += xpGain;
    Rewards.xp(xpGain);

    Store.state.totalReviews++;
    const elapsedMin = Math.min(2, Math.max(0.05, (Date.now() - sessionStats.lastActionTime) / 60000));
    sessionStats.lastActionTime = Date.now();
    Store.state.todayProgress.minutes += elapsedMin;
    Store.logActivity({ reviewed: 1, correct: isCorrect ? 1 : 0, wrong: isCorrect ? 0 : 1, minutes: elapsedMin, xp: xpGain });

    const goalJustMet = Store.recordReviewForGoal();
    isCorrect ? Sound.correct() : Sound.wrong();
    if (navigator.vibrate && Store.state.settings.haptics) navigator.vibrate(isCorrect ? 12 : [10, 40, 10]);

    Rewards.checkAchievements();
    Store.persist();

    index++;
    renderCard();

    if (goalJustMet) {
      Rewards.xp(CONFIG.XP.DAILY_GOAL);
      Store.persist();
      Confetti.burst();
      Toast.show({ title: 'Daily goal complete! 🎉', body: `+${CONFIG.XP.DAILY_GOAL} XP bonus`, icon: 'i-check-circle', variant: 'success' });
    }
  }

  function flyOutAndAdvance(dir) {
    const fc = document.getElementById('flashcard');
    fc.style.transform = `translateX(${dir === 'left' ? '-140%' : '140%'}) rotate(${dir === 'left' ? -18 : 18}deg)`;
    fc.style.opacity = '0';
    setTimeout(() => {
      fc.classList.add('is-dragging');
      fc.style.transform = '';
      fc.style.opacity = '';
      index = dir === 'left' ? Math.min(index + 1, queue.length) : Math.max(index - 1, 0);
      renderCard();
      requestAnimationFrame(() => fc.classList.remove('is-dragging'));
    }, 300);
  }

  function handleTap() {
    const now = Date.now();
    if (now - lastTapTime < 300) toggleFavoriteCurrentCard();
    else toggleFlip();
    lastTapTime = now;
  }

  function pronounceCurrentCard() {
    const card = queue[index];
    if (!card) return;
    TTS.speak(card.de);
    const btn = document.getElementById('btnSayCard');
    btn.classList.add('is-speaking');
    setTimeout(() => btn.classList.remove('is-speaking'), 700);
  }

  function toggleFavoriteCurrentCard() {
    const card = queue[index];
    if (!card) return;
    const isFav = Store.toggleFavorite(card.id);
    document.getElementById('btnFavCard').classList.toggle('is-active', isFav);
    Toast.show({ title: isFav ? 'Added to favorites' : 'Removed from favorites', icon: 'i-star', duration: 1600 });
  }

  function initGestures() {
    const fc = document.getElementById('flashcard');
    let startX = 0, startY = 0, dragging = false, moved = false, longPressTimer = null, longPressFired = false;

    fc.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.card-icon-btn')) return;
      startX = e.clientX; startY = e.clientY;
      dragging = true; moved = false; longPressFired = false;
      fc.classList.add('is-dragging');
      longPressTimer = setTimeout(() => { longPressFired = true; pronounceCurrentCard(); }, 550);
      try { fc.setPointerCapture(e.pointerId); } catch (err) {}
    });
    fc.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { moved = true; clearTimeout(longPressTimer); }
      if (Math.abs(dx) > Math.abs(dy)) fc.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      clearTimeout(longPressTimer);
      const dx = (e.clientX != null ? e.clientX : startX) - startX;
      if (moved && Math.abs(dx) > 70) {
        fc.classList.remove('is-dragging');
        flyOutAndAdvance(dx < 0 ? 'left' : 'right');
      } else {
        fc.classList.remove('is-dragging');
        fc.style.transform = '';
        if (!moved && !longPressFired) handleTap();
      }
    }
    fc.addEventListener('pointerup', endDrag);
    fc.addEventListener('pointercancel', endDrag);
    fc.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFlip(); }
    });
  }

  function finishSession() {
    document.getElementById('studySession').hidden = true;
    document.getElementById('sessionComplete').hidden = false;
    const accuracy = sessionStats.reviewed ? Math.round((sessionStats.correct / sessionStats.reviewed) * 100) : 0;
    document.getElementById('completeReviewed').textContent = sessionStats.reviewed;
    document.getElementById('completeAccuracy').textContent = `${accuracy}%`;
    document.getElementById('completeXp').textContent = `+${sessionStats.xp}`;
    const tp = Store.state.todayProgress;
    document.getElementById('completeGoalMsg').textContent = tp.reviewed >= Store.state.dailyGoal
      ? `Daily goal complete — ${tp.reviewed}/${Store.state.dailyGoal} cards today!`
      : `${tp.reviewed}/${Store.state.dailyGoal} cards toward today's goal`;
    Store.persist();
  }

  function exitSession() {
    document.getElementById('studySession').hidden = true;
    document.getElementById('sessionComplete').hidden = true;
    showSetup();
    Store.persist();
  }

  function init() {
    Nav.onShow.study = showSetup;

    document.querySelectorAll('#studyScopeList .option-row').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = btn.dataset.scope;
        if (s === 'category') {
          CategoryPicker.open(slug => {
            scopeCategory = slug;
            scope = 'category';
            document.querySelectorAll('#studyScopeList .option-row').forEach(b => b.classList.toggle('is-selected', b === btn));
            refreshSetupCounts();
          });
          return;
        }
        scope = s;
        document.querySelectorAll('#studyScopeList .option-row').forEach(b => b.classList.toggle('is-selected', b === btn));
      });
    });
    document.querySelectorAll('#directionSegmented .segmented__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        direction = btn.dataset.dir;
        document.querySelectorAll('#directionSegmented .segmented__btn').forEach(b => b.classList.toggle('is-active', b === btn));
      });
    });
    document.getElementById('btnStartStudy').addEventListener('click', () => startSession());
    document.getElementById('btnRevealCard').addEventListener('click', toggleFlip);
    document.getElementById('btnExitSession').addEventListener('click', exitSession);
    document.querySelectorAll('#gradeButtons .grade-btn').forEach(btn => btn.addEventListener('click', () => grade(btn.dataset.grade)));
    document.getElementById('btnFavCard').addEventListener('click', (e) => { e.stopPropagation(); toggleFavoriteCurrentCard(); });
    document.getElementById('btnSayCard').addEventListener('click', (e) => { e.stopPropagation(); pronounceCurrentCard(); });
    document.getElementById('btnCompleteStudyMore').addEventListener('click', showSetup);
    document.getElementById('btnCompleteHome').addEventListener('click', () => Nav.show('home'));

    initGestures();
  }

  return {
    init, startSession, showSetup,
    grade, toggleFlip, toggleFavoriteCurrentCard, pronounceCurrentCard,
    get flipped() { return flipped; },
    get hasActiveSession() { return !document.getElementById('studySession').hidden; },
  };
})();

/* ---------------------------------------------------------------------------
   QUIZ  (Multiple Choice / Typing / Speed Challenge)
   --------------------------------------------------------------------------- */
const Quiz = (() => {
  let mode = null, speedDuration = 60, quizScope = 'all', quizScopeCategory = null;
  let pool = [], qIndex = 0, qTotal = 10, askedIds = new Set();
  let quizStats = { score: 0, correct: 0, wrong: 0, xp: 0, mistakes: [] };
  let currentCard = null, currentOptions = [];
  let speedTimerInterval = null, speedTimeLeft = 0;
  let typingAwaitingNext = false;

  function generateDistractors(card, srcPool, count) {
    let candidates = srcPool.filter(c => c.id !== card.id && c.category === card.category && c.type === card.type);
    if (candidates.length < count) candidates = srcPool.filter(c => c.id !== card.id && c.category === card.category);
    if (candidates.length < count) candidates = srcPool.filter(c => c.id !== card.id);
    return Utils.sample(candidates, Math.min(count, candidates.length));
  }

  function pickQuestionCard() {
    let candidates = pool.filter(c => !askedIds.has(c.id));
    if (!candidates.length) { askedIds.clear(); candidates = pool; }
    const card = Utils.pick(candidates);
    askedIds.add(card.id);
    return card;
  }

  function diffHtml(typed, correct) {
    const maxLen = Math.max(typed.length, correct.length);
    let out = '';
    for (let i = 0; i < maxLen; i++) {
      const c = correct[i] || '', t = typed[i] || '';
      out += (c && c.toLowerCase() === t.toLowerCase()) ? Utils.escapeHtml(c) : `<ins>${Utils.escapeHtml(c)}</ins>`;
    }
    return `You typed "${Utils.escapeHtml(typed)}" — correct: <span class="correction-word">${out}</span>`;
  }

  function showModeSelect() {
    document.getElementById('quizModeSelect').hidden = false;
    document.getElementById('quizResults').hidden = true;
    renderLeaderboard();
  }

  function start() {
    pool = quizScope === 'category' ? Store.filterCards({ category: quizScopeCategory })
      : quizScope === 'favorites' ? Store.filterCards({ favoritesOnly: true })
      : Store.cards.slice();
    if (pool.length < 4) { Toast.show({ title: 'Not enough cards', body: 'Pick a bigger scope (need at least 4).', icon: 'i-info' }); return; }

    quizStats = { score: 0, correct: 0, wrong: 0, xp: 0, mistakes: [] };
    askedIds = new Set();
    qIndex = 0;
    qTotal = Math.min(10, pool.length);
    document.getElementById('quizModeSelect').hidden = true;
    document.getElementById('quizResults').hidden = true;

    if (mode === 'mc') { document.getElementById('quizPlayMc').hidden = false; showMc(); }
    else if (mode === 'typing') { document.getElementById('quizPlayTyping').hidden = false; showTyping(); }
    else if (mode === 'speed') { document.getElementById('quizPlaySpeed').hidden = false; startSpeed(); }
  }

  // ---- Multiple choice ----
  function showMc() {
    if (qIndex >= qTotal) { finishQuiz(); return; }
    currentCard = pickQuestionCard();
    currentOptions = Utils.shuffle([currentCard, ...generateDistractors(currentCard, pool, 3)]);
    document.getElementById('mcPrompt').textContent = currentCard.en;
    document.getElementById('mcProgressBar').style.width = `${Math.round((qIndex / qTotal) * 100)}%`;
    document.getElementById('mcScoreLabel').textContent = quizStats.score;
    const wrap = document.getElementById('mcOptions');
    wrap.innerHTML = '';
    currentOptions.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      const span = document.createElement('span'); span.textContent = opt.de;
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      btn.appendChild(span);
      btn.innerHTML += '<svg class="icon quiz-option__icon"><use href="#i-check"/></svg>';
      btn.addEventListener('click', () => answerMc(opt, btn));
      wrap.appendChild(btn);
    });
  }
  function answerMc(opt, btn) {
    document.querySelectorAll('#mcOptions .quiz-option').forEach(b => b.classList.add('is-disabled'));
    const isCorrect = opt.id === currentCard.id;
    btn.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
    if (!isCorrect) {
      [...document.querySelectorAll('#mcOptions .quiz-option')].forEach(b => { if (b.querySelector('span').textContent === currentCard.de) b.classList.add('is-correct'); });
      quizStats.wrong++; quizStats.mistakes.push(currentCard);
      Sound.wrong();
    } else {
      quizStats.correct++; quizStats.score++;
      const g = CONFIG.XP.QUIZ_CORRECT; quizStats.xp += g; Rewards.xp(g);
      Sound.correct();
    }
    qIndex++;
    setTimeout(showMc, 950);
  }

  // ---- Typing ----
  function showTyping() {
    if (qIndex >= qTotal) { finishQuiz(); return; }
    currentCard = pickQuestionCard();
    typingAwaitingNext = false;
    document.getElementById('typingPrompt').textContent = currentCard.en;
    document.getElementById('typingProgressBar').style.width = `${Math.round((qIndex / qTotal) * 100)}%`;
    document.getElementById('typingScoreLabel').textContent = quizStats.score;
    const input = document.getElementById('typingInput');
    input.value = ''; input.disabled = false;
    document.getElementById('typingFeedback').hidden = true;
    document.getElementById('btnTypingCheck').textContent = 'Check';
    setTimeout(() => input.focus(), 60);
  }
  function submitTyping() {
    if (typingAwaitingNext) { qIndex++; showTyping(); return; }
    const input = document.getElementById('typingInput');
    const typed = input.value.trim();
    if (!typed) return;
    const isCorrect = Utils.similarity(typed, currentCard.de) >= 0.9;
    input.disabled = true;
    typingAwaitingNext = true;
    const fb = document.getElementById('typingFeedback');
    fb.hidden = false;
    fb.className = 'typing-feedback ' + (isCorrect ? 'is-correct' : 'is-wrong');
    if (isCorrect) {
      fb.innerHTML = `Correct! <small>${Utils.escapeHtml(currentCard.de)}</small>`;
      quizStats.correct++; quizStats.score++;
      const g = CONFIG.XP.QUIZ_CORRECT; quizStats.xp += g; Rewards.xp(g);
      Sound.correct();
    } else {
      fb.innerHTML = `Not quite <div class="correction">${diffHtml(typed, currentCard.de)}</div>`;
      quizStats.wrong++; quizStats.mistakes.push(currentCard);
      Sound.wrong();
    }
    document.getElementById('btnTypingCheck').textContent = (qIndex + 1 >= qTotal) ? 'See results' : 'Next';
  }

  // ---- Speed challenge ----
  function startSpeed() {
    speedTimeLeft = speedDuration;
    askedIds.clear();
    const timerEl = document.getElementById('speedTimer');
    timerEl.textContent = speedTimeLeft;
    timerEl.classList.remove('is-low');
    document.getElementById('speedScoreLabel').textContent = '0';
    showSpeedQuestion();
    clearInterval(speedTimerInterval);
    speedTimerInterval = setInterval(() => {
      speedTimeLeft--;
      timerEl.textContent = speedTimeLeft;
      if (speedTimeLeft <= 10) timerEl.classList.add('is-low');
      if (speedTimeLeft <= 0) { clearInterval(speedTimerInterval); finishQuiz(); }
    }, 1000);
  }
  function showSpeedQuestion() {
    currentCard = pickQuestionCard();
    currentOptions = Utils.shuffle([currentCard, ...generateDistractors(currentCard, pool, 3)]);
    document.getElementById('speedPrompt').textContent = currentCard.en;
    const wrap = document.getElementById('speedOptions');
    wrap.innerHTML = '';
    currentOptions.forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'quiz-option';
      const span = document.createElement('span'); span.textContent = opt.de;
      btn.appendChild(span);
      btn.addEventListener('click', () => answerSpeed(opt, btn));
      wrap.appendChild(btn);
    });
  }
  function answerSpeed(opt, btn) {
    if (speedTimeLeft <= 0) return;
    const isCorrect = opt.id === currentCard.id;
    document.querySelectorAll('#speedOptions .quiz-option').forEach(b => b.classList.add('is-disabled'));
    btn.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
    if (isCorrect) {
      quizStats.correct++; quizStats.score++;
      const g = CONFIG.XP.SPEED_CORRECT; quizStats.xp += g; Rewards.xp(g);
      document.getElementById('speedScoreLabel').textContent = quizStats.score;
      Sound.correct();
    } else {
      quizStats.wrong++; quizStats.mistakes.push(currentCard);
      Sound.wrong();
    }
    setTimeout(() => { if (speedTimeLeft > 0) showSpeedQuestion(); }, 420);
  }

  // ---- results ----
  function finishQuiz() {
    clearInterval(speedTimerInterval);
    document.getElementById('quizPlayMc').hidden = true;
    document.getElementById('quizPlayTyping').hidden = true;
    document.getElementById('quizPlaySpeed').hidden = true;

    const totalAnswered = quizStats.correct + quizStats.wrong;
    const accuracy = totalAnswered ? Math.round((quizStats.correct / totalAnswered) * 100) : 0;

    if (accuracy === 100 && totalAnswered >= 5) {
      Store.state.hadPerfectQuizEver = true;
      quizStats.xp += CONFIG.XP.PERFECT_QUIZ_BONUS;
      Rewards.xp(CONFIG.XP.PERFECT_QUIZ_BONUS);
    }
    const completionXp = CONFIG.XP.QUIZ_COMPLETE + (mode === 'speed' ? CONFIG.XP.SPEED_COMPLETE : 0);
    quizStats.xp += completionXp;
    Rewards.xp(completionXp);

    Store.logActivity({ xp: quizStats.xp, correct: quizStats.correct, wrong: quizStats.wrong });
    Rewards.checkAchievements();

    if (mode === 'speed') {
      const list = Store.state.speedScores[speedDuration] || (Store.state.speedScores[speedDuration] = []);
      list.push({ score: quizStats.score, correct: quizStats.correct, wrong: quizStats.wrong, date: Utils.todayStr() });
      list.sort((a, b) => b.score - a.score);
      Store.state.speedScores[speedDuration] = list.slice(0, 10);
    }
    Store.state.quizHistory.unshift({ mode, date: Utils.todayStr(), score: quizStats.score, accuracy, xp: quizStats.xp });
    Store.state.quizHistory = Store.state.quizHistory.slice(0, 30);
    Store.persist();

    document.getElementById('quizResultsTitle').textContent = mode === 'speed' ? 'Time is up!' : 'Quiz complete!';
    document.getElementById('quizResultsScore').textContent = mode === 'speed' ? quizStats.score : `${quizStats.correct}/${totalAnswered}`;
    document.getElementById('quizResultsAccuracy').textContent = `${accuracy}%`;
    document.getElementById('quizResultsXp').textContent = `+${quizStats.xp}`;

    const mistakesPanel = document.getElementById('mistakesPanel');
    if (quizStats.mistakes.length) {
      mistakesPanel.hidden = false;
      const list = document.getElementById('mistakesList');
      list.innerHTML = '';
      quizStats.mistakes.slice(0, 12).forEach(c => {
        const row = document.createElement('div');
        row.className = 'mistake-row';
        const strong = document.createElement('strong'); strong.textContent = c.de;
        const span = document.createElement('span'); span.textContent = c.en;
        row.append(strong, span);
        list.appendChild(row);
      });
    } else mistakesPanel.hidden = true;

    document.getElementById('quizResults').hidden = false;
    renderLeaderboard();
  }

  function renderLeaderboard() {
    const wrap = document.getElementById('leaderboardList');
    const list60 = Store.state.speedScores[60] || [], list120 = Store.state.speedScores[120] || [];
    if (!list60.length && !list120.length) { wrap.innerHTML = `<div class="leaderboard-empty">Play a Speed Challenge to set your first record.</div>`; return; }
    let html = '';
    [[60, list60], [120, list120]].forEach(([secs, list]) => {
      if (!list.length) return;
      html += `<div class="eyebrow" style="margin:${html ? '12px' : '0'} 0 4px">${secs} sec</div>`;
      list.slice(0, 5).forEach((entry, i) => {
        html += `<div class="leaderboard-row"><span class="leaderboard-row__rank">#${i + 1}</span><span class="leaderboard-row__main"><strong>${entry.score} correct</strong><small>${entry.date}</small></span><span class="leaderboard-row__score">${entry.correct}/${entry.correct + entry.wrong}</span></div>`;
      });
    });
    wrap.innerHTML = html;
  }

  function abortQuiz() {
    clearInterval(speedTimerInterval);
    document.getElementById('quizPlayMc').hidden = true;
    document.getElementById('quizPlayTyping').hidden = true;
    document.getElementById('quizPlaySpeed').hidden = true;
    showModeSelect();
  }

  function init() {
    Nav.onShow.quiz = showModeSelect;

    document.querySelectorAll('.mode-card').forEach(btn => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        document.querySelectorAll('.mode-card').forEach(b => b.classList.toggle('is-active', b === btn));
        document.getElementById('speedDurationPanel').hidden = (mode !== 'speed');
        const startBtn = document.getElementById('btnStartQuiz');
        startBtn.disabled = false;
        startBtn.textContent = mode === 'mc' ? 'Start Multiple Choice' : mode === 'typing' ? 'Start Typing Quiz' : 'Start Speed Challenge';
      });
    });
    document.querySelectorAll('#speedDurationSegmented .segmented__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        speedDuration = Number(btn.dataset.secs);
        document.querySelectorAll('#speedDurationSegmented .segmented__btn').forEach(b => b.classList.toggle('is-active', b === btn));
      });
    });
    document.querySelectorAll('#quizScopeSegmented .segmented__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = btn.dataset.scope;
        if (s === 'category') {
          CategoryPicker.open(slug => {
            quizScope = 'category'; quizScopeCategory = slug;
            document.querySelectorAll('#quizScopeSegmented .segmented__btn').forEach(b => b.classList.toggle('is-active', b === btn));
          });
          return;
        }
        quizScope = s;
        document.querySelectorAll('#quizScopeSegmented .segmented__btn').forEach(b => b.classList.toggle('is-active', b === btn));
      });
    });

    document.getElementById('btnStartQuiz').addEventListener('click', start);
    document.getElementById('btnExitMc').addEventListener('click', abortQuiz);
    document.getElementById('btnExitTyping').addEventListener('click', abortQuiz);
    document.getElementById('btnExitSpeed').addEventListener('click', abortQuiz);
    document.getElementById('btnTypingCheck').addEventListener('click', submitTyping);
    document.getElementById('typingInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitTyping(); } });
    document.getElementById('btnQuizPlayAgain').addEventListener('click', () => { document.getElementById('quizResults').hidden = true; start(); });
    document.getElementById('btnQuizHome').addEventListener('click', showModeSelect);
  }

  return { init, showModeSelect };
})();

/* ---------------------------------------------------------------------------
   STATS / PROGRESS VIEW
   --------------------------------------------------------------------------- */
const Stats = (() => {
  let chartRange = 'daily';

  function render() {
    const { current, next } = Store.getLevel();
    document.getElementById('progLevelName').textContent = current.name;
    document.getElementById('progLevelNext').textContent = next ? `${next.min - Store.state.xp} XP to ${next.name}` : 'Max level reached';
    const span = next ? next.min - current.min : 1;
    const into = next ? Store.state.xp - current.min : span;
    document.getElementById('progLevelBar').style.width = `${Utils.clamp(Math.round((into / span) * 100), 0, 100)}%`;
    document.getElementById('progXpTotal').textContent = `${Store.state.xp} XP total`;

    document.getElementById('progLearned').textContent = Store.learnedCount;
    document.getElementById('progMastered').textContent = Store.masteredCount;
    document.getElementById('progRemaining').textContent = Store.remainingCount;
    document.getElementById('progAccuracy').textContent = `${Store.overallAccuracy}%`;
    document.getElementById('progTime').textContent = Utils.formatMinutes(Store.totalStudyMinutes);
    document.getElementById('progStreak').textContent = Store.state.streak.current;

    renderChart();
    renderHeatmap();
    renderCategoryMastery();
    renderAchievements();
  }

  function renderChart() {
    const el = document.getElementById('statsChart');
    let bars = [];
    if (chartRange === 'daily') {
      for (let i = 13; i >= 0; i--) {
        const d = Utils.addDays(new Date(), -i);
        const log = Store.state.dailyLog[Utils.todayStr(d)];
        bars.push({ label: String(d.getDate()), value: log ? log.reviewed : 0 });
      }
    } else if (chartRange === 'weekly') {
      for (let w = 7; w >= 0; w--) {
        let sum = 0;
        for (let i = 0; i < 7; i++) {
          const d = Utils.addDays(new Date(), -(w * 7 + i));
          const log = Store.state.dailyLog[Utils.todayStr(d)];
          if (log) sum += log.reviewed;
        }
        bars.push({ label: `W${8 - w}`, value: sum });
      }
    } else {
      for (let m = 5; m >= 0; m--) {
        const d0 = new Date(); d0.setDate(1); d0.setMonth(d0.getMonth() - m);
        let sum = 0;
        Object.keys(Store.state.dailyLog).forEach(key => {
          const kd = Utils.dateFromStr(key);
          if (kd.getFullYear() === d0.getFullYear() && kd.getMonth() === d0.getMonth()) sum += Store.state.dailyLog[key].reviewed;
        });
        bars.push({ label: d0.toLocaleDateString(undefined, { month: 'short' }), value: sum });
      }
    }
    if (!bars.some(b => b.value > 0)) { el.innerHTML = `<div class="sc-empty">No activity yet — start a study session!</div>`; return; }
    const max = Math.max(1, ...bars.map(b => b.value));
    const barW = 26, gap = 10, baseline = 110, padL = 6;
    const width = bars.length * (barW + gap) + padL;
    const svgBars = bars.map((b, i) => {
      const h = Math.max(2, (b.value / max) * baseline);
      const x = padL + i * (barW + gap);
      return `<rect class="sc-bar" x="${x}" y="${baseline - h}" width="${barW}" height="${h}" rx="5"></rect><text class="sc-label" x="${x + barW / 2}" y="${baseline + 18}" text-anchor="middle">${b.label}</text>`;
    }).join('');
    el.innerHTML = `<svg viewBox="0 0 ${width} ${baseline + 30}">${svgBars}</svg>`;
  }

  function renderHeatmap() {
    const el = document.getElementById('streakHeatmap');
    const days = 91;
    let html = '';
    for (let i = days - 1; i >= 0; i--) {
      const d = Utils.addDays(new Date(), -i);
      const key = Utils.todayStr(d);
      const log = Store.state.dailyLog[key];
      const count = log ? log.reviewed : 0;
      let level = count > 0 ? 1 : 0;
      if (count >= 10) level = 2;
      if (count >= 20) level = 3;
      if (count >= 40) level = 4;
      html += `<div class="heatmap__cell" data-level="${level}" title="${key}: ${count} review${count === 1 ? '' : 's'}"></div>`;
    }
    el.innerHTML = html;
  }

  function renderCategoryMastery() {
    const el = document.getElementById('categoryMasteryList');
    const rows = Store.categories.map(cat => ({ ...cat, mastery: Store.categoryMastery(cat.slug) }));
    rows.sort((a, b) => b.mastery - a.mastery);
    const strongest = rows[0], weakest = rows[rows.length - 1];
    const anyProgress = rows.some(r => r.mastery > 0);
    document.getElementById('categoryMasterySub').textContent = anyProgress ? `Best: ${strongest.en} · Focus: ${weakest.en}` : 'Start studying to see mastery';
    el.innerHTML = rows.map(r => {
      const hue = CONFIG.CATEGORY_HUES[r.slug] != null ? CONFIG.CATEGORY_HUES[r.slug] : 200;
      let cls = 'cm-row';
      if (anyProgress && r === strongest) cls += ' cm-row--strongest';
      if (anyProgress && r === weakest && weakest !== strongest) cls += ' cm-row--weakest';
      return `<div class="${cls}" style="--hue:${hue}"><span class="cm-row__emoji">${r.emoji}</span><div class="cm-row__main"><div class="cm-row__head"><strong>${Utils.escapeHtml(r.en)}</strong><small>${r.mastery}%</small></div><div class="cm-row__bar"><div class="cm-row__bar-fill" style="width:${r.mastery}%"></div></div></div></div>`;
    }).join('');
  }

  function renderAchievements() {
    const el = document.getElementById('achievementsGrid');
    el.innerHTML = ACHIEVEMENTS.map(a => {
      const unlocked = !!Store.state.achievements[a.id];
      return `<div class="achievement ${unlocked ? 'is-unlocked' : 'is-locked'}"><svg class="icon icon--lg"><use href="#${unlocked ? a.icon : 'i-lock'}"/></svg><strong class="achievement__name">${a.name}</strong><small class="achievement__desc">${a.desc}</small></div>`;
    }).join('');
  }

  function init() {
    Nav.onShow.progress = render;
    document.querySelectorAll('#chartRangeSegmented .segmented__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        chartRange = btn.dataset.range;
        document.querySelectorAll('#chartRangeSegmented .segmented__btn').forEach(b => b.classList.toggle('is-active', b === btn));
        renderChart();
      });
    });
  }
  return { init, render };
})();

/* ---------------------------------------------------------------------------
   SETTINGS
   --------------------------------------------------------------------------- */
const Settings = (() => {
  function resolveMode(mode) {
    if (mode === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    return mode;
  }
  function applyTheme() {
    const resolved = resolveMode(Store.state.theme.mode);
    document.documentElement.setAttribute('data-theme', resolved);
    document.documentElement.setAttribute('data-accent', Store.state.theme.accent);
    if (Store.state.theme.highContrast) document.documentElement.setAttribute('data-contrast', 'high');
    else document.documentElement.removeAttribute('data-contrast');
    const meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0A1418' : '#EEF1F2');
  }

  function populateVoices() {
    const sel = document.getElementById('voiceSelect');
    const voices = TTS.list();
    const current = sel.value;
    sel.innerHTML = '<option value="">Auto (best German voice)</option>';
    voices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.voiceURI;
      opt.textContent = `${v.name} (${v.lang})`;
      if (Store.state.settings.ttsVoiceURI === v.voiceURI) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  function syncControlsFromState() {
    document.querySelectorAll('#modeSegmented .segmented__btn').forEach(b => b.classList.toggle('is-active', b.dataset.mode === Store.state.theme.mode));
    document.querySelectorAll('#accentSwatches .swatch').forEach(b => b.classList.toggle('is-active', b.dataset.accent === Store.state.theme.accent));
    document.getElementById('toggleHighContrast').checked = !!Store.state.theme.highContrast;
    document.querySelectorAll('#dailyGoalSegmented .segmented__btn').forEach(b => b.classList.toggle('is-active', Number(b.dataset.goal) === Store.state.dailyGoal));
    document.getElementById('toggleSlowMode').checked = !!Store.state.settings.slowMode;
    document.getElementById('toggleRepeatMode').checked = !!Store.state.settings.repeatMode;
    document.getElementById('toggleSound').checked = !!Store.state.settings.sound;
    document.getElementById('toggleHaptics').checked = !!Store.state.settings.haptics;
    populateVoices();
  }

  function applyAllFromState() {
    applyTheme();
    syncControlsFromState();
    Home.render();
    if (Nav.current === 'progress') Stats.render();
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(Store.state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `wortschatz-progress-${Utils.todayStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    Toast.show({ title: 'Progress exported', icon: 'i-download' });
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed || typeof parsed !== 'object' || !('progress' in parsed)) throw new Error('not a Wortschatz export');
        Store.state = { ...Storage.defaultState(), ...parsed };
        Store.persist();
        applyAllFromState();
        Toast.show({ title: 'Progress imported', icon: 'i-check-circle', variant: 'success' });
      } catch (e) {
        Toast.show({ title: 'Import failed', body: "That file doesn't look like a Wortschatz export.", icon: 'i-info' });
      }
    };
    reader.readAsText(file);
  }

  async function resetData() {
    const ok = await Overlay.confirmDialog({ title: 'Reset all progress?', message: 'This deletes every review, favorite, XP point and achievement on this device. This cannot be undone.', okLabel: 'Reset everything' });
    if (!ok) return;
    Store.state = Storage.defaultState();
    Store.persist();
    applyAllFromState();
    Toast.show({ title: 'Progress reset', icon: 'i-trash' });
  }

  function init() {
    document.querySelectorAll('#modeSegmented .segmented__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        Store.state.theme.mode = btn.dataset.mode;
        document.querySelectorAll('#modeSegmented .segmented__btn').forEach(b => b.classList.toggle('is-active', b === btn));
        applyTheme(); Store.persist();
      });
    });
    document.querySelectorAll('#accentSwatches .swatch').forEach(btn => {
      btn.addEventListener('click', () => {
        Store.state.theme.accent = btn.dataset.accent;
        document.querySelectorAll('#accentSwatches .swatch').forEach(b => b.classList.toggle('is-active', b === btn));
        applyTheme(); Store.persist();
      });
    });
    document.getElementById('toggleHighContrast').addEventListener('change', e => { Store.state.theme.highContrast = e.target.checked; applyTheme(); Store.persist(); });
    document.querySelectorAll('#dailyGoalSegmented .segmented__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        Store.state.dailyGoal = Number(btn.dataset.goal);
        document.querySelectorAll('#dailyGoalSegmented .segmented__btn').forEach(b => b.classList.toggle('is-active', b === btn));
        Store.persist(); Home.render();
      });
    });
    document.getElementById('voiceSelect').addEventListener('change', e => { Store.state.settings.ttsVoiceURI = e.target.value || null; Store.persist(); });
    document.getElementById('toggleSlowMode').addEventListener('change', e => { Store.state.settings.slowMode = e.target.checked; Store.persist(); });
    document.getElementById('toggleRepeatMode').addEventListener('change', e => { Store.state.settings.repeatMode = e.target.checked; Store.persist(); });
    document.getElementById('toggleSound').addEventListener('change', e => { Store.state.settings.sound = e.target.checked; Store.persist(); });
    document.getElementById('toggleHaptics').addEventListener('change', e => { Store.state.settings.haptics = e.target.checked; Store.persist(); });
    document.getElementById('btnTestVoice').addEventListener('click', () => TTS.speak('Guten Tag, wie geht es Ihnen?'));
    document.getElementById('btnExportData').addEventListener('click', exportData);
    document.getElementById('importDataInput').addEventListener('change', e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
    document.getElementById('btnResetData').addEventListener('click', resetData);
    if (window.speechSynthesis) window.speechSynthesis.addEventListener('voiceschanged', populateVoices);
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (Store.state.theme.mode === 'system') applyTheme(); });
    }
    syncControlsFromState();
    Nav.onShow.settings = syncControlsFromState;
  }

  return { init, applyTheme, syncControlsFromState };
})();

/* ---------------------------------------------------------------------------
   APP  (wires everything together; runs last)
   --------------------------------------------------------------------------- */
const App = (() => {
  let deferredInstallPrompt = null;

  function wireNav() {
    document.querySelectorAll('.bottom-nav__item').forEach(btn => {
      btn.addEventListener('click', () => Nav.show(btn.dataset.view));
    });
    document.getElementById('btnStreakChip').addEventListener('click', () => Nav.show('progress'));
    document.getElementById('btnContinueLearning').addEventListener('click', () => {
      Nav.show('study');
      const scope = Store.getDueCards().length ? 'due' : (Store.getNewCards().length ? 'new' : 'all');
      Study.startSession({ scope });
    });
    document.getElementById('btnFavoritesQuick').addEventListener('click', () => {
      Search.open();
      setTimeout(() => {
        const chip = document.querySelector('#searchTypeChips [data-favorites]');
        if (chip && !chip.classList.contains('is-active')) chip.click();
      }, 0);
    });
    document.getElementById('btnBrowseQuick').addEventListener('click', () => Search.open());
  }

  function wireCategoryOverlay() {
    document.getElementById('btnCloseCategory').addEventListener('click', CategoryDetail.close);
    document.getElementById('btnStudyThisCategory').addEventListener('click', CategoryDetail.studyThisCategory);
  }

  function wireKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        const overlays = ['overlaySearch', 'overlayCategory', 'overlayConfirm', 'overlayCategoryPicker'];
        for (const id of overlays) {
          const el = document.getElementById(id);
          if (!el.hidden) { el.hidden = true; return; }
        }
        if (Nav.current === 'study' && Study.hasActiveSession) Study.showSetup();
        return;
      }
      if (Nav.current !== 'study' || !Study.hasActiveSession) return;
      if (e.key === ' ') { e.preventDefault(); Study.toggleFlip(); }
      else if (['1', '2', '3', '4'].includes(e.key) && Study.flipped) {
        Study.grade({ 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' }[e.key]);
      } else if (e.key.toLowerCase() === 'f') Study.toggleFavoriteCurrentCard();
      else if (e.key.toLowerCase() === 'p') Study.pronounceCurrentCard();
    });
  }

  function wireInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstallPrompt = e;
      document.getElementById('installBanner').hidden = false;
    });
    document.getElementById('btnInstallApp').addEventListener('click', async () => {
      document.getElementById('installBanner').hidden = true;
      if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; }
    });
    document.getElementById('btnDismissInstall').addEventListener('click', () => { document.getElementById('installBanner').hidden = true; });
    window.addEventListener('appinstalled', () => { document.getElementById('installBanner').hidden = true; });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    const doRegister = () => navigator.serviceWorker.register('service-worker.js').catch(err => console.warn('Service worker registration failed:', err));
    // App.init() awaits an async data load first, so the window 'load' event may
    // already have fired by the time we get here -- register immediately in that case.
    if (document.readyState === 'complete') doRegister();
    else window.addEventListener('load', doRegister);
  }

  async function init() {
    Settings.applyTheme();
    try {
      const bundle = await Data.load();
      Store.init(bundle);
    } catch (e) {
      console.error('Failed to load vocabulary data:', e);
      document.getElementById('view-home').innerHTML = '<div class="empty-state"><strong>Could not load vocabulary data.</strong><p>Please reload the page. If this keeps happening, make sure cards.js is present next to index.html.</p></div>';
      document.getElementById('view-home').classList.add('is-active');
      return;
    }

    wireNav();
    wireCategoryOverlay();
    wireKeyboard();
    wireInstall();
    CategoryPicker.init();
    Search.init();
    Home.init();
    Study.init();
    Quiz.init();
    Stats.init();
    Settings.init();

    Nav.show('home');
    registerServiceWorker();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
