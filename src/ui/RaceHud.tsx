import { useEffect, useState } from "react";
import type { AppController } from "../app/AppController";
import type { AppSnapshot } from "../app/state";
import type { RuntimeSnapshot } from "../game/runtime/gameRuntime";
import { TRACK_BRICKWAY_1 } from "../content/track";

/** 比赛 HUD：速度/圈数/名次/倒计时 + 触屏踏板与方向（I7 同一归一化输入）。 */
export function RaceHud({
  controller,
  snapshot,
}: {
  controller: AppController;
  snapshot: AppSnapshot;
}) {
  const [rt, setRt] = useState<RuntimeSnapshot | null>(null);
  const [portrait, setPortrait] = useState(
    () => window.matchMedia?.("(orientation: portrait)").matches ?? false,
  );

  useEffect(() => controller.subscribeRuntimeSnapshots(setRt), [controller]);

  useEffect(() => {
    const mq = window.matchMedia("(orientation: portrait)");
    const onChange = () => {
      setPortrait(mq.matches);
      if (mq.matches && snapshot.screen.name === "racing" && !snapshot.screen.paused) {
        // 竖屏：自动暂停并给出旋转提示（D2）
        controller.setRacePaused(true);
      }
    };
    mq.addEventListener("change", onChange);
    onChange();
    return () => mq.removeEventListener("change", onChange);
  }, [controller, snapshot.screen]);

  const screen = snapshot.screen;
  const paused = screen.name === "racing" && screen.paused;
  const countdown = rt?.countdownMs ?? 0;

  return (
    <div className="race-hud" data-testid="race-hud">
      <div className="hud-top">
        <div className="hud-stat" data-testid="hud-speed">{Math.round(rt?.speed ?? 0)} km/h</div>
        <div className="hud-stat" data-testid="hud-lap">
          圈 {Math.min((rt?.lap ?? 0) + 1, TRACK_BRICKWAY_1.laps)}/{TRACK_BRICKWAY_1.laps}
        </div>
        <div className="hud-stat" data-testid="hud-position">第 {rt?.position ?? 1} 名</div>
      </div>

      {screen.name === "race-loading" && (
        <div className="overlay" data-testid="race-loading">赛道准备中…</div>
      )}
      {screen.name === "racing" && rt?.racePhase === "countdown" && countdown > 0 && (
        <div className="countdown" data-testid="countdown">{Math.ceil(countdown / 1000)}</div>
      )}

      {paused && (
        <div className="overlay" data-testid="pause-menu">
          <h2>{portrait ? "把手机横过来玩更顺手！" : "暂停"}</h2>
          <button data-testid="resume-race" onClick={() => controller.setRacePaused(false)}>继续</button>
          <button data-testid="exit-to-builder" onClick={() => controller.enterBuilder()}>回到车库</button>
          <button
            data-testid="toggle-mute"
            onClick={() => controller.setMuted(!snapshot.save.settings.muted)}
          >
            {snapshot.save.settings.muted ? "打开声音" : "静音"}
          </button>
        </div>
      )}

      <div className="hud-actions">
        <button data-testid="pause-race" onClick={() => controller.setRacePaused(true)}>暂停</button>
        <button
          data-testid="reset-car"
          disabled={!rt?.canReset}
          onClick={() => controller.input.pressReset()}
        >
          回到赛道
        </button>
      </div>

      <div className="touch-controls" data-testid="touch-controls">
        <div className="steer">
          <HoldButton
            testid="steer-left"
            label="◀"
            onChange={(held) => controller.input.setPartial({ steer: held ? -1 : 0 })}
          />
          <HoldButton
            testid="steer-right"
            label="▶"
            onChange={(held) => controller.input.setPartial({ steer: held ? 1 : 0 })}
          />
        </div>
        <div className="pedals">
          <HoldButton
            testid="brake"
            label="刹车"
            onChange={(held) => controller.input.setPartial({ brake: held ? 1 : 0 })}
          />
          <HoldButton
            testid="throttle"
            label="油门"
            onChange={(held) => controller.input.setPartial({ throttle: held ? 1 : 0 })}
          />
        </div>
      </div>
    </div>
  );
}

function HoldButton({
  testid,
  label,
  onChange,
}: {
  testid: string;
  label: string;
  onChange: (held: boolean) => void;
}) {
  return (
    <button
      data-testid={testid}
      className="hold"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onChange(true);
      }}
      onPointerUp={() => onChange(false)}
      onPointerCancel={() => onChange(false)}
      onPointerLeave={() => onChange(false)}
    >
      {label}
    </button>
  );
}
