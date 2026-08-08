/**
 * 生成一期原创音频素材（WAV, 16-bit PCM mono 22050Hz）：
 * - engine-idle/mid/high：锯齿波 + 低通包络的短循环，转速感不同
 * - collision/checkpoint/purchase：一次性音效
 * 输出到 public/audio/。这些文件由本仓库原创生成，无第三方授权依赖。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SR = 22050;
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "audio");
mkdirSync(outDir, { recursive: true });

function wavHeader(dataLength) {
  const buf = Buffer.alloc(44);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataLength, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataLength, 40);
  return buf;
}

function writeWav(name, samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2);
  });
  writeFileSync(join(outDir, name), Buffer.concat([wavHeader(data.length), data]));
  console.log("wrote", name, samples.length, "samples");
}

function saw(phase) {
  return 2 * (phase - Math.floor(phase)) - 1;
}

/** 引擎循环：基频 + 谐波锯齿，整循环相位连续可无縫 loop。 */
function engineLoop(freq, seconds, brightness) {
  const cycles = Math.max(1, Math.round(freq * seconds));
  const n = Math.round((cycles / freq) * SR);
  const out = new Array(n);
  let lp = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    const ph = t * freq;
    let v = saw(ph) * 0.5 + saw(ph * 2.01) * 0.25 * brightness + saw(ph * 0.5) * 0.35;
    v += (Math.random() - 0.5) * 0.05; // 轻微粗糙感
    lp += (v - lp) * (0.12 + brightness * 0.25);
    out[i] = lp * 0.7;
  }
  return out;
}

function tone(freq, seconds, decay, type = "sine") {
  const n = Math.round(seconds * SR);
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    const env = Math.exp(-t * decay);
    const osc = type === "square" ? Math.sign(Math.sin(2 * Math.PI * freq * t)) : Math.sin(2 * Math.PI * freq * t);
    out[i] = osc * env * 0.5;
  }
  return out;
}

function noiseBurst(seconds, decay) {
  const n = Math.round(seconds * SR);
  const out = new Array(n);
  let lp = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    const env = Math.exp(-t * decay);
    lp += (Math.random() * 2 - 1 - lp) * 0.3;
    out[i] = lp * env * 0.8;
  }
  return out;
}

writeWav("engine-idle.wav", engineLoop(55, 1.2, 0.4));
writeWav("engine-mid.wav", engineLoop(110, 1.0, 0.7));
writeWav("engine-high.wav", engineLoop(196, 0.8, 1.0));
writeWav("collision.wav", noiseBurst(0.5, 9));
writeWav("checkpoint.wav", tone(880, 0.25, 12, "square"));
writeWav("purchase.wav", tone(1320, 0.3, 8));
