/* ============================================================
   Workout Tracker — vanilla JS, IndexedDB storage, offline/local.
   ============================================================ */

// database layer: opens + versioned stores
/* ---------------- IndexedDB layer ---------------- */

const DB_NAME = 'workoutTrackerDB';
const DB_VERSION = 1;
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const _db = e.target.result;
      if (!_db.objectStoreNames.contains('exercises')) {
        _db.createObjectStore('exercises', { keyPath: 'id', autoIncrement: true });
      }
      if (!_db.objectStoreNames.contains('workouts')) {
        _db.createObjectStore('workouts', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

// wrapper: get an object store handle
function tx(storeName, mode) {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function dbGetAll(storeName) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readonly').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbGet(storeName, id) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readonly').get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbAdd(storeName, obj) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').add(obj);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbPut(storeName, obj) {
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').put(obj);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// shared in-memory app state
/* ---------------- App state ---------------- */

const state = {
  currentWorkout: null,       // {id, name, date, exercises:[{exerciseId, sets:[{kg,reps}]}]}
  editingLibraryExerciseId: null,
  tempImageData: null,        // compressed dataURL for exercise being created/edited, before save
  analyticsExerciseId: null,
  analyticsGranularity: 'day',
  exercisesCache: [],
  workoutsCache: []
};

function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

async function refreshExercisesCache() {
  state.exercisesCache = await dbGetAll('exercises');
  return state.exercisesCache;
}

async function refreshWorkoutsCache() {
  state.workoutsCache = await dbGetAll('workouts');
  return state.workoutsCache;
}

// linear lookup in cached list
function getExerciseById(id) {
  return state.exercisesCache.find(e => e.id === id);
}

// single-page navigation between views
/* ---------------- Navigation ---------------- */

const views = ['home', 'workout', 'exercisePicker', 'newExercise', 'finalize', 'analyticsList', 'analyticsDetail'];

async function navigate(name) {
  views.forEach(v => document.getElementById('view-' + v).classList.remove('active'));
  const target = document.getElementById('view-' + name);
  target.classList.add('active');
  // force reflow so the enter animation replays every time this view is shown
  target.classList.remove('view-enter');
  void target.offsetWidth;
  target.classList.add('view-enter');

  if (name === 'home') await renderHome();
  if (name === 'workout') renderWorkout();
  if (name === 'exercisePicker') await renderExercisePicker();
  if (name === 'newExercise') renderNewExercise();
  if (name === 'finalize') renderFinalize();
  if (name === 'analyticsList') await renderAnalyticsList();
  if (name === 'analyticsDetail') await renderAnalyticsDetail();
}

// reusable inline svg icons
/* ---------------- Icons (small inline helpers) ---------------- */

const ICON_PLACEHOLDER = `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="1" stroke-width="1.5" fill="none"/><circle cx="8.5" cy="10.5" r="1.5"/><path d="M21 15l-5-5-9 9" stroke-width="1.5" fill="none"/></svg>`;
const ICON_PENCIL = `<svg viewBox="0 0 24 24"><path d="M4 20l1-4L16 5l3 3L8 19l-4 1z" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_TRASH = `<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_X = `<svg viewBox="0 0 24 24"><path d="M6 6l6 6-6 6M18 6l-6 6 6 6" stroke-width="1.5"/></svg>`;

// home: render list of saved workouts
/* ============================================================
   HOME
   ============================================================ */

async function renderHome() {
  await refreshWorkoutsCache();
  const listEl = document.getElementById('workoutList');
  const sorted = [...state.workoutsCache].sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));

  if (sorted.length === 0) {
    listEl.innerHTML = '<div class="empty-msg">No workouts logged yet.</div>';
    return;
  }

  listEl.innerHTML = sorted.map(w => `
    <div class="workout-row" data-id="${w.id}">
      <div class="row-thumb">${ICON_PLACEHOLDER}</div>
      <div class="row-main">
        <div class="row-title">${escapeHtml(w.name || 'Workout')}</div>
        <div class="row-sub">${formatDateDisplay(w.date)}</div>
      </div>
      <button class="row-edit" data-edit-workout="${w.id}">${ICON_PENCIL}</button>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-edit-workout]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.getAttribute('data-edit-workout'));
      const w = await dbGet('workouts', id);
      state.currentWorkout = JSON.parse(JSON.stringify(w));
      await refreshExercisesCache();
      navigate('workout');
    });
  });
}

document.getElementById('btnStartWorkout').addEventListener('click', () => {
  state.currentWorkout = { id: null, name: '', date: todayStr(), exercises: [] };
  navigate('workout');
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll(`.nav-btn[data-nav="${btn.dataset.nav}"]`).forEach(b => b.classList.add('active'));
    navigate(btn.dataset.nav);
  });
});

// workout screen: render exercises, bind set inputs
/* ============================================================
   WORKOUT IN PROGRESS (screens 4 + 5)
   ============================================================ */

function renderWorkout() {
  const w = state.currentWorkout;
  document.getElementById('workoutTopTitle').textContent = w.name || 'Workout';
  const listEl = document.getElementById('workoutExerciseList');

  if (w.exercises.length === 0) {
    listEl.innerHTML = '<div class="empty-msg">No exercises yet.<br>Tap "+ Exercise" to begin.</div>';
    return;
  }

  listEl.innerHTML = w.exercises.map((we, exIdx) => {
    const ex = getExerciseById(we.exerciseId);
    const name = ex ? ex.name : '(deleted exercise)';
    const img = ex && ex.image ? `<img src="${ex.image}">` : ICON_PLACEHOLDER;
    const setsHtml = we.sets.map((s, setIdx) => `
      <div class="set-row">
        <span class="set-label">${setIdx + 1}</span>
        <input type="number" inputmode="decimal" placeholder="KG" value="${s.kg}" data-ex="${exIdx}" data-set="${setIdx}" data-field="kg">
        <input type="number" inputmode="numeric" placeholder="Reps" value="${s.reps}" data-ex="${exIdx}" data-set="${setIdx}" data-field="reps">
        <button class="set-remove" data-remove-set="${exIdx}:${setIdx}">${ICON_X}</button>
      </div>
    `).join('');

    return `
      <div class="exercise-card">
        <div class="exercise-card-head">
          <div class="row-thumb">${img}</div>
          <div class="row-main">
            <div class="row-title">${escapeHtml(name)}</div>
          </div>
          <button class="exercise-del" data-remove-exercise="${exIdx}">${ICON_TRASH}</button>
        </div>
        ${setsHtml}
        <button class="add-set-btn" data-add-set="${exIdx}">+ Add Set</button>
      </div>
    `;
  }).join('');

  // bind set value inputs
  listEl.querySelectorAll('input[data-field]').forEach(inp => {
    inp.addEventListener('input', () => {
      const exIdx = Number(inp.dataset.ex);
      const setIdx = Number(inp.dataset.set);
      w.exercises[exIdx].sets[setIdx][inp.dataset.field] = inp.value;
    });
  });

  // add set
  listEl.querySelectorAll('[data-add-set]').forEach(btn => {
    btn.addEventListener('click', () => {
      const exIdx = Number(btn.dataset.addSet);
      w.exercises[exIdx].sets.push({ kg: '', reps: '' });
      renderWorkout();
    });
  });

  // remove set
  listEl.querySelectorAll('[data-remove-set]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [exIdx, setIdx] = btn.dataset.removeSet.split(':').map(Number);
      w.exercises[exIdx].sets.splice(setIdx, 1);
      if (w.exercises[exIdx].sets.length === 0) w.exercises[exIdx].sets.push({ kg: '', reps: '' });
      renderWorkout();
    });
  });

  // remove exercise from this workout
  listEl.querySelectorAll('[data-remove-exercise]').forEach(btn => {
    btn.addEventListener('click', () => {
      const exIdx = Number(btn.dataset.removeExercise);
      w.exercises.splice(exIdx, 1);
      renderWorkout();
    });
  });
}

document.getElementById('btnAddExercise').addEventListener('click', () => {
  navigate('exercisePicker');
});

document.getElementById('btnDiscardWorkout').addEventListener('click', () => {
  const w = state.currentWorkout;
  const hasData = w.exercises.length > 0;
  if (hasData && !confirm('Discard this workout? Anything entered will be lost.')) return;
  state.currentWorkout = null;
  navigate('home');
});

document.getElementById('btnFinalizeWorkout').addEventListener('click', () => {
  if (state.currentWorkout.exercises.length === 0) {
    alert('Add at least one exercise before finishing.');
    return;
  }
  navigate('finalize');
});

// picker: searchable library, last-session hints
/* ============================================================
   EXERCISE PICKER (screen 2)
   ============================================================ */

async function renderExercisePicker() {
  await refreshExercisesCache();
  await refreshWorkoutsCache();
  document.getElementById('workoutNameInput').value = state.currentWorkout.name || '';
  document.getElementById('exerciseSearch').value = '';
  renderExercisePickerList('');
}

/* Most recent workout (with at least one logged set) that used this exercise */
// scans workouts newest-first for last logged sets
function getLastSessionForExercise(exerciseId) {
  const uses = state.workoutsCache
    .filter(w => w.exercises.some(x => x.exerciseId === exerciseId))
    .sort((a, b) => ((a.date || '') + (a.createdAt || '')).localeCompare((b.date || '') + (b.createdAt || '')));
  for (let i = uses.length - 1; i >= 0; i--) {
    const we = uses[i].exercises.find(x => x.exerciseId === exerciseId);
    const sets = (we.sets || []).filter(s => s.kg !== '' && s.kg != null || s.reps !== '' && s.reps != null);
    if (sets.length) return { date: uses[i].date, sets };
  }
  return null;
}

function lastPerformedHtml(ex) {
  const last = getLastSessionForExercise(ex.id);
  if (!last) return '';
  const parts = last.sets.slice(-3).map(s => {
    const kg = (s.kg === '' || s.kg == null) ? '–' : s.kg;
    const reps = (s.reps === '' || s.reps == null) ? '–' : s.reps;
    return `${kg}kg × ${reps}`;
  }).join(', ');
  return `<div class="row-sub last-sub">Last: ${formatDateDisplay(last.date)} · ${parts}</div>`;
}

function renderExercisePickerList(filter) {
  const listEl = document.getElementById('exercisePickerList');
  const f = filter.trim().toLowerCase();
  const items = state.exercisesCache
    .filter(e => !e.deleted)
    .filter(e => !f || e.name.toLowerCase().includes(f))
    .sort((a, b) => a.name.localeCompare(b.name));

  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty-msg">No exercises. Tap + to add one.</div>';
    return;
  }

  listEl.innerHTML = items.map(ex => `
    <div class="picker-row" data-select-id="${ex.id}">
      <div class="row-thumb">${ex.image ? `<img src="${ex.image}">` : ICON_PLACEHOLDER}</div>
      <div class="row-main">
        <div class="row-title">${escapeHtml(ex.name)}</div>
        <div class="row-sub">${escapeHtml(ex.muscle || '')}</div>
        ${lastPerformedHtml(ex)}
      </div>
      <button class="row-edit" data-edit-id="${ex.id}">${ICON_PENCIL}</button>
      <button class="row-del" data-del-id="${ex.id}">${ICON_TRASH}</button>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-select-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-edit-id]') || e.target.closest('[data-del-id]')) return;
      const id = Number(row.dataset.selectId);
      addExerciseToWorkout(id);
    });
  });

  listEl.querySelectorAll('[data-edit-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.editingLibraryExerciseId = Number(btn.dataset.editId);
      state.tempImageData = null;
      navigate('newExercise');
    });
  });

  listEl.querySelectorAll('[data-del-id]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.delId);
      const ex = getExerciseById(id);
      if (!confirm(`Delete "${ex.name}"? It will be removed everywhere it's used.`)) return;
      ex.deleted = true;
      await dbPut('exercises', ex);
      await refreshExercisesCache();
      renderExercisePickerList(document.getElementById('exerciseSearch').value);
    });
  });
}

