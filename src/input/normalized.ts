/** 所有输入设备先归一化为同一组领域动作（I7）。 */
export interface NormalizedInput {
  steer: number; // -1..1
  throttle: number; // 0..1
  brake: number; // 0..1
  resetPressed: boolean;
  pausePressed: boolean;
}

export const NEUTRAL_INPUT: NormalizedInput = {
  steer: 0,
  throttle: 0,
  brake: 0,
  resetPressed: false,
  pausePressed: false,
};

export function clampInput(input: NormalizedInput): NormalizedInput {
  const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
  return {
    steer: Math.min(1, Math.max(-1, input.steer)),
    throttle: clamp01(input.throttle),
    brake: clamp01(input.brake),
    resetPressed: input.resetPressed,
    pausePressed: input.pausePressed,
  };
}
