/**
 * Post-build step: make the prerendered landing page boot the SPA.
 *
 * public/landing.html is copied verbatim into dist/ by Vite, but it keeps the
 * dev-only `/src/main.tsx` entry, which does not exist in a production build.
 * This script swaps it for the hashed script and stylesheet tags of the built
 * index.html so the homepage (served by the API from landing.html) hydrates
 * into the real app: signed-out visitors see the same landing, signed-in
 * visitors are taken to their dashboard by the session check.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "..", "dist");

const indexHtml = readFileSync(resolve(dist, "index.html"), "utf8");
const landingPath = resolve(dist, "landing.html");
let landing = readFileSync(landingPath, "utf8");

const styles = indexHtml.match(/<link rel="stylesheet"[^>]*>/g) ?? [];
const scripts = indexHtml.match(/<script type="module"[^>]*><\/script>/g) ?? [];

if (scripts.length === 0) {
  throw new Error("build-landing: no module script found in dist/index.html");
}
if (!landing.includes("/src/main.tsx")) {
  throw new Error(
    "build-landing: dist/landing.html does not reference /src/main.tsx (already processed?)",
  );
}

// Swap the dev entry for the built module scripts, and hoist the built CSS
// into <head> so the landing never flashes unstyled before React takes over.
landing = landing.replace(
  /<script type="module" src="\/src\/main\.tsx"><\/script>/,
  scripts.join("\n"),
);
landing = landing.replace("</head>", `${styles.join("\n")}\n  </head>`);

writeFileSync(landingPath, landing);
console.log(
  `build-landing: injected ${scripts.length} script(s) and ${styles.length} stylesheet(s) into dist/landing.html`,
);
