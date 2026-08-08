import type { AppController } from "../app/AppController";
import type { AppSnapshot } from "../app/state";

export function SettingsScreen({
  controller,
  snapshot,
}: {
  controller: AppController;
  snapshot: AppSnapshot;
}) {
  const settings = snapshot.save.settings;
  return (
    <div className="overlay settings" data-testid="settings-screen">
      <h1>设置</h1>
      <label>
        音量
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          data-testid="volume"
          value={settings.masterVolume}
          onChange={(e) => controller.setVolume(Number(e.target.value))}
        />
      </label>
      <label>
        <input
          type="checkbox"
          data-testid="mute"
          checked={settings.muted}
          onChange={(e) => controller.setMuted(e.target.checked)}
        />
        静音
      </label>
      <label>
        画质
        <select
          data-testid="quality"
          value={settings.quality}
          onChange={(e) => controller.setQuality(e.target.value as "auto" | "low" | "high")}
        >
          <option value="auto">自动</option>
          <option value="low">省电</option>
          <option value="high">好看</option>
        </select>
      </label>
      <button data-testid="settings-back" onClick={() => controller.enterBuilder()}>返回</button>
    </div>
  );
}
