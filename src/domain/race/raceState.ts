export interface RaceFacts {
  raceId: string;
  place: number;
  totalRacers: number;
  finishTimeMs: number;
  bestLapMs: number;
}

export interface CheckpointDef {
  x: number;
  z: number;
  radius: number;
}

interface RacerProgress {
  lap: number;
  nextCheckpoint: number;
  finished: boolean;
  finishTimeMs: number | null;
  lapStartedMs: number;
  bestLapMs: number | null;
  lastKnownDistanceToNext: number;
}

/**
 * 比赛领域：倒计时、有序检查点、圈数、名次与单次结算令牌。
 * 有序检查点通过是计圈与完赛的唯一权威（I5）。
 * 本模块不接触渲染/物理对象，只接收位置观察。
 */
export class RaceState {
  private readonly progress = new Map<string, RacerProgress>();
  private resultTaken = false;
  private finishOrder: string[] = [];

  constructor(
    public readonly raceId: string,
    private readonly laps: number,
    private readonly checkpoints: CheckpointDef[],
    racerIds: string[],
  ) {
    if (checkpoints.length < 2) throw new Error("race needs at least 2 checkpoints");
    for (const id of racerIds) {
      this.progress.set(id, {
        lap: 0,
        nextCheckpoint: 1, // 0 号为起点线，出发即已“经过”
        finished: false,
        finishTimeMs: null,
        lapStartedMs: 0,
        bestLapMs: null,
        lastKnownDistanceToNext: Infinity,
      });
    }
  }

  /** 每次固定步调用；nowMs 为比赛时钟（暂停时冻结）。 */
  observe(racerId: string, pos: { x: number; z: number }, nowMs: number): void {
    const p = this.progress.get(racerId);
    if (!p || p.finished) return;
    const cp = this.checkpoints[p.nextCheckpoint];
    if (!cp) return;
    const dist = Math.hypot(pos.x - cp.x, pos.z - cp.z);
    p.lastKnownDistanceToNext = dist;
    if (dist > cp.radius) return;

    if (p.nextCheckpoint === 0) {
      // 再次通过起点线 = 完成一圈
      const lapTime = nowMs - p.lapStartedMs;
      if (p.lap > 0 && (p.bestLapMs === null || lapTime < p.bestLapMs)) {
        p.bestLapMs = lapTime;
      }
      p.lap += 1;
      p.lapStartedMs = nowMs;
      if (p.lap >= this.laps) {
        p.finished = true;
        p.finishTimeMs = nowMs;
        this.finishOrder.push(racerId);
        return;
      }
    }
    p.nextCheckpoint = (p.nextCheckpoint + 1) % this.checkpoints.length;
  }

  isFinished(racerId: string): boolean {
    return this.progress.get(racerId)?.finished ?? false;
  }

  lapOf(racerId: string): number {
    return this.progress.get(racerId)?.lap ?? 0;
  }

  /** 当前名次（1 起）：已完成者按完成时间，其余按 圈→检查点→距离。 */
  placeOf(racerId: string): number {
    const entries = [...this.progress.entries()];
    entries.sort(([, a], [, b]) => {
      if (a.finished && b.finished) return (a.finishTimeMs ?? 0) - (b.finishTimeMs ?? 0);
      if (a.finished) return -1;
      if (b.finished) return 1;
      if (a.lap !== b.lap) return b.lap - a.lap;
      if (a.nextCheckpoint !== b.nextCheckpoint) return b.nextCheckpoint - a.nextCheckpoint;
      return a.lastKnownDistanceToNext - b.lastKnownDistanceToNext;
    });
    return entries.findIndex(([id]) => id === racerId) + 1;
  }

  allFinished(): boolean {
    return [...this.progress.values()].every((p) => p.finished);
  }

  /** 单次结算令牌：同一 raceId 只能取出一次结果（I5）。 */
  takeResult(racerId: string): RaceFacts | null {
    if (this.resultTaken) return null;
    const p = this.progress.get(racerId);
    if (!p || !p.finished || p.finishTimeMs === null) return null;
    this.resultTaken = true;
    return {
      raceId: this.raceId,
      place: this.placeOf(racerId),
      totalRacers: this.progress.size,
      finishTimeMs: p.finishTimeMs,
      bestLapMs: p.bestLapMs ?? p.finishTimeMs,
    };
  }
}