function addExerciseToWorkout(exerciseId) {
  const w = state.currentWorkout;
  const already = w.exercises.find(we => we.exerciseId === exerciseId);
  if (!already) {
    const last = getLastSessionForExercise(exerciseId);
    const lastSet = last ? last.sets[last.sets.length - 1] : null;
    w.exercises.push({
      exerciseId,
      sets: [{
        kg: (lastSet && lastSet.kg !== '' && lastSet.kg != null) ? String(lastSet.kg) : '',
        reps: (lastSet && lastSet.reps !== '' && lastSet.reps != null) ? String(lastSet.reps) : ''
      }]
    });
  }
  navigate('workout');
}

document.getElementById('exerciseSearch').addEventListener('input', (e) => {
  renderExercisePickerList(e.target.value);
});

document.getElementById('workoutNameInput').addEventListener('input', (e) => {
  state.currentWorkout.name = e.target.value;
});

document.getElementById('btnPickerBack').addEventListener('click', () => navigate('workout'));
document.getElementById('btnPickerAdd').addEventListener('click', () => {
  state.editingLibraryExerciseId = null;
  state.tempImageData = null;
  navigate('newExercise');
});

// exercise form: name, muscle, compressed image
/* ============================================================
   NEW / EDIT EXERCISE (screen 3)
   ============================================================ */

