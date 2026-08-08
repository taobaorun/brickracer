import { useEffect, useMemo, useRef, useState } from "react";
import { AppController } from "./AppController";
import type { AppSnapshot } from "./state";
import { BuilderPanel } from "../ui/BuilderPanel";
import { RaceHud } from "../ui/RaceHud";
import { ResultsScreen } from "../ui/ResultsScreen";
import { ShopScreen } from "../ui/ShopScreen";
import { SettingsScreen } from "../ui/SettingsScreen";
import { attachKeyboard } from "../input/keyboard";

let controllerSingleton: AppController | null = null;

export function getController(): AppController {
  if (!controllerSingleton) {
    controllerSingleton = new AppController(window.localStorage);
  }
  return controllerSingleton;
}

export function App() {
  const controller = useMemo(getController, []);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [snapshot, setSnapshot] = useState<AppSnapshot>(controller.snapshot);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = controller.subscribe(setSnapshot);
    const detachKeyboard = attachKeyboard(controller.input, window);
    let unsubRt: (() => void) | null = null;
    const canvas = canvasRef.current;
    if (canvas) {
      controller
        .boot(canvas)
        .then(() => {
          // 发动机声浪：节流 HUD 快照 → 音频遥测（R7）
          unsubRt = controller.subscribeRuntimeSnapshots((s) => {
            controller.audio.updateTelemetry({
              speedRatio: Math.min(1, s.speed / 45),
              throttle: controller.input.snapshot().throttle,
            });
          });
        })
        .catch((err: unknown) => setBootError(err instanceof Error ? err.message : String(err)));
    }
    // 首次手势解锁音频
    const unlock = () => {
      void controller.audio.unlock().then(() => controller.audio.load());
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    // 开发/测试诊断挂载（设计：运行时诊断仅在开发/测试构建暴露）
    if (new URLSearchParams(window.location.search).has("diagnostics")) {
      void import("../content/track").then(({ TRACK_BRICKWAY_1 }) => {
        (window as unknown as Record<string, unknown>).__brickracer = {
          controller,
          track: TRACK_BRICKWAY_1,
        };
      });
    }
    return () => {
      unsub();
      unsubRt?.();
      detachKeyboard();
      window.removeEventListener("pointerdown", unlock);
    };
  }, [controller]);

  const screen = snapshot.screen;

  return (
    <div className={`app screen-${screen.name}`}>
      <canvas
        ref={canvasRef}
        data-testid="game-canvas"
        className={screen.name === "racing" || screen.name === "race-loading" || screen.name === "results" ? "race" : "builder"}
      />
      {bootError && (
        <div className="overlay" role="alert">
          <p>启动失败：{bootError}</p>
          <button onClick={() => window.location.reload()}>重试</button>
        </div>
      )}
      {screen.name === "boot" && (
        <div className="overlay" data-testid="boot">
          <h1>积木赛车</h1>
          <p>正在加载…</p>
        </div>
      )}
      {screen.name === "unsupported" && (
        <div className="overlay" role="alert" data-testid="unsupported">
          <h1>积木赛车</h1>
          <p>{screen.reason}</p>
        </div>
      )}
      {screen.name === "builder" && <BuilderPanel controller={controller} snapshot={snapshot} />}
      {(screen.name === "racing" || screen.name === "race-loading") && (
        <RaceHud controller={controller} snapshot={snapshot} />
      )}
      {screen.name === "results" && <ResultsScreen controller={controller} snapshot={snapshot} />}
      {screen.name === "shop" && <ShopScreen controller={controller} snapshot={snapshot} />}
      {screen.name === "settings" && <SettingsScreen controller={controller} snapshot={snapshot} />}
      {snapshot.saveStatus === "unsaved" && (
        <div className="toast" data-testid="save-unsaved">进度未保存（存储空间不足）</div>
      )}
      {snapshot.saveStatus === "stale-external" && (
        <div className="toast" data-testid="save-stale">进度已在另一个页面更新</div>
      )}
    </div>
  );
}
