#!/usr/bin/env node
// check-i18n-parity.mjs — Phase 23 Wave 0 (UX5 mitigation)
//
// Enforces that every i18n key referenced by `t('key')` or `i18nKey="key"`
// in apps/web/src/**/*.{ts,tsx} exists as a string in all 6 locale JSONs
// (en, zh, fr, de, es, it). Also catches inverse drift: keys present in
// en.json but missing from any other locale.
//
// Exit 0 when all locales have every required key. Exit 1 otherwise, with
// a `MISSING <locale>: <key>` line per gap.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webRoot = path.resolve(__dirname, '..');
const srcRoot = path.join(webRoot, 'src');
const localesDir = path.join(srcRoot, 'i18n', 'locales');

const LOCALES = ['en', 'zh', 'fr', 'de', 'es', 'it'];

// ---- Collect source files ----------------------------------------------
/** @param {string} dir @param {string[]} out */
function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
}
const sourceFiles = [];
walk(srcRoot, sourceFiles);

// ---- Extract referenced keys ------------------------------------------
const tCallRx = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
const i18nKeyRx = /\bi18nKey=['"]([a-zA-Z0-9_.]+)['"]/g;
const usedKeys = new Set();
for (const file of sourceFiles) {
  const src = fs.readFileSync(file, 'utf8');
  for (const rx of [tCallRx, i18nKeyRx]) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(src)) !== null) {
      const key = m[1];
      if (key.includes('{{')) continue; // interpolated — skip
      usedKeys.add(key);
    }
  }
}

// ---- Load locales + flatten -------------------------------------------
/** @param {unknown} obj @param {string} prefix @param {Map<string,string>} out */
function flatten(obj, prefix, out) {
  if (obj === null || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      out.set(key, v);
    } else if (v && typeof v === 'object') {
      flatten(v, key, out);
    }
  }
}

const flat = new Map(); // lang -> Map<key,string>
for (const lang of LOCALES) {
  const filePath = path.join(localesDir, `${lang}.json`);
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const m = new Map();
  flatten(parsed, '', m);
  flat.set(lang, m);
}

// ---- Canonical key set: used-in-source ∪ every locale's keys ----------
// Inverse check: any key in en.json missing from any other locale is drift.
const canonical = new Set(usedKeys);
for (const lang of LOCALES) {
  for (const key of flat.get(lang).keys()) canonical.add(key);
}

// ---- Assert presence ---------------------------------------------------
const missing = [];
for (const key of canonical) {
  for (const lang of LOCALES) {
    const v = flat.get(lang).get(key);
    if (typeof v !== 'string') missing.push({ lang, key });
  }
}

if (missing.length > 0) {
  // Sort by lang then key for stable output
  missing.sort((a, b) => a.lang.localeCompare(b.lang) || a.key.localeCompare(b.key));
  for (const { lang, key } of missing) console.log(`MISSING ${lang}: ${key}`);
  console.error(
    `\ni18n parity check failed: ${missing.length} gaps across ${LOCALES.length} locales.`,
  );
  process.exit(1);
}

console.log(
  `OK: ${canonical.size} keys checked across ${LOCALES.length} locales (${LOCALES.join(', ')}).`,
);
process.exit(0);