function renderNewExercise() {
  const editing = state.editingLibraryExerciseId != null;
  document.getElementById('newExerciseTitle').textContent = editing ? 'Edit Exercise' : 'New Exercise';

  const nameInput = document.getElementById('exerciseNameInput');
  const muscleInput = document.getElementById('exerciseMuscleInput');
  const preview = document.getElementById('exerciseImagePreview');
  const placeholder = document.getElementById('exerciseImagePlaceholder');

  if (editing) {
    const ex = getExerciseById(state.editingLibraryExerciseId);
    nameInput.value = ex.name || '';
    muscleInput.value = ex.muscle || '';
    state.tempImageData = ex.image || null;
  } else {
    nameInput.value = '';
    muscleInput.value = '';
  }

  if (state.tempImageData) {
    preview.src = state.tempImageData;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
  } else {
    preview.style.display = 'none';
    placeholder.style.display = 'block';
  }
}

document.getElementById('exerciseImagePicker').addEventListener('click', () => {
  document.getElementById('exerciseImageInput').click();
});

document.getElementById('exerciseImageInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const compressed = await compressImage(file, 300, 0.6);
  state.tempImageData = compressed;
  const preview = document.getElementById('exerciseImagePreview');
  preview.src = compressed;
  preview.style.display = 'block';
  document.getElementById('exerciseImagePlaceholder').style.display = 'none';
});

