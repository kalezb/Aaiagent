import { describe, expect, it, vi } from "vitest";
import {
  formatElapsedDuration,
  formatChinaNaturalTime,
  detectActivityFromReply,
  evaluateActivityState,
  buildTemporalContextPrompt,
  computeRelationshipStage,
  maybeSummarizeConversation,
} from "../functions/api/_temporal_state";
import { resolveContactRequestPolicy } from "../functions/api/_reply_policy";
import { onRequest } from "../functions/api/route";

describe("时间感知与多会话状态管理模块 (_temporal_state)", () => {
  describe("时长与自然时间格式化", () => {
    it("准确格式化大白话时间间隔", () => {
      expect(formatElapsedDuration(30)).toBe("刚刚");
      expect(formatElapsedDuration(120)).toBe("2分钟");
      expect(formatElapsedDuration(7200)).toBe("2小时");
      expect(formatElapsedDuration(8100)).toBe("2小时15分钟");
      expect(formatElapsedDuration(86400 * 3)).toBe("3天");
      expect(formatElapsedDuration(86400 * 14)).toBe("2周");
    });

    it("生成清晰的中国自然时间格式（含星期与时段）", () => {
      // 2026-10-12 21:30:00 是星期一晚上
      const date = new Date("2026-10-12T21:30:00+08:00");
      const formatted = formatChinaNaturalTime(date);
      expect(formatted).toContain("2026年10月12日");
      expect(formatted).toContain("21:30");
      expect(formatted).toContain("星期一");
      expect(formatted).toContain("晚上");
    });
  });

  describe("动作识别 (detectActivityFromReply)", () => {
    it("准确识别去洗漱/洗澡动作", () => {
      expect(detectActivityFromReply("我先去洗漱啦 身上黏黏的")?.type).toBe("wash");
      expect(detectActivityFromReply("冲个凉去 等我会儿")?.type).toBe("wash");
      expect(detectActivityFromReply("准备洗澡去了")?.type).toBe("wash");
    });

    it("准确识别睡觉/晚安动作", () => {
      expect(detectActivityFromReply("太困了 我先睡了 晚安~")?.type).toBe("sleep");
      expect(detectActivityFromReply("困了，睡了")?.type).toBe("sleep");
      expect(detectActivityFromReply("倒头就睡了 晚安")?.type).toBe("sleep");
    });

    it("准确识别吃饭动作", () => {
      expect(detectActivityFromReply("外卖到了 先去吃个饭")?.type).toBe("meal");
      expect(detectActivityFromReply("准备做饭去 饿死了")?.type).toBe("meal");
    });

    it("普通闲聊文本不误识别动作", () => {
      expect(detectActivityFromReply("今天工作真忙，盯了一天报表")).toBeNull();
      expect(detectActivityFromReply("你今天吃火锅还是烤肉呀")).toBeNull();
    });
  });

  describe("动作合理用时与静默防穿帮 (evaluateActivityState)", () => {
    it("洗漱动作在20分钟内静默不回（防已读不回和秒回穿帮）", () => {
      const now = 1000000;
      const actAt = now - 5 * 60; // 5分钟前说去洗漱
      const result = evaluateActivityState("去洗漱", actAt, now);
      expect(result.isSilenced).toBe(true);
      expect(result.silenceReason).toBe("washing_up");
      expect(result.isCompleted).toBe(false);
    });

    it("洗漱动作在25分钟后合理做完，自然带出吹干头发提示", () => {
      const now = 1000000;
      const actAt = now - 25 * 60; // 25分钟前说去洗漱
      const result = evaluateActivityState("去洗漱", actAt, now);
      expect(result.isSilenced).toBe(false);
      expect(result.isCompleted).toBe(true);
      expect(result.activityHint).toContain("刚洗完吹干头发回来");
      expect(result.shouldClear).toBe(true);
    });

    it("洗漱动作超过3小时已是很久以前的事，自动销账并不刻意提及", () => {
      const now = 1000000;
      const actAt = now - 4 * 3600; // 4小时前说去洗漱
      const result = evaluateActivityState("去洗漱", actAt, now);
      expect(result.isSilenced).toBe(false);
      expect(result.isCompleted).toBe(true);
      expect(result.activityHint).toBeUndefined();
      expect(result.shouldClear).toBe(true);
    });

    it("深夜说睡觉后当晚静默不打扰", () => {
      const now = 1000000;
      const actAt = now - 2 * 3600; // 2小时前说睡了，依然是深夜（凌晨2点）
      const result = evaluateActivityState("去睡觉", actAt, now, 2);
      expect(result.isSilenced).toBe(true);
      expect(result.silenceReason).toBe("sleeping");
    });

    it("次日清晨（8点）醒来，带出自然刚醒提示", () => {
      const now = 1000000;
      const actAt = now - 8 * 3600; // 昨晚12点睡，现在早晨8点
      const result = evaluateActivityState("去睡觉", actAt, now, 8);
      expect(result.isSilenced).toBe(false);
      expect(result.isCompleted).toBe(true);
      expect(result.activityHint).toContain("刚醒或昨晚睡得早");
      expect(result.shouldClear).toBe(true);
    });
  });

  describe("时间感知提示词构建 (buildTemporalContextPrompt)", () => {
    it("首次聊天时给出初次聊天事实", () => {
      const prompt = buildTemporalContextPrompt({
        contact: { relationship_stage: "new", mood: "normal" },
      });
      expect(prompt).toContain("【现场时空感知｜硬事实】");
      expect(prompt).toContain("这是你们第一次聊天。");
      expect(prompt).toContain("关系与心情：刚认识｜正常");
    });

    it("刚刚回复过（<10分钟）时提醒连贯聊天不客套", () => {
      const now = 1000000;
      const prompt = buildTemporalContextPrompt({
        contact: {
          last_reply_at: now - 3 * 60,
          relationship_stage: "familiar",
          mood: "happy",
        },
        nowSec: now,
      });
      expect(prompt).toContain("距上次聊天：刚刚（连贯聊天中，不客套、不无故说“好久不见”或“怎么不理我”）");
      expect(prompt).toContain("关系与心情：熟悉｜开心");
    });

    it("间隔超过4小时时标注时间流逝", () => {
      const now = 1000000;
      const prompt = buildTemporalContextPrompt({
        contact: {
          last_reply_at: now - 5 * 3600,
          relationship_stage: "flirty",
        },
        nowSec: now,
      });
      expect(prompt).toContain("距上次聊天：已过 5小时（隔了一段时间，按当前时间自然接话）");
      expect(prompt).toContain("关系与心情：暧昧｜正常");
    });

    it("包含刚做完的事情提示（如刚洗漱完）", () => {
      const prompt = buildTemporalContextPrompt({
        contact: {
          last_reply_at: 1000000 - 25 * 60,
          relationship_stage: "close",
        },
        nowSec: 1000000,
        activityEvaluation: {
          isSilenced: false,
          isCompleted: true,
          shouldClear: true,
          activityHint: "你之前说去洗漱，现在刚洗完吹干头发回来，自然带半句刚洗完吹好头发，再顺畅接对方的话。",
        },
      });
      expect(prompt).toContain("生活状态：你之前说去洗漱，现在刚洗完吹干头发回来");
      expect(prompt).toContain("关系与心情：亲密｜正常");
    });
  });

  describe("端到端闭环验证 (End-to-End Chat Integration)", () => {
    function createMockEnv(contactRow: any) {
      const runCalls: any[] = [];
      const pendingRows = new Map<string, any>();
      const createStmt = (sql: string, params: any[] = []) => ({
        first: async () => {
          if (sql.includes("FROM tokens")) {
            return {
              token: params[0],
              is_active: 1,
              monthly_limit: 100,
              spent: 0,
              spent_month: "",
              active_persona_id: "female_sutang",
            };
          }
          if (sql.includes("FROM contacts")) {
            return contactRow;
          }
          if (sql.includes("FROM personas")) {
            return { id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，29岁" };
          }
          if (sql.includes("FROM pending_replies")) {
            return pendingRows.get(`${params[0]}:${params[1]}`) || null;
          }
          return null;
        },
        all: async () => {
          return { results: [] };
        },
        run: async () => {
          runCalls.push({ sql, params });
          if (sql.includes("INSERT OR IGNORE INTO pending_replies")) {
            pendingRows.set(`${params[1]}:${params[2]}`, {
              id: params[0],
              token: params[1],
              request_id: params[2],
              content: params[6],
              status: "pending",
            });
          }
          return { success: true, meta: { changes: 1 } };
        },
        bind: (...nextParams: any[]) => createStmt(sql, nextParams),
      });

      const db = {
        runCalls,
        prepare: (sql: string) => createStmt(sql),
        batch: async (stmts: any[]) => stmts.map(() => ({ success: true, meta: { changes: 1 } })),
      };
      const kv = {
        get: async () => null,
        put: async () => {},
      };
      return {
        env: {
          DB: db as any,
          KV: kv as any,
          DEEPSEEK_API_KEY: "test-key",
        },
        runCalls,
      };
    }

    it("洗漱动作进行中（5分钟前说去洗漱），对方发消息直接被静默（action: 'skip'），不秒回防穿帮", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const { env } = createMockEnv({
        is_whitelisted: 1,
        last_activity: "去洗漱",
        last_activity_at: nowSec - 5 * 60,
        last_reply_at: nowSec - 5 * 60,
      });

      const response = await onRequest({
        request: new Request("https://example.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
          body: JSON.stringify({
            request_id: "req-temporal-1",
            platform: "soul",
            contact_id: "user-1",
            contact_name: "测试用户",
            messages: [{ role: "user", content: "水温还热吗？" }],
          }),
        }),
        env: env as any,
      } as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.action).toBe("skip");
      expect(data.reason).toBe("washing_up");
      expect(data.activity).toBe("去洗漱");
    });

    it("洗漱动作25分钟后做完，对方发消息正常回复，且提示词中注入刚洗完吹好头发事实", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const { env, runCalls } = createMockEnv({
        is_whitelisted: 1,
        last_activity: "去洗漱",
        last_activity_at: nowSec - 25 * 60,
        last_reply_at: nowSec - 25 * 60,
      });

      let llmPayload: any = null;
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        if (init && init.body) {
          llmPayload = JSON.parse(String(init.body));
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: "刚洗完吹干头发呢 你刚才说什么啦" } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      });

      const response = await onRequest({
        request: new Request("https://example.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
          body: JSON.stringify({
            request_id: "req-temporal-2",
            platform: "soul",
            contact_id: "user-1",
            contact_name: "测试用户",
            messages: [{ role: "user", content: "在干嘛呢" }],
          }),
        }),
        env: env as any,
      } as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.action).toBe("send");
      expect(data.reply).toBe("刚洗完吹干头发呢 你刚才说什么啦");

      // 验证提示词注入了做完的事实
      const systemMessage = llmPayload?.messages?.find((m: any) => m.role === "system");
      expect(systemMessage?.content).toContain("生活状态：你之前说去洗漱，现在刚洗完吹干头发回来");

      // 验证数据库清除已完成的洗漱动作
      const clearCall = runCalls.find((c: any) => c.sql.includes("last_activity = ''"));
      expect(clearCall).toBeDefined();
    });

    it("模型回复包含'先去洗澡啦'时，数据库自动被更新记录 last_activity = '去洗漱'", async () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const { env, runCalls } = createMockEnv({
        is_whitelisted: 1,
        last_activity: "",
        last_activity_at: 0,
        last_reply_at: nowSec - 3600,
      });

      vi.stubGlobal("fetch", async () => {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "今天身上黏糊糊的 我先去洗澡啦" } }],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      });

      const response = await onRequest({
        request: new Request("https://example.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
          body: JSON.stringify({
            request_id: "req-temporal-3",
            platform: "soul",
            contact_id: "user-1",
            contact_name: "测试用户",
            messages: [{ role: "user", content: "在干嘛呢" }],
          }),
        }),
        env: env as any,
      } as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.action).toBe("send");

      // 验证更新了 contacts 表中的 last_activity = '去洗漱'
      const updateCall = runCalls.find((c: any) => c.sql.includes("UPDATE contacts SET last_reply_at = ?"));
      expect(updateCall).toBeDefined();
        expect(updateCall.params).toContain("去洗漱");
      });
    });

    describe("长对话后台压缩提炼 (maybeSummarizeConversation)", () => {
      it("当消息总数小于50条时，不触发总结压缩", async () => {
        let fetchCalled = false;
        vi.stubGlobal("fetch", async () => {
          fetchCalled = true;
          return new Response(JSON.stringify({}), { status: 200 });
        });

        const db = {
          prepare: (sql: string) => ({
            bind: () => ({
              first: async () => ({ total: 25 }),
              all: async () => ({ results: [] }),
              run: async () => ({ success: true }),
            }),
          }),
        };

        await maybeSummarizeConversation(
          { DB: db } as any,
          { token: "test-token" } as any,
          "soul",
          "user-1",
        );

        expect(fetchCalled).toBe(false);
      });

      it("当消息总数达到50条且未更新过摘要时，触发后台LLM总结并写入 contacts.conversation_summary", async () => {
        let fetchPayload: any = null;
        vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
          if (init && init.body) {
            fetchPayload = JSON.parse(String(init.body));
          }
          return new Response(JSON.stringify({
            choices: [{
              message: { content: "对方是程序员在重庆，喜欢登山，约好周末一起喝咖啡。" },
            }],
          }), { status: 200, headers: { "Content-Type": "application/json" } });
        });

        const runCalls: any[] = [];
        const db = {
          prepare: (sql: string) => ({
            bind: (...params: any[]) => ({
              first: async () => {
                if (sql.includes("COUNT(*)")) return { total: 55 };
                if (sql.includes("FROM contacts")) return { conversation_summary: "", summary_updated_at: 0 };
                if (sql.includes("FROM device_settings")) return { model_line: "a" };
                if (sql.includes("FROM tokens")) return { token: params[0], monthly_limit: 100, spent: 0 };
                return null;
              },
              all: async () => {
                if (sql.includes("FROM chat_history")) {
                  return {
                    results: [
                      { role: "user", content: "我在重庆做程序员" },
                      { role: "assistant", content: "我也在重庆呀" },
                      { role: "user", content: "平时喜欢去登山" },
                      { role: "user", content: "周末一起去喝咖啡吧" },
                      { role: "assistant", content: "好呀 周末见" },
                      { role: "user", content: "你平时几点下班？" },
                      { role: "assistant", content: "一般六点左右吧" },
                      { role: "user", content: "那挺好的" },
                      { role: "user", content: "今天天气不错" },
                      { role: "assistant", content: "是呀，挺舒服的" },
                    ],
                  };
                }
                return { results: [] };
              },
              run: async () => {
                runCalls.push({ sql, params });
                return { success: true };
              },
            }),
          }),
        };

        const kv = {
          get: async () => null,
        };

        await maybeSummarizeConversation(
          { DB: db, KV: kv, DEEPSEEK_API_KEY: "test-key", GEMINI_API_KEY: "test-key" } as any,
          { token: "test-token" } as any,
          "soul",
          "user-1",
        );

        expect(fetchPayload).toBeDefined();
        const systemPrompt = fetchPayload.messages.find((m: any) => m.role === "system")?.content;
        expect(systemPrompt).toContain("对话记忆整理助手");
        expect(systemPrompt).toContain("严格不超过200字");

        const updateCall = runCalls.find((c: any) => c.sql.includes("UPDATE contacts SET conversation_summary = ?"));
        expect(updateCall).toBeDefined();
        expect(updateCall.params[0]).toBe("对方是程序员在重庆，喜欢登山，约好周末一起喝咖啡。");
      });
    });

    describe("1~2 小时快节奏关系进阶与苏棠当日达成目标", () => {
      it("computeRelationshipStage 依据连贯会话互动轮数快速进阶", () => {
        expect(computeRelationshipStage("new", 2)).toBe("new");
        expect(computeRelationshipStage("new", 8)).toBe("familiar");
        expect(computeRelationshipStage("new", 18)).toBe("close");
        expect(computeRelationshipStage("cold", 20)).toBe("cold");
      });

      it("buildTemporalContextPrompt 结合互动轮数自动推进关系标签", () => {
        const promptEarly = buildTemporalContextPrompt({
          contact: { last_reply_at: Math.floor(Date.now() / 1000) - 60, relationship_stage: "new" },
          totalExchanges: 3,
        });
        expect(promptEarly).toContain("刚认识");

        const promptLate = buildTemporalContextPrompt({
          contact: { last_reply_at: Math.floor(Date.now() / 1000) - 60, relationship_stage: "new" },
          totalExchanges: 18,
        });
        expect(promptLate).toContain("亲密");
      });

      it("苏棠在同一天（activeDays: 1）连贯互动15条以上、要了2次联系方式即可放行豆瓣，不再强制卡2天", () => {
        const policy = resolveContactRequestPolicy({
          requestCount: 2,
          stage: 1,
          activity: { totalExchanges: 16, activeDays: 1 },
          incomingText: "加个豆瓣聊呗",
          contactChannel: "douban",
          contactQq: "sutang2026",
          xingmuScope: false,
          sutangScope: true,
        });
        expect(policy.allowed).toBe(true);
        expect(policy.reply).toBe("豆瓣知道吧|||sutang2026");
      });
    });
  });


