# DogMedia web

The browser client is a React 19 and Vite application. Styling uses Tailwind
CSS v4 utilities plus feature-level CSS. Runtime light, dark, and system themes
are driven by the custom properties in `src/theme.css`; the newer media-vault
design layer lives in `src/vault-theme.css` while older feature styles are
migrated incrementally.

## Component approach

- Application behavior stays in domain components under `src/components/` and
  `src/pages/`.
- React Bits components are copied into the repository through the registry in
  `components.json`, then adapted to the application tokens and accessibility
  requirements. `SpotlightCard` powers the featured-library interaction and
  `DepthCarousel` powers Wrapped stories.
- Motion is concentrated around featured artwork. The virtualized media grid
  uses CSS transitions instead of per-card animation runtimes.
- Every motion treatment must provide a `prefers-reduced-motion` fallback.

## API boundary

All HTTP requests continue through `src/api.js`. UI refactors must not rename
existing `/api/*` endpoints, change payloads, or require changes in `server/`.

## Checks

```bash
npm run test:web
npm run lint --workspace=web
npm run build:web:budget
```
