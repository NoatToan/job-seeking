# Job-source brand marks

Official marks of the sites jobs come from, shown by `<SourceIcon>` (`../../components/source-icon.tsx`)
next to the site's name ("via Himalayas", "Apply on LinkedIn"). They are attribution only: the name
is always written beside the mark (or is its accessible name where space is tight), the marks are
never recoloured, cropped into a new shape or animated, and they never stand in for our own brand.

After changing a file here, run `pnpm --filter @ujc/ui icons:sources` to regenerate
`../../source-icons.css` (the marks are inlined there as `data:` URIs; nothing is fetched at
runtime). Decision record: docs/DECISIONS.md, "Job-source brand marks".

| Source | File | Origin (fetched 2026-11-07) | Processing |
| --- | --- | --- | --- |
| LinkedIn | `linkedin.png` | Favicon served by linkedin.com: https://static.licdn.com/aero-v1/sc/h/al2o9zrvru7aqj8e1x2rzsrca (64×64 frame of the .ico) | Extracted the 64×64 frame, PNG-optimised |
| Seek | `seek.png` | https://www.seek.com.au/favicon.ico (48×48 PNG) | PNG-optimised |
| Arc (arc.dev) | `arc.png` | https://assets.arc.dev/icons/favicon-192x192.png (linked from arc.dev) | Downscaled 192→64 (Lanczos) |
| Lever | `lever.png` | https://www.lever.co/images/favicon-lever.png (48×48) | PNG-optimised |
| Ashby | `ashby.png` | https://www.ashbyhq.com/favicon.png (192×192) | Downscaled 192→64 |
| Remotive | `remotive.png` | https://remotive.com/remotive_website_layout/static/src/img/apple-touch-icon.png (180×180) | Downscaled 180→64 |
| We Work Remotely | `weworkremotely.png` | https://weworkremotely.com/apple-touch-icon.png (180×180) | Downscaled 180→64 |
| Himalayas | `himalayas.svg` | Logo on himalayas.app: https://cdn-images.himalayas.app/himalayas.svg | Kept only the mountain mark (first path, `#553C9A`), wordmark dropped, viewBox cropped to the mark; colour unchanged |
| Adzuna | `adzuna.svg` | Logo on adzuna.com: https://zunastatic-abf.kxcdn.com/images/global/adzuna_logo.svg | Kept only the spiral "a" mark (last subpath, `#279B37`), wordmark dropped, viewBox cropped; colour unchanged |
| Glassdoor | — | `simple-icons` (`siGlassdoor`, CC0 path data; brand colour `#00A162`) | — |
| Greenhouse | — | `simple-icons` (`siGreenhouse`, `#24A47F`) | — |
| Upwork | — | `simple-icons` (`siUpwork`, `#6FDA44`) | — |
| YC Work at a Startup | — | `simple-icons` (`siYcombinator`, `#F0652F`) | — |

LinkedIn is no longer in simple-icons (removed at LinkedIn's request), hence the favicon. Arc in
simple-icons is the Arc *browser*, not arc.dev, so arc.dev's own favicon is used. The marks remain
the trademarks of their owners; they are used nominatively, to say where a listing was found.

Marks without a background of their own (Seek, Himalayas, Adzuna, Glassdoor, Greenhouse, Upwork)
are drawn on a white rounded tile with clear space around them (`data-tile`), which keeps a navy or
purple mark legible on the dark theme without recolouring it. Marks that are already an app-icon
square (LinkedIn, Arc, Lever, Ashby, Remotive, WWR, YC) are shown as-is with a hairline edge.
