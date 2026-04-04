# Project: 1000lb Club Tracker

## Build & Deploy

- **Build command**: `npm run build` (NOT `npx vite build` alone)
- This runs Vite build AND copies `dist/` output to root `assets/` + `index.html`
- GitHub Pages serves from repo root (`/` on `master`), not from `dist/`
- If you only run `vite build`, the site will serve stale JS/CSS
- After building, commit both `index.html` and `assets/` changes

## Tech Stack

- Vanilla JS PWA, Vite bundler, no framework
- localStorage + optional Firebase sync
- Service worker (`sw.js`) with cache versioning — bump `CACHE_NAME` when making breaking changes
