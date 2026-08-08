import { describe, expect, it } from "vitest";
import { InputState } from "../../src/input/inputState";

describe("InputState edge-trigger latching (F1 regression)", () => {
  it("reset/pause stay latched until reset(); no repeat after clear", () => {
    const state = new InputState();
    const seen: boolean[] = [];
    state.subscribe((input) => seen.push(input.resetPressed));

    state.pressReset();
    expect(state.snapshot().resetPressed).toBe(true); // 锁存：等待消费
    expect(seen).toEqual([true]);

    state.reset();
    expect(state.snapshot().resetPressed).toBe(false);
    expect(seen).toEqual([true, false]);

    state.pressPause();
    expect(state.snapshot().pausePressed).toBe(true);
  });

  it("continuous axes clamp and combine", () => {
    const state = new InputState();
    state.setPartial({ steer: -2, throttle: 1.5 });
    const s = state.snapshot();
    expect(s.steer).toBe(-1);
    expect(s.throttle).toBe(1);
  });
});
