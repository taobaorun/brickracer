import { useRef, useState } from "react";
import type { AppController } from "../app/AppController";
import type { AppSnapshot } from "../app/state";
import { AERO_PARTS, BRICK_TYPES, BUMPER_PARTS, COLORS, ENGINES, WHEEL_SETS } from "../content/catalog";
import type { InvalidReason } from "../domain/blueprint/types";

const REASON_TEXT: Record<InvalidReason, string> = {
  overlap: "这里已经有积木啦",
  "out-of-bounds": "搭到外面去啦",
  floating: "积木要连在一起哦",
  "reserved-zone": "这里是车轮的位置",
  "unknown-brick": "这块积木不认识",
  "unknown-color": "这个颜色没有啦",
  "unknown-part": "这个部件不认识",
  "too-many-bricks": "积木太多啦，拿掉一些吧",
  "missing-core": "赛车缺了重要部件",
  "not-found": "没找到这块积木",
};

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `ui-${Date.now()}-${idCounter}`;
}

type BuilderMode = "build" | "select";
const TAP_MAX_MS = 500;

export function BuilderPanel({
  controller,
  snapshot,
}: {
  controller: AppController;
  snapshot: AppSnapshot;
}) {
  const [brickTypeId, setBrickTypeId] = useState(BRICK_TYPES[0]!.id);
  const [colorId, setColorId] = useState(COLORS[0]!.id);
  const [mode, setMode] = useState<BuilderMode>("build");
  const [selectedBrick, setSelectedBrick] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // 手势跟踪：单击放置 vs 拖拽环绕 vs 双指缩放
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    downAt: number;
    moved: boolean;
    pinchDist: number | null;
  }>({ pointers: new Map(), downAt: 0, moved: false, pinchDist: null });

  const save = snapshot.save;
  const stats = controller.stats();
  const unlocked = save.unlockedPartIds;

  const showReason = (reason?: InvalidReason | string) => {
    setFeedback(reason ? (REASON_TEXT[reason as InvalidReason] ?? "现在不能这样搭") : null);
    if (reason) window.setTimeout(() => setFeedback(null), 2200);
  };

  const clearSelection = () => {
    setSelectedBrick(null);
    controller.runtime.builderSelect(null);
  };

  const onCanvasTap = (nx: number, ny: number) => {
    const pick = controller.runtime.builderPick(nx, ny);
    if (mode === "select") {
      if (pick.kind === "brick") {
        setSelectedBrick(pick.instanceId);
        controller.runtime.builderSelect(pick.instanceId);
      } else {
        clearSelection();
      }
      return;
    }
    // 搭建模式：面/格位吸附放置（真实积木连接规则）
    const position = pick.kind === "brick" ? pick.faceTarget : pick.kind === "cell" ? pick.position : null;
    if (!position) return;
    const result = controller.builderCommand({
      type: "placeBrick",
      brick: { instanceId: nextId(), brickTypeId, colorId, position, rotation: 0 },
    });
    if (!result.ok) showReason(result.reason);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // 合成事件（测试）或非活动指针：无捕获也能工作
    }
    gesture.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current.downAt = performance.now();
    gesture.current.moved = false;
    gesture.current.pinchDist = null;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const prev = g.pointers.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (g.pointers.size === 2) {
      // 双指捏合缩放
      const [a, b] = [...g.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.pinchDist !== null && g.pinchDist > 0) {
        controller.runtime.builderZoom(g.pinchDist / dist);
      }
      g.pinchDist = dist;
      g.moved = true;
      return;
    }
    if (Math.abs(dx) + Math.abs(dy) > 2) g.moved = true;
    if (g.moved) {
      controller.runtime.builderOrbit(dx * 0.008, dy * 0.006);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const wasTap =
      g.pointers.size === 1 && !g.moved && performance.now() - g.downAt < TAP_MAX_MS;
    g.pointers.delete(e.pointerId);
    g.pinchDist = null;
    if (g.pointers.size === 0) g.moved = false;
    if (!wasTap) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onCanvasTap((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    controller.runtime.builderZoom(e.deltaY > 0 ? 1.1 : 0.9);
  };

  const removeSelected = () => {
    if (!selectedBrick) return;
    const result = controller.builderCommand({ type: "removeBrick", instanceId: selectedBrick });
    showReason(result.ok ? undefined : result.reason);
    clearSelection();
  };

  const rotateSelected = () => {
    if (!selectedBrick) return;
    const brick = save.activeBlueprint.bricks.find((b) => b.instanceId === selectedBrick);
    if (!brick) return;
    const result = controller.builderCommand({
      type: "rotateBrick",
      instanceId: selectedBrick,
      rotation: ((brick.rotation + 1) % 4) as 0 | 1 | 2 | 3,
    });
    showReason(result.ok ? undefined : result.reason);
  };

  const startRace = async () => {
    setStarting(true);
    const result = await controller.startRace();
    setStarting(false);
    if (!result.ok) showReason(result.reason);
  };

  return (
    <div className="builder-ui" data-testid="builder-panel">
      <div
        className="canvas-tap-layer"
        data-testid="canvas-tap-layer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
      <header className="topbar">
        <h1>我的赛车</h1>
        <div className="points" data-testid="points">⭐ {save.points}</div>
        <button data-testid="open-shop" onClick={() => controller.openShop()}>商店</button>
        <button data-testid="open-settings" onClick={() => controller.openSettings()}>设置</button>
      </header>

      {!save.onboarding.completedSteps.includes("finished-race") && (
        <div className="onboarding-hint" data-testid="onboarding-hint">
          {save.onboarding.completedSteps.includes("edited-car")
            ? "改好了就点开始比赛吧！🏁"
            : "点空地或积木的面放新积木，拖动可以转着看！🏎️"}
        </div>
      )}

      <div className="mode-toggle" data-testid="mode-toggle">
        <button
          data-testid="mode-build"
          className={mode === "build" ? "selected" : ""}
          onClick={() => {
            setMode("build");
            clearSelection();
          }}
        >
          🧱 搭建
        </button>
        <button
          data-testid="mode-select"
          className={mode === "select" ? "selected" : ""}
          onClick={() => setMode("select")}
        >
          👆 选择
        </button>
      </div>

      <div className="palette" data-testid="palette">
        <div className="row" role="group" aria-label="积木">
          {BRICK_TYPES.map((b) => (
            <button
              key={b.id}
              data-testid={`brick-${b.id}`}
              className={brickTypeId === b.id ? "selected" : ""}
              onClick={() => setBrickTypeId(b.id)}
            >
              {b.size.w}×{b.size.d}
            </button>
          ))}
        </div>
        <div className="row" role="group" aria-label="颜色">
          {COLORS.map((c) => (
            <button
              key={c.id}
              data-testid={`color-${c.id}`}
              className={`swatch ${colorId === c.id ? "selected" : ""}`}
              style={{ background: c.hex }}
              aria-label={c.id}
              onClick={() => setColorId(c.id)}
            />
          ))}
        </div>
        <p className="hint">
          {mode === "build" ? "点空地或积木的面来搭建；拖动旋转视角。" : "点一块积木选中它，可以旋转或拿掉。"}
        </p>
      </div>

      {mode === "select" && selectedBrick && (
        <div className="selection-actions" data-testid="selection-actions">
          <button data-testid="rotate-brick" onClick={rotateSelected}>转一转</button>
          <button data-testid="remove-brick" onClick={removeSelected}>拿掉</button>
        </div>
      )}

      {feedback && (
        <div className="toast" role="status" data-testid="builder-feedback">{feedback}</div>
      )}

      <div className="slots" data-testid="slots">
        <label>
          发动机
          <select
            data-testid="slot-engine"
            value={save.activeBlueprint.slots.engineId}
            onChange={(e) => {
              const r = controller.equip(e.target.value);
              if (!r.ok) showReason(r.reason);
            }}
          >
            {ENGINES.filter((p) => unlocked.includes(p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label>
          轮胎
          <select
            data-testid="slot-wheels"
            value={save.activeBlueprint.slots.wheelSetId}
            onChange={(e) => {
              const r = controller.equip(e.target.value);
              if (!r.ok) showReason(r.reason);
            }}
          >
            {WHEEL_SETS.filter((p) => unlocked.includes(p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label>
          尾翼
          <select
            data-testid="slot-aero"
            value={save.activeBlueprint.slots.aeroId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const r = v
                ? controller.equip(v)
                : controller.builderCommand({ type: "equipPart", slot: "aeroId", partId: undefined });
              if (!r.ok) showReason(r.reason);
            }}
          >
            <option value="">无</option>
            {AERO_PARTS.filter((p) => unlocked.includes(p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        <label>
          防撞杠
          <select
            data-testid="slot-bumper"
            value={save.activeBlueprint.slots.bumperId ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              const r = v
                ? controller.equip(v)
                : controller.builderCommand({ type: "equipPart", slot: "bumperId", partId: undefined });
              if (!r.ok) showReason(r.reason);
            }}
          >
            <option value="">无</option>
            {BUMPER_PARTS.filter((p) => unlocked.includes(p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="stats" data-testid="stats">
        <Meter label="速度" value={stats.topSpeed / 60} />
        <Meter label="加速" value={stats.acceleration / 40} />
        <Meter label="抓地" value={stats.grip / 2} />
        <Meter label="稳定" value={stats.stability / 1.5} />
      </div>

      <button
        className="primary big"
        data-testid="start-race"
        disabled={starting}
        onClick={() => void startRace()}
      >
        {starting ? "准备中…" : "开始比赛！"}
      </button>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="meter" data-testid={`meter-${label}`}>
      <span>{label}</span>
      <div className="bar"><div className="fill" style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
