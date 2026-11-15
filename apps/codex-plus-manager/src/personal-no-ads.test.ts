import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const rendererPath = "../../../assets/inject/renderer-inject/40-backend-settings.js";
const renderer = readFileSync(new URL(rendererPath, import.meta.url), "utf8");
const ast = ts.createSourceFile("renderer.js", renderer, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);

function declaration(name: string) {
  const node = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === name);
  assert.ok(node, `Missing function ${name}`);
  return node.getText(ast);
}

test("renderer advertisement paths return empty data without network or bridge access", async () => {
  const fail = () => { throw new Error("Advertisement network access is forbidden"); };
  const context = vm.createContext({ fetch: fail, postJson: fail });
  vm.runInContext(`let codexPlusAds = [{ title: 'stale sponsor' }]; let codexPlusAdsLoaded = false;
    ${declaration("directFetchCodexPlusAds")}
    ${declaration("fetchCodexPlusAds")}`, context);
  assert.equal(JSON.stringify(await vm.runInContext("directFetchCodexPlusAds()", context)), '{"version":1,"ads":[]}');
  await vm.runInContext("fetchCodexPlusAds()", context);
  assert.equal(vm.runInContext("codexPlusAds.length", context), 0);
  assert.equal(vm.runInContext("codexPlusAdsLoaded", context), true);
  assert.doesNotMatch(renderer, /https:\/\/ads\.codexpp|Ad-List[\/@]/);
});

test("advertising navigation and UI are not rendered", () => {
  assert.doesNotMatch(declaration("renderCodexPlusPageNavItems"), /key: "sponsor"/);
  assert.doesNotMatch(declaration("installCodexPlusRailNavigation"), /id: codexPlusRailSponsorId,/);
  assert.doesNotMatch(renderer, /data-codex-plus-panel="sponsor"/);
  const context = vm.createContext({ codexPlusExtensionsTab: "extensions" });
  vm.runInContext(declaration("codexPlusModalTab"), context);
  assert.equal(vm.runInContext('codexPlusModalTab("sponsor")', context), "home");
});