// downscales image to dataURL for storage
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) {
        height = Math.round(height * (maxDim / width));
        width = maxDim;
      } else if (height > maxDim) {
        width = Math.round(width * (maxDim / height));
        height = maxDim;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = url;
  });
}

document.getElementById('btnNewExerciseClose').addEventListener('click', () => {
  state.editingLibraryExerciseId = null;
  state.tempImageData = null;
  navigate('exercisePicker');
});

document.getElementById('btnSubmitExercise').addEventListener('click', async () => {
  const name = document.getElementById('exerciseNameInput').value.trim();
  const muscle = document.getElementById('exerciseMuscleInput').value.trim();
  if (!name) { alert('Give the exercise a name.'); return; }

  if (state.editingLibraryExerciseId != null) {
    const ex = getExerciseById(state.editingLibraryExerciseId);
    ex.name = name;
    ex.muscle = muscle;
    ex.image = state.tempImageData || null;
    await dbPut('exercises', ex);
  } else {
    await dbAdd('exercises', {
      name, muscle,
      image: state.tempImageData || null,
      deleted: false,
      createdAt: new Date().toISOString()
    });
  }
  state.editingLibraryExerciseId = null;
  state.tempImageData = null;
  navigate('exercisePicker');
});

// save or update the workout record
/* ============================================================
   FINALIZE WORKOUT (screen 6)
   ============================================================ */

function renderFinalize() {
  document.getElementById('finalizeNameInput').value = state.currentWorkout.name || '';
  document.getElementById('finalizeDateInput').value = state.currentWorkout.date || todayStr();
}

document.getElementById('finalizeNameInput').addEventListener('input', (e) => {
  state.currentWorkout.name = e.target.value;
});
document.getElementById('finalizeDateInput').addEventListener('input', (e) => {
  state.currentWorkout.date = e.target.value;
});

document.getElementById('btnFinalizeBack').addEventListener('click', () => navigate('workout'));

