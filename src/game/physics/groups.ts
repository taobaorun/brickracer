/**
 * 碰撞分组：赛道与车辆交互；车辆之间不互相碰撞（一期为幽灵车决策，
 * 避免起跑堆叠与不可恢复的多车卡死；驾驶容错由护轨/复位/回正提供）。
 * Rapier 分组格式：高 16 位 membership，低 16 位 filter。
 */
export const GROUP_TRACK = 0x1;
export const GROUP_CAR = 0x2;

export function collisionGroups(membership: number, filter: number): number {
  return (membership << 16) | filter;
}
