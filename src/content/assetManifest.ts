/**
 * 资产清单（TN3、A1、I10）：记录每个运行时资产的来源与授权。
 * 一期所有音频均为仓库内脚本生成的原创素材（scripts/generate-audio.mjs），
 * 不依赖任何第三方品牌或外部授权。新增资产必须登记来源；
 * 发布审计（U13）拒绝未知来源或远程运行时 URL。
 */
export interface AudioAsset {
  id: string;
  url: string;
  origin: "generated-in-repo";
  license: "original";
  loop: boolean;
}

export const AUDIO_ASSETS: readonly AudioAsset[] = [
  { id: "engine-idle", url: "/audio/engine-idle.wav", origin: "generated-in-repo", license: "original", loop: true },
  { id: "engine-mid", url: "/audio/engine-mid.wav", origin: "generated-in-repo", license: "original", loop: true },
  { id: "engine-high", url: "/audio/engine-high.wav", origin: "generated-in-repo", license: "original", loop: true },
  { id: "collision", url: "/audio/collision.wav", origin: "generated-in-repo", license: "original", loop: false },
  { id: "checkpoint", url: "/audio/checkpoint.wav", origin: "generated-in-repo", license: "original", loop: false },
  { id: "purchase", url: "/audio/purchase.wav", origin: "generated-in-repo", license: "original", loop: false },
] as const;
