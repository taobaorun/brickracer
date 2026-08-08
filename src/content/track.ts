/**
 * brickway-1：唯一默认积木赛道。固定手工内容定义——封闭中线、宽度、
 * 起点网格、有序检查点、复位变换与速度参考线。不是程序化/玩家生成赛道。
 */
export interface TrackDefinition {
  id: "brickway-1";
  /** 封闭中线，首尾相连；单位米。+x 右，-z 前。 */
  centerline: Array<{ x: number; z: number }>;
  halfWidth: number;
  checkpoints: Array<{ x: number; z: number; radius: number }>;
  startGrid: Array<{ x: number; y: number; z: number; rotationY: number }>;
  laps: number;
  aiCount: number;
}

function roundedRectCenterline(): Array<{ x: number; z: number }> {
  // 44m x 28m 圆角矩形，半径 7m，每弧 5 个点（单圈约 40–60 秒，两场足以学会）
  const hw = 30;
  const hd = 20;
  const r = 10;
  const pts: Array<{ x: number; z: number }> = [];
  const arc = (cx: number, cz: number, a0: number, a1: number) => {
    for (let i = 0; i <= 5; i += 1) {
      const a = a0 + ((a1 - a0) * i) / 5;
      pts.push({ x: cx + r * Math.cos(a), z: cz + r * Math.sin(a) });
    }
  };
  // 从起点（北侧直道中点，朝 +x 方向发车）顺时针
  for (let x = 0; x <= hw - r; x += 5) pts.push({ x, z: -hd });
  arc(hw - r, -hd + r, -Math.PI / 2, 0);
  for (let z = -hd + r; z <= hd - r; z += 5) pts.push({ x: hw, z });
  arc(hw - r, hd - r, 0, Math.PI / 2);
  for (let x = hw - r; x >= -(hw - r); x -= 5) pts.push({ x, z: hd });
  arc(-(hw - r), hd - r, Math.PI / 2, Math.PI);
  for (let z = hd - r; z >= -(hd - r); z -= 5) pts.push({ x: -hw, z });
  arc(-(hw - r), -(hd - r), Math.PI, (3 * Math.PI) / 2);
  for (let x = -(hw - r); x < 0; x += 5) pts.push({ x, z: -hd });
  return pts;
}

const centerline = roundedRectCenterline();

/** 均匀取 8 个有序检查点（含起点线 index 0）；半径略大于半宽，贴护栏也不会漏检。 */
function pickCheckpoints(): TrackDefinition["checkpoints"] {
  const n = centerline.length;
  const out: TrackDefinition["checkpoints"] = [];
  for (let i = 0; i < 8; i += 1) {
    const p = centerline[Math.floor((i * n) / 8)]!;
    out.push({ x: p.x, z: p.z, radius: 6 });
  }
  return out;
}

export const TRACK_BRICKWAY_1: TrackDefinition = {
  id: "brickway-1",
  centerline,
  halfWidth: 7,
  checkpoints: pickCheckpoints(),
  startGrid: [
    // 沿发车直道交错排开（真实发车格），避免起跑即堆叠
    { x: -3, y: 1.2, z: -18.5, rotationY: Math.PI / 2 },
    { x: -8, y: 1.2, z: -21.5, rotationY: Math.PI / 2 },
    { x: -13, y: 1.2, z: -18.5, rotationY: Math.PI / 2 },
    { x: -18, y: 1.2, z: -21.5, rotationY: Math.PI / 2 },
  ],
  laps: 2,
  aiCount: 3,
};
