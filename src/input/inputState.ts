import { NEUTRAL_INPUT, clampInput, type NormalizedInput } from "./normalized";

export type InputListener = (input: NormalizedInput) => void;

/** 键盘/指针/触控共享的归一化输入合成器（I7）。 */
export class InputState {
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private resetPressed = false;
  private pausePressed = false;
  private readonly listeners = new Set<InputListener>();

  setPartial(patch: Partial<Pick<NormalizedInput, "steer" | "throttle" | "brake">>): void {
    if (patch.steer !== undefined) this.steer = patch.steer;
    if (patch.throttle !== undefined) this.throttle = patch.throttle;
    if (patch.brake !== undefined) this.brake = patch.brake;
    this.emit();
  }

  pressReset(): void {
    // 锁存：保持置位直到消费方（GameRuntime 固定步）消费并清除
    this.resetPressed = true;
    this.emit();
  }

  pressPause(): void {
    this.pausePressed = true;
    this.emit();
  }

  snapshot(): NormalizedInput {
    return clampInput({
      steer: this.steer,
      throttle: this.throttle,
      brake: this.brake,
      resetPressed: this.resetPressed,
      pausePressed: this.pausePressed,
    });
  }

  reset(): void {
    this.steer = 0;
    this.throttle = 0;
    this.brake = 0;
    this.resetPressed = false;
    this.pausePressed = false;
    this.emit();
  }

  subscribe(listener: InputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  neutral(): NormalizedInput {
    return NEUTRAL_INPUT;
  }
}
