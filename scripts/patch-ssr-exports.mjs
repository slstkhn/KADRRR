#!/usr/bin/env node
/**
 * Rolldown 1.2.2–1.2.6 emits an SSR facade that (1) re-exports `ssr_exports`
 * without declaring it and (2) mutually-imports the impl chunk for `__exportAll`
 * (TanStack/router#8031, nitrojs/nitro#4533). Node then 500s every request.
 *
 * After Nitro writes the bundle: declare the namespace, and inline `__exportAll`
 * in the impl chunk so the cycle is gone. Do not inlineDynamicImports — that
 * pulls PGLite into one file and breaks `pglite.data` resolution in preview.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function needsSsrExportsPatch(source) {
  if (!/\bssr_exports\b/.test(source)) return false;
  if (/\b(?:const|let|var)\s+ssr_exports\b/.test(source)) return false;
  if (/\bssr_exports\s*=/.test(source)) return false;
  if (/\bas\s+ssr_exports\b/.test(source)) return false;
  return /export\s*\{[^}]*\bssr_exports\s+as\b/.test(source);
}

export function resolveSsrExportLocals(source) {
  let defaultLocal = null;
  let tLocal = null;
  const blocks = source.match(/export\s*\{[^}]+\}/g) ?? [];
  const last = blocks.at(-1) ?? "";
  const body = last.replace(/^export\s*\{/, "").replace(/\}$/, "");
  for (const part of body.split(",")) {
    const as = part.trim().match(/^(\w+)\s+as\s+(\w+)$/);
    if (!as) continue;
    if (as[2] === "default") defaultLocal = as[1];
    if (as[2] === "t") tLocal = as[1];
  }
  if (!defaultLocal) {
    const m = source.match(/\b(?:var|const|let)\s+(\w+)\s*=\s*createServerEntry\b/);
    if (m) defaultLocal = m[1];
  }
  if (!tLocal) {
    const m = source.match(/\b(?:var|const|let)\s+(\w+)\s*=\s*(?:\/\*[\s\S]*?\*\/\s*)?__exportAll/);
    if (m) tLocal = m[1];
  }
  return { defaultLocal, tLocal };
}

export function patchSsrExportsSource(source) {
  if (!needsSsrExportsPatch(source)) return source;
  const { defaultLocal, tLocal } = resolveSsrExportLocals(source);
  const fields = [];
  if (defaultLocal) fields.push(`default: ${defaultLocal}`);
  if (tLocal) fields.push(`t: ${tLocal}`);
  if (fields.length === 0) return source;
  const lastExport = source.lastIndexOf("export {");
  if (lastExport === -1) return source;
  const decl = `const ssr_exports = { ${fields.join(", ")} };\n`;
  return source.slice(0, lastExport) + decl + source.slice(lastExport);
}

const EXPORT_ALL_IMPORT =
  /import\s*\{\s*c as (__exportAll\$?\d*)\s*\}\s*from\s*"\.\/ssr\.mjs";\s*\n/;

export function needsExportAllInline(source) {
  return EXPORT_ALL_IMPORT.test(source) && /\bcreateServerEntry\b/.test(source);
}

export function inlineExportAllHelper(source) {
  const match = source.match(EXPORT_ALL_IMPORT);
  if (!match) return source;
  const localName = match[1];
  const helper = `function ${localName}(all, no_symbols) {
	let target = {};
	for (var name in all) Object.defineProperty(target, name, {
		get: all[name],
		enumerable: true
	});
	if (!no_symbols) Object.defineProperty(target, Symbol.toStringTag, { value: "Module" });
	return target;
}
`;
  return source.replace(EXPORT_ALL_IMPORT, () => helper);
}

function walkMjs(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkMjs(path, acc);
    else if (entry.isFile() && entry.name.endsWith(".mjs")) acc.push(path);
  }
  return acc;
}

export function collectSearchRoots(root = ROOT) {
  return [join(root, ".vercel/output"), join(root, ".output")].filter((dir) =>
    existsSync(dir),
  );
}

export function patchSsrExportFiles(roots = collectSearchRoots()) {
  const patched = [];
  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    for (const file of walkMjs(root)) {
      const before = readFileSync(file, "utf8");
      let next = before;
      if (needsSsrExportsPatch(next)) next = patchSsrExportsSource(next);
      if (needsExportAllInline(next)) next = inlineExportAllHelper(next);
      if (next === before) continue;
      writeFileSync(file, next);
      patched.push(file);
    }
  }
  return patched;
}

const PGLITE_ASSETS = ["pglite.data", "pglite.wasm", "initdb.wasm"];

export function copyPgliteAssets(roots = collectSearchRoots()) {
  const srcDir = join(ROOT, "node_modules/@electric-sql/pglite/dist");
  const copied = [];
  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    for (const file of walkMjs(root)) {
      if (!file.endsWith("electric-sql__pglite.mjs")) continue;
      const destDir = dirname(file);
      for (const name of PGLITE_ASSETS) {
        const src = join(srcDir, name);
        const dest = join(destDir, name);
        if (!existsSync(src) || existsSync(dest)) continue;
        copyFileSync(src, dest);
        copied.push(dest);
      }
    }
  }
  return copied;
}

function isMain() {
  const self = fileURLToPath(import.meta.url);
  const invoked = process.argv[1] ? fileURLToPath(`file://${process.argv[1]}`) : "";
  return self === invoked;
}

if (isMain()) {
  const patched = patchSsrExportFiles();
  if (patched.length === 0) {
    console.log("[patch-ssr-exports] no facades needed a patch");
  } else {
    for (const file of patched) {
      console.log(`[patch-ssr-exports] patched ${file}`);
    }
  }
  const copied = copyPgliteAssets();
  if (copied.length === 0) {
    console.log("[patch-ssr-exports] pglite assets already in place");
  } else {
    for (const file of copied) {
      console.log(`[patch-ssr-exports] copied ${file}`);
    }
  }
}
