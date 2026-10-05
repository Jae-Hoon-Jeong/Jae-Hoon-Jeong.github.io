---
layout: null
sitemap: false
---
# Asset provenance and licence audit

Checked 2026-10-05 against primary sources. No image data is stored in this repository;
the viewer loads tiles from the external host listed per asset.

## Used

| Slide | Source (primary) | Licence | Redistribution basis | Tiles served from |
|---|---|---|---|---|
| CMU-1 (Aperio SVS, 46000 x 32914 px, 0.499 µm/px) | https://openslide.cs.cmu.edu/download/openslide-testdata/Aperio/ (listing + `index.yaml`) | CC0-1.0 | CC0 public-domain dedication: copying, modification and redistribution allowed without conditions | OpenSlide demo site, `https://openslide-demo-site.s3.dualstack.us-east-2.amazonaws.com/aperio/cmu-1/slide_files/` (Deep Zoom, 510 px tiles, CORS `*`) |
| CMU-2 (Aperio SVS, 78000 x 30462 px, 0.499 µm/px) | same | CC0-1.0 | same | `.../aperio/cmu-2/slide_files/` |

Attribution shown on the page (not legally required under CC0, given as courtesy):
"CMU-1.svs / CMU-2.svs, OpenSlide test data (Carnegie Mellon University), CC0 1.0. Tiles served by the OpenSlide demo site."

Notes
- The source does not state organ, stain protocol details or diagnosis. The page says so and makes no clinical claim.
- The tile host is the OpenSlide project's public demo bucket (used by https://openslide.org/demo/). It returns
  `Access-Control-Allow-Origin: *`; no written policy on third-party embedding was found (not prohibited, not explicitly permitted).
  The image licence (CC0) is unambiguous. If the host changes or asks otherwise, regenerate Deep Zoom tiles from the CC0 SVS
  and host them on our own external storage (CC0 permits this); only `data/slides.json` needs to change.
- The OpenSlide demo may be re-tiled (its page says so); tile paths have been stable but this is not guaranteed.
  The viewer falls back to the synthetic placeholder if a slide fails to open.

## Considered, not used

| Candidate | Licence / terms | Reason not used |
|---|---|---|
| OpenSlide JP2K-33003-1/-2 (aorta / heart) | "Free to use and distribute, with or without modification" | Usable, but CC0 slides preferred for clarity. |
| OpenSeadragon example DZI (`highsmith`) | No licence stated on the example page | Not histology; licence not stated on the page. |
| NCI Imaging Data Commons (DICOMweb proxy) | Per-collection licences (many CC-BY); proxy policy has quotas, says it is for use when other access is not possible, and may be restricted to IDC viewers | Embedding by third-party sites not clearly permitted; many collections derive from TCGA. |
| TCGA WSIs (any host) | Project rules | Excluded: no TCGA slide is copied or embedded. |
| Zenodo CC-BY WSIs | Per record | Would need self-hosted tiles on external storage; not needed while the CC0 option above works. |
| Access-restricted cohorts (DUA) | Data use agreements | Excluded. Never shown. |

## Other files

| File | Origin | Licence |
|---|---|---|
| `assets/img/placeholder_tissue.svg` | Drawn for this site, synthetic | CC0 |
| OpenSeadragon 4.1.1 (loaded from jsDelivr) | https://openseadragon.github.io/ | BSD-3-Clause |

## Status of the tile host (2026-10-05)
- **Temporary staging dependency.** The CC0 licence covers the slide images. Long-term permission for third-party
  hot-linking of the OpenSlide demo bucket was not found (no prohibition found either) [unverified].
- Before the final public launch: generate Deep Zoom tiles ourselves from the same CC0 SVS files
  (CMU-1.svs, CMU-2.svs) and host them on controlled external storage; update `data/slides.json`.
  Do not download the demo bucket into this git repository.
