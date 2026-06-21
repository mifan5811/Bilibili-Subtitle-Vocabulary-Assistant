import { readFile, access } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "dist", "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

const requiredFiles = [
  "dist/manifest.json",
  "dist/popup.html",
  "dist/review.html",
  "dist/assets/background.js",
  "dist/assets/content.js",
  "dist/assets/page-hook.js",
  "dist/assets/popup.js",
  "dist/assets/review.js",
  "dist/vendor/ts-fsrs.umd.js",
  "dist/dictionary/a.json",
  "dist/dictionary/forms.json",
  "dist/licenses/ECDICT-LICENSE.txt",
  "dist/licenses/TS-FSRS-LICENSE.txt"
];

for (const relativePath of requiredFiles) {
  await access(path.join(root, relativePath), constants.R_OK);
}

const scripts = [
  "dist/assets/background.js",
  "dist/assets/content.js",
  "dist/assets/page-hook.js",
  "dist/assets/popup.js",
  "dist/assets/review.js",
  "dist/vendor/ts-fsrs.umd.js"
];

for (const relativePath of scripts) {
  const result = spawnSync(process.execPath, ["--check", path.join(root, relativePath)], {
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(`Syntax check failed for ${relativePath}\n${result.stderr}`);
  }
}

if (manifest.manifest_version !== 3) {
  throw new Error("The extension must use Manifest V3.");
}

if (manifest.version !== JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version) {
  throw new Error("package.json and manifest.json versions do not match.");
}

console.log(`Validated extension version ${manifest.version}.`);
