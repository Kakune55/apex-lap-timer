import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "public");
const iconsDir = join(outDir, "icons");
const sourceDir = join(root, "pwa");

mkdirSync(iconsDir, { recursive: true });

const resolveSourceIcon = (preferredName) => {
  const fromPwaDir = join(sourceDir, preferredName);
  if (existsSync(fromPwaDir)) {
    return fromPwaDir;
  }

  const fromRoot = join(root, preferredName);
  if (existsSync(fromRoot)) {
    return fromRoot;
  }

  const fallback = join(root, "icon.png");
  if (existsSync(fallback)) {
    return fallback;
  }

  throw new Error(
    `Missing icon source. Expected ${preferredName} in /pwa or project root, or fallback icon.png in project root.`,
  );
};

const ensureIcon = (preferredName, outputName) => {
  const outputPath = join(iconsDir, outputName);
  copyFileSync(resolveSourceIcon(preferredName), outputPath);
};

ensureIcon("icon-192.png", "icon-192.png");
ensureIcon("icon-512.png", "icon-512.png");
ensureIcon("apple-touch-icon.png", "apple-touch-icon.png");

const manifest = {
  name: "Apex Lap Timer",
  short_name: "Apex Timer",
  description: "Track lap timing and telemetry for circuits and sprints.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#0a0a0a",
  theme_color: "#0a0a0a",
  icons: [
    {
      src: "/icons/icon-192.png",
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
    },
    {
      src: "/icons/icon-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};

writeFileSync(join(outDir, "manifest.webmanifest"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
