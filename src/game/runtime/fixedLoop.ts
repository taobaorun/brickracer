export const FIXED_DT = 1 / 60;
/** 长时间挂起后丢弃多余累积时间，拒绝无限追帧（I8）。 */
export const MAX_ACCUMULATED = 0.25;

export class FixedStepAccumulator {
  private accumulated = 0;

  /** 返回本次应推进的固定步数；超出上限的时间被丢弃。 */
  advance(frameDt: number): number {
    this.accumulated = Math.min(this.accumulated + Math.max(0, frameDt), MAX_ACCUMULATED);
    let steps = 0;
    while (this.accumulated >= FIXED_DT) {
      this.accumulated -= FIXED_DT;
      steps += 1;
    }
    return steps;
  }

  reset(): void {
    this.accumulated = 0;
  }
}
