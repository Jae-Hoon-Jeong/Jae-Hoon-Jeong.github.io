# Project page (draft)

Static project page, kept separate from the manuscript and code repositories.
Status: **PAIP2020 demo viewer: Raw H&E, pathologist Whole Tumor Area (GT) and nucleus predictions (Eff / Cls / Seg / Full) with a confidence threshold.**
Title and authors are withheld. Not for clinical or diagnostic use.

## Structure
```
index.html                         single-page layout (Jekyll front matter: layout null, sitemap false)
assets/css/style.css               responsive styles (desktop/mobile, light/dark)
assets/js/main.js                  mode text, slider shell, OpenSeadragon viewer + overlay loader
assets/img/placeholder_tissue.svg  synthetic CC0 fallback image (not a real slide)
data/slides.json                   PAIP2020 slide list: Deep Zoom URL, native size, GT and overlay URLs
data/overlay.schema.json           format of the future precomputed nucleus overlays
ASSET_PROVENANCE.md                source, licence and redistribution basis of every image
TODO.md                            open items
.gitignore                         blocks large/private assets
```

## Assets and licences
- PAIP2020 slides (CC BY-NC 4.0, Seoul National University Hospital): only derived assets are hosted
  (web-display Deep Zoom 0.50 µm/px q50, Whole Tumor Area GT JSON, nucleus overlay chunks), in
  `Jae-Hoon-Jeong/projectpage_essets` `projects/sena_nbe/v2/paip/`; provenance in that repository's
  `projects/sena_nbe/PROVENANCE.md`. Non-commercial academic use. Original slides are not hosted.
- Never commit WSI files, image pyramids, caches, checkpoints, embeddings or any access-restricted data.
  Access-restricted cohorts (e.g. under a DUA) and TCGA slides are never shown on this page.

## Adding overlays (Eff / Cls nuclei)
Overlays are produced offline by the deployed model; the page only draws them.
1. Run the model on the CC0 slide and write one JSON per slide and mode following `data/overlay.schema.json`
   (`format: "nuclei-overlay/v0"`, level-0 pixel coordinates, class index 0-4 =
   Neoplastic, Epithelial, Inflammatory, Connective, Dead).
2. Host the files on external storage (or commit them only if small), with CORS allowing this site.
3. Set `slides[].overlays.Eff` / `.Cls` in `data/slides.json` to the URLs. The layer toggles enable themselves
   only when a URL is present; until then they stay disabled with "pending model inference".
4. Record the producing model version and commit in the overlay's `model` field and in `ASSET_PROVENANCE.md`.

## Live page
https://jae-hoon-jeong.github.io/projects/SENA/ (`noindex` is set; excluded from sitemap.xml.)

Hosted inside the personal site repository under `projects/SENA/`. All CSS/JS/data are project-local
relative paths; the site-wide Jekyll configuration and theme are not used by this page.

## Tile hosting
PAIP web-display Deep Zoom tiles, GT and overlays are served from
https://jae-hoon-jeong.github.io/projectpage_essets/projects/sena_nbe/v2/paip/ (versioned path).
