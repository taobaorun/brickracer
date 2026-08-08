import { useState } from "react";
import type { AppController } from "../app/AppController";
import type { AppSnapshot } from "../app/state";
import { ALL_PARTS } from "../content/catalog";

const KIND_LABEL: Record<string, string> = {
  engine: "发动机",
  wheelSet: "轮胎",
  aero: "车身",
  bumper: "防撞",
};

export function ShopScreen({
  controller,
  snapshot,
}: {
  controller: AppController;
  snapshot: AppSnapshot;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const save = snapshot.save;

  const buy = (partId: string, price: number) => {
    const r = controller.purchase(partId);
    if (!r.ok) {
      setMessage(r.reason === "insufficient-points" ? "积分不够，再比几场吧！" : "现在买不到这个");
      window.setTimeout(() => setMessage(null), 2200);
    } else {
      setMessage(`买到了！花掉 ⭐ ${price}`);
      window.setTimeout(() => setMessage(null), 2200);
    }
  };

  return (
    <div className="overlay shop" data-testid="shop-screen">
      <h1>部件商店</h1>
      <div className="points" data-testid="shop-points">⭐ {save.points}</div>
      {message && <div className="toast" data-testid="shop-message">{message}</div>}
      <ul className="parts">
        {ALL_PARTS.filter((p) => p.price > 0).map((p) => {
          const owned = save.unlockedPartIds.includes(p.id);
          return (
            <li key={p.id} data-testid={`part-${p.id}`}>
              <span className="kind">{KIND_LABEL[p.kind]}</span>
              <span className="name">{p.name}</span>
              {owned ? (
                <button
                  data-testid={`equip-${p.id}`}
                  onClick={() => {
                    controller.equip(p.id);
                    controller.enterBuilder();
                  }}
                >
                  装上它
                </button>
              ) : (
                <button
                  className="primary"
                  data-testid={`buy-${p.id}`}
                  disabled={save.points < p.price}
                  onClick={() => buy(p.id, p.price)}
                >
                  ⭐ {p.price}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <button data-testid="shop-back" onClick={() => controller.enterBuilder()}>回到车库</button>
    </div>
  );
}