document.getElementById('btnEndWorkout').addEventListener('click', async () => {
  const w = state.currentWorkout;
  if (!w.name.trim()) w.name = 'Workout';
  if (!w.date) w.date = todayStr();

  // normalize numeric set values, drop fully-empty trailing sets
  w.exercises.forEach(we => {
    we.sets = we.sets
      .filter(s => s.kg !== '' || s.reps !== '')
      .map(s => ({ kg: s.kg === '' ? null : Number(s.kg), reps: s.reps === '' ? null : Number(s.reps) }));
    if (we.sets.length === 0) we.sets.push({ kg: null, reps: null });
  });

  const now = new Date().toISOString();
  if (w.id == null) {
    delete w.id;
    w.createdAt = now;
    w.updatedAt = now;
    await dbAdd('workouts', w);
  } else {
    w.updatedAt = now;
    await dbPut('workouts', w);
  }

  state.currentWorkout = null;
  navigate('home');
});

// progress: pick an exercise to inspect
/* ============================================================
   ANALYTICS LIST (screen 7)
   ============================================================ */

async function renderAnalyticsList() {
  await refreshExercisesCache();
  const listEl = document.getElementById('analyticsExerciseList');
  const items = state.exercisesCache.filter(e => !e.deleted).sort((a, b) => a.name.localeCompare(b.name));

  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty-msg">No exercises yet.</div>';
    return;
  }

  listEl.innerHTML = items.map(ex => `
    <div class="picker-row" data-analytics-id="${ex.id}">
      <div class="row-thumb">${ex.image ? `<img src="${ex.image}">` : ICON_PLACEHOLDER}</div>
      <div class="row-main">
        <div class="row-title">${escapeHtml(ex.name)}</div>
        <div class="row-sub">${escapeHtml(ex.muscle || '')}</div>
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('[data-analytics-id]').forEach(row => {
    row.addEventListener('click', () => {
      state.analyticsExerciseId = Number(row.dataset.analyticsId);
      state.analyticsGranularity = 'day';
      document.querySelectorAll('.gran-btn').forEach(b => b.classList.toggle('active', b.dataset.gran === 'day'));
      navigate('analyticsDetail');
    });
  });
}

// detail: best kg per session, grouped chart
/* ============================================================
   ANALYTICS DETAIL (screen 8)
   ============================================================ */

async function renderAnalyticsDetail() {
  await refreshWorkoutsCache();
  const ex = getExerciseById(state.analyticsExerciseId);
  document.getElementById('analyticsDetailTitle').textContent = ex ? ex.name : 'Exercise';

  // gather one data point per workout session that used this exercise: best (max) kg that session
  const sessions = [];
  state.workoutsCache.forEach(w => {
    const we = w.exercises.find(x => x.exerciseId === state.analyticsExerciseId);
    if (!we) return;
    const kgs = we.sets.map(s => s.kg).filter(k => typeof k === 'number' && !isNaN(k));
    if (kgs.length === 0) return;
    sessions.push({ date: w.date, kg: Math.max(...kgs) });
  });
  sessions.sort((a, b) => a.date.localeCompare(b.date));

  // table: most recent first
  const tbody = document.getElementById('dataTableBody');
  tbody.innerHTML = [...sessions].reverse().map(s => `
    <tr><td>${formatDateDisplay(s.date)}</td><td>${s.kg}</td></tr>
  `).join('') || '<tr><td colspan="2" class="empty-msg">No data yet</td></tr>';

  drawGraph(sessions, state.analyticsGranularity);
}

document.querySelectorAll('.gran-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.gran-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.analyticsGranularity = btn.dataset.gran;
    renderAnalyticsDetail();
  });
});

document.getElementById('btnAnalyticsBack').addEventListener('click', () => navigate('analyticsList'));

// buckets sessions by day/month/year, averages kg
function groupSessions(sessions, granularity) {
  if (granularity === 'day') {
    return sessions.map(s => ({ label: formatDateShort(s.date), kg: s.kg }));
  }
  const buckets = {};
  sessions.forEach(s => {
    const key = granularity === 'month' ? s.date.slice(0, 7) : s.date.slice(0, 4);
    if (!buckets[key]) buckets[key] = [];
    buckets[key].push(s.kg);
  });
  return Object.keys(buckets).sort().map(key => {
    const vals = buckets[key];
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    let label = key;
    if (granularity === 'month') {
      const [y, m] = key.split('-');
      label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
    }
    return { label, kg: Math.round(avg * 10) / 10 };
  });
}

// draws line chart on canvas with dpr scaling
function drawGraph(sessions, granularity) {
  const canvas = document.getElementById('progressCanvas');
  const emptyEl = document.getElementById('graphEmpty');
  const points = groupSessions(sessions, granularity);

  if (points.length === 0) {
    emptyEl.style.display = 'flex';
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  emptyEl.style.display = 'none';

  const wrap = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const cssW = wrap.clientWidth - 12;
  const cssH = wrap.clientHeight - 12;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 34, padR = 8, padT = 12, padB = 22;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  const kgs = points.map(p => p.kg);
  let min = Math.min(...kgs), max = Math.max(...kgs);
  if (min === max) { min -= 5; max += 5; }
  const rangePad = (max - min) * 0.15;
  min = Math.max(0, min - rangePad);
  max = max + rangePad;

  const xFor = (i) => padL + (points.length === 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const yFor = (v) => padT + plotH - ((v - min) / (max - min)) * plotH;

  // gridlines + y labels
  ctx.strokeStyle = '#2b2b2b';
  ctx.fillStyle = '#8a8a8a';
  ctx.font = '10px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  const ySteps = 4;
  for (let i = 0; i <= ySteps; i++) {
    const v = min + ((max - min) * i) / ySteps;
    const y = yFor(v);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillText(Math.round(v).toString(), padL - 6, y);
  }

  // line
  ctx.strokeStyle = '#ff3b30';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, i) => {
    const x = xFor(i), y = yFor(p.kg);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // dots
  ctx.fillStyle = '#ff3b30';
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(xFor(i), yFor(p.kg), 2.6, 0, Math.PI * 2);
    ctx.fill();
  });

  // x labels (thin out if crowded)
  ctx.fillStyle = '#8a8a8a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const maxLabels = Math.max(2, Math.floor(plotW / 55));
  const step = Math.ceil(points.length / maxLabels);
  points.forEach((p, i) => {
    if (i % step !== 0 && i !== points.length - 1) return;
    ctx.fillText(p.label, xFor(i), cssH - padB + 6);
  });
}

window.addEventListener('resize', () => {
  const detailActive = document.getElementById('view-analyticsDetail').classList.contains('active');
  if (detailActive) renderAnalyticsDetail();
});

// backup: full json export / validated import
/* ============================================================
   EXPORT / IMPORT
   ============================================================ */

const BACKUP_APP_ID = 'workout-tracker';

async function exportData() {
  await refreshExercisesCache();
  await refreshWorkoutsCache();
  const data = {
    app: BACKUP_APP_ID,
    version: 1,
    exportedAt: new Date().toISOString(),
    exercises: state.exercisesCache,
    workouts: state.workoutsCache
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `workout-backup-${todayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importData(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch (err) {
    alert('Import failed: the file is not valid JSON.');
    return;
  }
  const valid = data && data.app === BACKUP_APP_ID &&
    Array.isArray(data.exercises) && Array.isArray(data.workouts);
  if (!valid) {
    alert('That file is not a Workout Tracker backup.');
    return;
  }
  if (!confirm(`Import ${data.exercises.length} exercises and ${data.workouts.length} workouts?\nItems with the same ID will be overwritten.`)) return;
  try {
    for (const ex of data.exercises) {
      if (ex && ex.id != null && typeof ex.name === 'string') await dbPut('exercises', ex);
    }
    for (const w of data.workouts) {
      if (w && w.id != null && Array.isArray(w.exercises)) await dbPut('workouts', w);
    }
    await refreshExercisesCache();
    await refreshWorkoutsCache();
    alert('Import complete.');
    renderHome();
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
}

document.getElementById('btnExportData').addEventListener('click', exportData);

document.getElementById('btnImportData').addEventListener('click', () => {
  document.getElementById('importFileInput').click();
});

document.getElementById('importFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) await importData(file);
});

// small formatting + escaping helpers
/* ---------------- helpers ---------------- */

// prevents html injection from user input
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function formatDateShort(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

// app boot: open db, show home
/* ---------------- init ---------------- */

(async function init() {
  await openDB();
  await refreshExercisesCache();
  navigate('home');
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
  });
}