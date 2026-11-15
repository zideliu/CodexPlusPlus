import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { it } from "node:test";

it("自用版启动不发广告请求，侧栏工具和配置仍能加载", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const effect = source.slice(source.indexOf("    void refreshTools(true);"));
  const startup = effect.slice(0, effect.indexOf("  }, []);"));
  const events: string[] = [];
  let releaseAds!: () => void;
  const pendingAds = new Promise<void>((resolve) => { releaseAds = resolve; });
  const noOp = async () => {};
  const dependencies = {
    refreshTools: async () => { events.push("tools"); },
    run: async (task: () => Promise<unknown>) => await task(),
    call: async () => ({ showUpdate: false }),
    consumePendingManagerNavigation: async () => false,
    setRoute: noOp,
    checkUpdate: noOp,
    refreshOverview: noOp,
    refreshAds: async () => { events.push("ads"); await pendingAds; },
    refreshSettings: async () => { events.push("settings"); },
    refreshRelay: noOp,
    refreshEnvConflicts: noOp,
    refreshProviderSyncTargets: noOp,
    refreshPendingProviderImport: noOp,
    refreshPendingDreamSkinCommunity: noOp,
    releaseMainWindowWhenHidden: () => {},
  };
  // 仅去掉 TS 泛型，让实际启动 effect 在受控异步依赖中运行。
  new Function(...Object.keys(dependencies), startup.replace(/call<StartupResult>/g, "call"))(
    ...Object.values(dependencies),
  );
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(!events.includes("ads"), "自用版不应发出广告请求");
    assert.ok(events.includes("tools"), "工具列表应加载");
    assert.ok(events.includes("settings"), "配置应加载");
  } finally {
    releaseAds();
  }
});
