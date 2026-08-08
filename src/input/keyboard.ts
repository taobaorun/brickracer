import type { InputState } from "./inputState";

/** 键盘映射：方向键/WASD 驾驶，R 复位，Esc/P 暂停。 */
export function attachKeyboard(state: InputState, target: Window): () => void {
  const held = new Set<string>();
  const recompute = () => {
    const left = held.has("arrowleft") || held.has("a");
    const right = held.has("arrowright") || held.has("d");
    const up = held.has("arrowup") || held.has("w");
    const down = held.has("arrowdown") || held.has("s");
    state.setPartial({
      steer: (left ? -1 : 0) + (right ? 1 : 0),
      throttle: up ? 1 : 0,
      brake: down ? 1 : 0,
    });
  };
  const onDown = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (["arrowleft", "arrowright", "arrowup", "arrowdown", "a", "d", "w", "s"].includes(key)) {
      held.add(key);
      recompute();
      e.preventDefault();
    } else if (key === "r") {
      state.pressReset();
    } else if (key === "escape" || key === "p") {
      state.pressPause();
    }
  };
  const onUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    if (held.delete(key)) recompute();
  };
  const onBlur = () => {
    held.clear();
    state.reset();
  };
  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  target.addEventListener("blur", onBlur);
  return () => {
    target.removeEventListener("keydown", onDown);
    target.removeEventListener("keyup", onUp);
    target.removeEventListener("blur", onBlur);
  };
}
