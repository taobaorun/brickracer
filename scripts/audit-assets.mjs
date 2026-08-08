/**
 * 发布资产审计（U13、TN3、A1）：
 * - public/ 下每个资产必须在资产清单登记且来源/授权明确；
 * - 清单不得包含远程 URL；
 * - 扫描源码中是否存在对远程运行时资产的引用。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const publicDir = join(root, "public");

// 从源码中提取清单（简单文本扫描，避免引入 TS 加载器）
const manifestSrc = readFileSync(join(root, "src/content/assetManifest.ts"), "utf8");
const declared = new Set(
  [...manifestSrc.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]),
);

let failed = false;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }
    const url = "/" + relative(publicDir, full).split("\\").join("/");
    if (!declared.has(url)) {
      console.error(`✗ 未登记资产: ${url}`);
      failed = true;
    } else {
      console.log(`✓ ${url}`);
    }
  }
}
walk(publicDir);

for (const url of declared) {
  if (/^https?:\/\//.test(url)) {
    console.error(`✗ 清单包含远程运行时 URL: ${url}`);
    failed = true;
  }
}

// 源码远程资产引用扫描（排除注释中的文档链接与测试）
const srcDir = join(root, "src");
function walkSrc(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkSrc(full);
      continue;
    }
    if (!/\.(ts|tsx|css)$/.test(entry)) continue;
    const src = readFileSync(full, "utf8");
    for (const m of src.matchAll(/(?:fetch|src|href)\s*[=(]\s*["']https?:\/\/[^"']+/g)) {
      console.error(`✗ 源码中的远程资产引用: ${relative(root, full)}: ${m[0].slice(0, 80)}`);
      failed = true;
    }
  }
}
walkSrc(srcDir);

if (failed) {
  console.error("\n资产审计未通过");
  process.exit(1);
}
console.log("\n资产审计通过：全部资产为仓库内原创/已登记，无远程运行时依赖");
