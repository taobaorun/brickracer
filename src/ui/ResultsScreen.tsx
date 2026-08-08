import type { AppController } from "../app/AppController";
import type { AppSnapshot } from "../app/state";

const PLACE_TEXT: Record<number, string> = { 1: "冠军！🏆", 2: "第二名！🥈", 3: "第三名！🥉" };

export function ResultsScreen({
  controller,
  snapshot,
}: {
  controller: AppController;
  snapshot: AppSnapshot;
}) {
  const screen = snapshot.screen;
  if (screen.name !== "results") return null;
  return (
    <div className="overlay results" data-testid="results-screen">
      <h1 data-testid="results-place">{PLACE_TEXT[screen.place] ?? `第 ${screen.place} 名`}</h1>
      <p data-testid="results-awarded">获得 ⭐ {screen.awarded} 积分</p>
      <p data-testid="results-points">现在共有 ⭐ {screen.points}</p>
      <div className="row">
        <button className="primary" data-testid="go-shop" onClick={() => controller.openShop()}>
          去商店买部件
        </button>
        <button data-testid="race-again" onClick={() => void controller.startRace()}>再比一场</button>
        <button data-testid="back-to-builder" onClick={() => controller.enterBuilder()}>改车</button>
      </div>
    </div>
  );
}
