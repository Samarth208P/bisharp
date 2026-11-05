# Bisharp brand assets

The faceted B uses two right-facing forms and a diagonal negative-space route. Obsidian (`#070607`), ember (`#fc5000`), and limestone (`#f7f6f2`) match the interface.

- `mark.svg`: transparent, editable vector source.
- `logo.svg`: horizontal logo with outlined DM Sans lettering and a limestone backing for legibility in light and dark README viewers. No font requests or embedded raster images.
- `mark.png`, `logo.png`: portable raster exports.
- `icon-32.png`, `icon-192.png`, `icon-512.png`: square icons.
- `concept.png`: original imagegen exploration, manually redrawn as SVG for production.
- `../../src/app/icon.svg`, `../../src/app/favicon.ico`, and `../../src/app/apple-icon.png`: Next.js file-based metadata assets. ICO includes 16, 32, 48, 64, 128, and 256px frames; Apple icon is 180px.

Regenerate exports with `npm run brand:generate`. The site’s inline `BrandMark` in `src/app/visuals.tsx` uses the same paths as `mark.svg`; keep both in sync if the geometry changes.

## Image creation

Mode: built-in imagegen tool, followed by a manual vector redraw and SVG-to-PNG/ICO conversion using Sharp. The production assets are real vector paths, not a raster image embedded in SVG.

Prompt:

> Use case: logo-brand. Asset type: clean logo concept for Bisharp, a conditional cross-chain trading workspace. Create ONE isolated geometric B monogram on a solid warm limestone #f7f6f2 background. The monogram is obsidian #070607, with a small ember orange #fc5000 cut or accent. Two stacked angular right-pointing facets form the bowls of the B, with a crisp diagonal negative-space channel suggesting an order routed between two chains. Broad solid shapes, compact upright silhouette, optically balanced, extremely simple enough to be redrawn as a few SVG paths and legible at 16px. Flat vector-like artwork, centered, ample margins. No words, no letters other than the abstract B, no mockup, no texture, no shadows, no gradients, no metallic effects, no tiny details, no crypto coin imagery.
