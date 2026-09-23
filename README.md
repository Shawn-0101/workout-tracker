# Workout Tracker

An offline-first, framework-free progressive web app (PWA) for logging gym workouts and tracking strength progress over time.

## Features

- Log workouts with exercises, sets, weight (kg) and reps
- Exercise library with search, images and muscle target tags
- Last-session hints when picking exercises (previous weight/reps pre-filled)
- Progress analytics: best weight per session with day/month/year grouping, drawn on a canvas graph plus a history table
- JSON export/import backup with validation
- Fully offline: IndexedDB storage + service worker caching + installable via web app manifest

## Tech

HTML, CSS, vanilla JavaScript, IndexedDB, Canvas API, Service Workers, Web App Manifest.

## Run it

It's a static site — no build step.

1. Serve the folder over HTTP (service workers need a server, they won't work from `file://`):

   ```bash
   npx serve .
   # or
   python3 -m http.server 8000
   ```

2. Open the URL in your browser (e.g. `http://localhost:8000`).
3. To install as an app on your phone: open the deployed URL in Chrome → menu → "Add to Home screen".



## Project structure

| File | Purpose |
| --- | --- |
| `index.html` | all app screens (home, workout, picker, exercise form, finalize, analytics) |
| `style.css` | dark theme, layout, animations |
| `app.js` | all logic: IndexedDB layer, navigation, rendering, analytics pipeline, export/import |
| `sw.js` | service worker: pre-caches the app shell for offline use |
| `manifest.json` | PWA install metadata (name, icons, theme, standalone mode) |
| `icons/` | app icons (192, 512, maskable, apple touch icon) |
