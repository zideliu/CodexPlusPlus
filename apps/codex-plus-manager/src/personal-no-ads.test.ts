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

test("manager and backend keep the personal no-ads boundary after upstream merges", () => {
  const manager = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("App.tsx", manager, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const home = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "HomeScreen");
  assert.ok(home, "HomeScreen must remain inspectable");
  assert.doesNotMatch(home.getText(source), /home-hero|home-sponsor|featuredAds|刷新推荐/);
  assert.doesNotMatch(manager, /call<AdsResult>\("load_ads"\)|cx-float-hint-main/);
  const catalog = readFileSync(new URL("./GatewayProviders.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(catalog, /key: "sponsor"/);
  const backend = readFileSync(new URL("../../../crates/codex-plus-core/src/ads.rs", import.meta.url), "utf8");
  const entry = backend.match(/pub async fn fetch_ad_list\(\)[\s\S]*?\n\}/)?.[0];
  assert.ok(entry, "Backend advertisement entry must remain inspectable");
  assert.match(entry, /Ok\(json!\(\{ "version": 1, "ads": \[\] \}\)\)/);
  assert.doesNotMatch(entry, /\.await|fetch_ad_list_from_urls|reqwest|client/);
});

test("in-app updates stay on the personal channel and carry the checksum to installation", () => {
  const manager = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const commands = readFileSync(new URL("../src-tauri/src/commands.rs", import.meta.url), "utf8");
  const updater = readFileSync(new URL("../../../crates/codex-plus-core/src/update.rs", import.meta.url), "utf8");
  const version = readFileSync(new URL("../../../crates/codex-plus-core/src/version.rs", import.meta.url), "utf8");
  assert.match(updater, /https:\/\/github.com\/zideliu\/CodexPlusPlus\/releases\/latest\/download\/latest.json/);
  assert.doesNotMatch(updater, /BigPizzaV3/);
  assert.match(manager, /sha256: selected.sha256/);
  assert.match(commands, /"sha256": update.sha256/);
  assert.match(version, /option_env!\("CODEX_PLUS_BUILD_VERSION"\)/);
});
