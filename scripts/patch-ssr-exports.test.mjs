import assert from "node:assert/strict";
import { test } from "node:test";
import {
  inlineExportAllHelper,
  needsExportAllInline,
  needsSsrExportsPatch,
  patchSsrExportsSource,
  resolveSsrExportLocals,
} from "./patch-ssr-exports.mjs";

const BROKEN_FACADE = `import "../_runtime.mjs";
import { a as getRequest, c as server_exports, i as createServerFn, n as createMiddleware, o as getServerFnById, r as createServerEntry, s as server_default, t as TSS_SERVER_FUNCTION } from "./ssr2.mjs";
var __exportAll = (all, no_symbols) => {
	let target = {};
	return target;
};
export { getServerFnById as a, __exportAll as c, createServerEntry, server_default as default, TSS_SERVER_FUNCTION as i, createMiddleware as n, getRequest as o, createServerFn as r, ssr_exports as s, server_exports as t };
`;

const BROKEN_IMPL = `import { c as __exportAll$1 } from "./ssr.mjs";
function createServerEntry(entry) {
	return { async fetch(...args) {
		return await entry.fetch(...args);
	} };
}
var server_exports = /* @__PURE__ */ __exportAll$1({ setCookie: () => setCookie$1 });
var server_default = createServerEntry({ fetch });
export { server_exports as c, server_default as s };
`;

test("needsSsrExportsPatch detects the undeclared re-export", () => {
  assert.equal(needsSsrExportsPatch(BROKEN_FACADE), true);
});

test("needsSsrExportsPatch skips a declared namespace", () => {
  const declared = "const ssr_exports = { default: server_default };\nexport { ssr_exports as s };\n";
  assert.equal(needsSsrExportsPatch(declared), false);
});

test("resolveSsrExportLocals reads default and t aliases", () => {
  assert.deepEqual(resolveSsrExportLocals(BROKEN_FACADE), {
    defaultLocal: "server_default",
    tLocal: "server_exports",
  });
});

test("patchSsrExportsSource declares the namespace used by the renderer", () => {
  const patched = patchSsrExportsSource(BROKEN_FACADE);
  assert.match(patched, /const ssr_exports = \{ default: server_default, t: server_exports \};/);
  assert.equal(needsSsrExportsPatch(patched), false);
  assert.match(patched, /export \{[\s\S]*ssr_exports as s/);
});

test("patchSsrExportsSource is a no-op on healthy chunks", () => {
  const healthy = "export const fetch = () => {};\n";
  assert.equal(patchSsrExportsSource(healthy), healthy);
});

test("inlineExportAllHelper removes the cycle import", () => {
  assert.equal(needsExportAllInline(BROKEN_IMPL), true);
  const patched = inlineExportAllHelper(BROKEN_IMPL);
  assert.doesNotMatch(patched, /from "\.\/ssr\.mjs"/);
  assert.match(patched, /function __exportAll\$1\(all, no_symbols\)/);
  assert.match(patched, /__exportAll\$1\(\{ setCookie/);
  assert.equal(needsExportAllInline(patched), false);
});
