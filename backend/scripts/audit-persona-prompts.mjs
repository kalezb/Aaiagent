#!/usr/bin/env node
// 人设隔离审计：让每个客服在若干场景下各走一次真实接口，把"发给模型的完整系统提示词"抓回来，
// 逐字搜"别人设"的词。用法：npm run audit:persona  （退出码 1 = 有污染）
// 依赖 scripts/persona-audit.tokens.json（不进仓库）：[{ key, label, token }]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const API = process.env.AUDIT_API || "https://ai-agent-api.pages.dev";
const TOKENS_FILE = path.join(ROOT, "scripts", "persona-audit.tokens.json");

const FOREIGN = {
  sutang: ["旧数码", "旧手机", "回收", "上门收", "报价", "验机", "宝马X3", "王雅慧", "离过婚", "前夫", "星暮"],
  xingmu: ["电商运营", "按摩", "三岁", "3岁", "带娃", "已婚", "我老公", "婆婆", "苏棠"],
};
const SCENARIOS = [
  ["问候", "在吗"],
  ["问工作", "你是做什么工作的"],
  ["问年龄", "你多大了"],
  ["问婚姻", "你结婚了吗"],
  ["要照片", "发张照片看看"],
  ["暧昧", "宝贝 想你了"],
  ["要微信", "加个微信吧"],
  ["聊旧物", "你家有旧手机要处理吗"],
  ["被夸", "你真是个女强人"],
];
// 引用对方原话/时间线里出现的词不算污染
const QUOTE_MARKERS = ["【对方原话事实】", "对方：", "【未回复消息时间线】"];

if (!fs.existsSync(TOKENS_FILE)) {
  console.log("缺少 " + TOKENS_FILE + "，格式：[{ key, label, token }]");
  process.exit(2);
}
const personas = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
let failed = 0;

for (const persona of personas) {
  const foreign = FOREIGN[persona.key] || [];
  console.log("===== " + persona.label + " =====");
  for (const [tag, text] of SCENARIOS) {
    const now = Math.floor(Date.now() / 1000);
    let body;
    try {
      const resp = await fetch(API + "/api/chat", {
        method: "POST",
        headers: { Authorization: "Bearer " + persona.token, "Content-Type": "application/json" },
        body: JSON.stringify({
          token: persona.token, platform: "soul", hosting_mode: "full_auto", debug_prompt: true,
          request_id: "audit-" + tag + "-" + now + "-" + Math.random().toString(36).slice(2, 7),
          contact_id: "audit_" + tag, contact_name: "审计用",
          messages: [{ role: "assistant", content: "在的" }, { role: "user", content: text, created_at: now - 15 }],
        }),
      });
      body = await resp.json();
    } catch (error) {
      console.log("  " + tag + "  ⚠️ 请求失败：" + String(error).slice(0, 60));
      failed += 1;
      continue;
    }
    const prompt = String(body.debug_system_prompt || "");
    const promptForCheck = prompt.split(/\r?\n/)
      .filter((line) => !QUOTE_MARKERS.some((marker) => line.includes(marker)))
      .join("\n");
    const hits = foreign.filter((term) => promptForCheck.includes(term));
    const replyHits = foreign.filter((term) => String(body.reply || "").includes(term));
    if (hits.length) failed += 1;
    console.log("  " + tag + (tag.length < 4 ? "\t" : "") + "\t" +
      (hits.length ? "❌ 提示词污染 " + hits.join("/") : "✅ 提示词干净") +
      " | " + (replyHits.length ? "❌ 回复污染 " + replyHits.join("/") : "✅ 回复干净") +
      " | 回复=" + String(body.reply || "").slice(0, 24));
  }
}

console.log("");
if (failed) {
  console.log("❌ 审计未通过，共 " + failed + " 处问题");
  process.exit(1);
}
console.log("✅ 人设隔离审计通过：所有客服、所有场景都没有串味");