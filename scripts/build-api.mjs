import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const outDir = ".vercel/output/functions/api/index.func";
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: ["api/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: path.join(outDir, "index.mjs"),
  external: [
    // Keep native/binary modules external
    "pg-native",
  ],
  banner: {
    js: `
import { createRequire } from "module";
const require = createRequire(import.meta.url);
`,
  },
  sourcemap: true,
  minify: false,
  treeShaking: true,
});

// Write function config — use nodejs18.x for broader compatibility
writeFileSync(
  path.join(outDir, ".vc-config.json"),
  JSON.stringify(
    {
      handler: "index.mjs",
      runtime: "nodejs18.x",
      launcherType: "Nodejs",
    },
    null,
    2,
  ),
);

// Write routes config
const staticDir = ".vercel/output/static";
mkdirSync(staticDir, { recursive: true });

// Copy dist/ to static/
const { execSync } = await import("child_process");
execSync(`cp -r dist/* ${staticDir}/`, { stdio: "inherit" });

// Write config.json for routing
writeFileSync(
  ".vercel/output/config.json",
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/api/(.*)", dest: "/api" },
        { handle: "filesystem" },
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);

// Copy font assets for PDF generation
const assetsDir = path.join(outDir, "assets");
mkdirSync(assetsDir, { recursive: true });
try {
  execSync(`cp server/assets/*.ttf ${assetsDir}/`, { stdio: "inherit" });
  console.log("Font assets copied.");
} catch {
  console.warn("No font assets to copy (PDF generation will use fallback font).");
}

console.log("API function bundled successfully.");
