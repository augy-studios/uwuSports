#!/usr/bin/env node
/* The one check worth scripting, per update-bar-spec.md.

   skipWaiting() outside the message handler is the single change that
   silently turns the update bar back into a silent takeover, and it is
   exactly the kind of line somebody adds to fix a caching complaint
   without knowing what it was protecting.

   Run with: node scripts/check-sw.mjs
   Exits non-zero on a violation, so it drops into CI unchanged. */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SW_PATH = join(root, "main-site", "sw.js");

const problems = [];

const source = await readFile(SW_PATH, "utf8");

/* Strip comments before looking, so the explanatory prose in the worker
   does not read as a violation of the thing it is explaining. */
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

const lines = code.split("\n");

/* Find the message handler's extent by brace depth, so "inside the
   handler" is measured rather than assumed. */
function messageHandlerRange() {
  const start = lines.findIndex((l) => /addEventListener\(\s*["']message["']/.test(l));
  if (start === -1) return null;

  let depth = 0;
  let seen = false;

  for (let i = start; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth += 1;
        seen = true;
      } else if (ch === "}") depth -= 1;
    }
    if (seen && depth <= 0) return [start, i];
  }

  return [start, lines.length - 1];
}

const range = messageHandlerRange();

if (!range) {
  problems.push("sw.js has no message handler, so the update bar can never promote a waiting worker.");
}

lines.forEach((line, i) => {
  if (!/skipWaiting\s*\(|clients\.claim\s*\(/.test(line)) return;

  const inside = range && i >= range[0] && i <= range[1];
  if (inside) return;

  problems.push(
    `sw.js:${i + 1} calls skipWaiting() or clients.claim() outside the message handler. ` +
      `That makes a new worker activate on its own, which is what the update bar exists to prevent.`
  );
});

if (!/SW_VERSION\s*=/.test(code)) {
  problems.push("sw.js has no SW_VERSION constant. Without one the browser sees no update to prompt about.");
}

if (problems.length) {
  console.error("Service worker check failed:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error("");
  process.exit(1);
}

console.log("Service worker check passed: the worker waits, and SW_VERSION is present.");
