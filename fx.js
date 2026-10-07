/* fx.js — visual effects only (ripples, stagger, replays). no app logic touched */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // dot-matrix ripple from the press point
  const RIPPLE_SEL = '.btn-primary,.btn-outline,.gran-btn,.add-set-btn,.workout-row,.picker-row';
  document.addEventListener('pointerdown', (e) => {
    if (reduce) return;
    const el = e.target.closest(RIPPLE_SEL);
    if (!el || e.target.closest('.row-edit,.row-del')) return;
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const s = document.createElement('span');
    s.className = 'fx-ripple';
    s.style.width = s.style.height = size + 'px';
    s.style.left = (e.clientX - r.left - size / 2) + 'px';
    s.style.top = (e.clientY - r.top - size / 2) + 'px';
    el.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  }, { passive: true });

  // track when a view just opened
  let lastEnter = 0;
  const viewObs = new MutationObserver((muts) => {
    if (muts.some(m => m.target.classList.contains('active') && m.target.classList.contains('view-enter'))) {
      lastEnter = performance.now();
    }
  });
  document.querySelectorAll('.view').forEach(v => viewObs.observe(v, { attributes: true, attributeFilter: ['class'] }));

  // stagger index for list children
  const stamp = (el) => {
    [...el.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 10)));
  };

  // workout list re-renders on every edit, so only animate genuinely new sets
  let prevSets = [];
  const settle = (el) => {
    const cards = [...el.querySelectorAll('.exercise-card')];
    const counts = cards.map(c => c.querySelectorAll('.set-row').length);
    const fresh = performance.now() - lastEnter < 350;
    el.classList.toggle('settled', !fresh);
    if (!fresh && counts.length === prevSets.length) {
      cards.forEach((c, i) => {
        if (counts[i] > prevSets[i]) {
          const rows = c.querySelectorAll('.set-row');
          rows[rows.length - 1].classList.add('is-new');
        }
      });
    }
    prevSets = counts;
  };

  ['workoutList', 'exercisePickerList', 'analyticsExerciseList', 'workoutExerciseList', 'dataTableBody'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    new MutationObserver(() => {
      stamp(el);
      if (id === 'workoutExerciseList') settle(el);
    }).observe(el, { childList: true });
  });

  // redraw sweep when switching day/month/year
  document.querySelectorAll('.gran-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = document.getElementById('progressCanvas');
      c.classList.remove('fx-draw');
      void c.offsetWidth;
      c.classList.add('fx-draw');
    });
  });

  // ---------- page transitions (View Transitions API) ----------
  const DEPTH = { home: 0, analyticsList: 0, workout: 1, exercisePicker: 2, newExercise: 3, finalize: 2, analyticsDetail: 1 };
  const TAB = { home: 0, analyticsList: 1 };
  const orig = window.navigate;
  if (reduce || typeof orig !== 'function' || !document.startViewTransition) return;

  const root = document.documentElement;
  const setNav = (name) => document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === name));
  const rowTitle = () => document.querySelector(`[data-analytics-id="${state.analyticsExerciseId}"] .row-title`);
  let current = null;

  window.navigate = function (name) {
    const from = current;
    current = name;
    if (!from || from === name) return orig(name);

    const isTab = (name in TAB) && (from in TAB);
    root.dataset.vt = isTab
      ? (TAB[name] > TAB[from] ? 'tab-right' : 'tab-left')
      : ((DEPTH[name] ?? 0) >= (DEPTH[from] ?? 0) ? 'forward' : 'back');

    // app.js flips the nav classes before navigating — put the old one back so the pill can slide
    if (isTab) setNav(from);

    // exercise name morphs into / out of the header
    let morphFrom = null, morphTo = null;
    if (from === 'analyticsList' && name === 'analyticsDetail') morphFrom = rowTitle();
    if (from === 'analyticsDetail' && name === 'analyticsList') morphFrom = document.getElementById('analyticsDetailTitle');
    if (morphFrom) morphFrom.style.viewTransitionName = 'vt-title';

    const t = document.startViewTransition(async () => {
      if (morphFrom) morphFrom.style.viewTransitionName = '';
      if (isTab) setNav(name);
      await orig(name);
      if (morphFrom) {
        morphTo = name === 'analyticsDetail' ? document.getElementById('analyticsDetailTitle') : rowTitle();
        if (morphTo) morphTo.style.viewTransitionName = 'vt-title';
      }
    });
    t.finished.finally(() => { if (morphTo) morphTo.style.viewTransitionName = ''; });
    return t.updateCallbackDone;
  };
})();
