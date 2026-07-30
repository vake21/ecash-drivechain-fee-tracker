import { existsSync } from "node:fs";
import { join } from "node:path";

// Branding is deliberately NOT in this repository — it ships code only, so the
// logo and background artwork are not distributed under the code licence.
//
// To brand a deployment, drop the files below into `public/`. They are gitignored,
// so a `git pull` will not remove them and a fresh clone simply renders unbranded:
// a styled text wordmark instead of the logo, and the gradient wash with no
// photographic layer behind it. Nothing errors when they are absent.
//
// Presence is resolved once at module load, so add the files BEFORE starting the
// server — dropping one in on a running process will not be noticed until restart.

const publicFile = (name: string) => join(process.cwd(), "public", name);

/** Wide logo lockup for the header, light-on-dark. Any aspect ratio works. */
export const LOGO_FILE = "logo-dark.png";
/** Full-bleed page background. Should be dark; see deploy/README.md for guidance. */
export const WALLPAPER_FILE = "wallpaper.webp";

export const hasLogo = existsSync(publicFile(LOGO_FILE));
export const hasWallpaper = existsSync(publicFile(WALLPAPER_FILE));
