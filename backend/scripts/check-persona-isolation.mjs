#!/usr/bin/env node
// 人设防手滑检查：后端代码里出现"某个具体人设"的字眼时，必须是"在该人设的开关分支里"，否则报错。
// 用法：npm run check:persona   （退出码 1 = 有违规）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIR = path.join(ROOT, "functions");
const FORBIDDEN = ["星暮", "苏棠", "王雅慧", "旧数码", "回收", "电商运营", "宝马X3"];
const GATE_TOKENS = ["xingmuScope", "xingmuSoulScope", "starSoulScope", "xingmuPersona", "isXingmu", "XINGMU_"];
const ALLOW_MARK = "persona-guard: ok";
const LOOKBACK = 20;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function stripComment(line) {
  const i = line.indexOf("//");
  return i >= 0 ? line.slice(0, i) : line;
}

const violations = [];
for (const file of walk(SCAN_DIR)) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  // 整个文件本来就是"某个人设专属模块"时，允许在文件头声明放行
  if (lines.slice(0, 5).join("\n").includes("persona-guard: ok (file)")) continue;
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    const code = stripComment(line);
    if (!code.trim()) return;
    const hit = FORBIDDEN.find((term) => code.includes(term));
    if (!hit) return;
    const window = lines.slice(Math.max(0, index - LOOKBACK), index + 1).join("\n");
    if (window.includes(ALLOW_MARK)) return;
    if (GATE_TOKENS.some((token) => window.includes(token))) return;
    violations.push({ file: rel, line: index + 1, term: hit, text: line.trim().slice(0, 110) });
  });
}

if (!violations.length) {
  console.log("✅ 人设隔离检查通过：没有裸奔的人设字眼（全部在对应人设的分支里）");
  process.exit(0);
}
console.log("❌ 发现 " + violations.length + " 处可疑的人设字眼（不在人设分支里）：");
for (const v of violations) console.log("   " + v.file + ":" + v.line + "  [" + v.term + "]  " + v.text);
console.log("");
console.log("处理办法：改成按 xingmuScope/starSoulScope 分支，或按人设从数据库取；确实必须这样写就在附近加注释 " + ALLOW_MARK);
process.exit(1);