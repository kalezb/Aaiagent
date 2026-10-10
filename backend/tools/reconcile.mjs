// 对账：把"手机里的对话"和"云端历史"逐条比，看顺序/角色/有没有丢话。
// 用法：node tools/reconcile.mjs <手机快照json> <联系人> <云端json>
// 手机快照 json：{ "联系人": [ { role, content, at } ] }
// 云端 json：wrangler d1 execute ... --json 的输出（数组里第一段 results）
import fs from "node:fs";

const [phoneFile, contact, cloudFile] = process.argv.slice(2);
if (!phoneFile || !contact || !cloudFile) {
  console.error("用法: node tools/reconcile.mjs <手机快照json> <联系人> <云端json>");
  process.exit(1);
}
const phoneAll = JSON.parse(fs.readFileSync(phoneFile, "utf8"));
const phone = phoneAll[contact] || [];
const rawCloud = fs.readFileSync(cloudFile, "utf8").replace(/\u0000/g, "").replace(/^\uFEFF/, "");
const cloud = JSON.parse(rawCloud.slice(rawCloud.indexOf("[")))[0].results || [];

const norm = (s) => String(s || "").replace(/\s+/g, "").slice(0, 60);
console.log("联系人：" + contact);
console.log("手机快照：" + phone.length + " 条   云端：" + cloud.length + " 条");

const cloudSet = new Set(cloud.map((m) => norm(m.content)));
const missing = phone.filter((m) => !cloudSet.has(norm(m.content)));
console.log("\n手机里有、云端没有的：" + (missing.length ? "" : "（无）"));
for (const m of missing) console.log("  " + (m.role === "assistant" ? "她" : "他") + " " + String(m.content).slice(0, 50));

// 角色是否对得上
const roleWrong = phone.filter((m) => {
  const hit = cloud.find((c) => norm(c.content) === norm(m.content));
  return hit && hit.role !== m.role;
});
console.log("\n角色对不上的：" + (roleWrong.length ? "" : "（无）"));
for (const m of roleWrong) {
  const hit = cloud.find((c) => norm(c.content) === norm(m.content));
  console.log("  " + String(m.content).slice(0, 30) + "  手机=" + m.role + " 云端=" + hit.role);
}

// 顺序：取手机那一屏在云端的位置，看是否单调
const positions = phone.map((m) => cloud.findIndex((c) => norm(c.content) === norm(m.content))).filter((i) => i >= 0);
let inversions = 0;
for (let i = 1; i < positions.length; i++) if (positions[i] < positions[i - 1]) inversions++;
console.log("\n顺序：可定位 " + positions.length + " 条，逆序 " + inversions + " 处" + (inversions === 0 ? "（一致）" : "（不一致）"));
