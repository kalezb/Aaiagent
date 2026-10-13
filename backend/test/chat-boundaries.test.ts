import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/api/[[route]]";
import {
  buildTurnBrief,
  buildXingmuFunnelPrompt,
  classifyConversationTurn,
  currentUserBatchText,
  extractSelfLeaveInstruction,
  inferSocialExitCooldownMs,
  isDirectWorkQuestion,
  isSocialExitMarker,
  isVoiceCallRequest,
  localVoiceReply,
  parseSocialExitInstruction,
  resolveContactRequestPolicy,
  sanitizeBusinessTopicDrift,
  sanitizeBoundaryConsistency,
  sanitizeNewContactBusinessReply,
  XINGMU_PRODUCT_REPLY,
  VOICE_CHAT_DECLINES,
  VIDEO_CHAT_DECLINES,
} from "../functions/api/_reply_policy";
import {
  MockD1,
  MockKV,
} from "./chat-test-helpers";

describe("chat boundaries", () => {
  it("replies to a voice-chat request locally with a rotating hook decline", async () => {
    expect(isVoiceCallRequest("可以和你语音聊天吗")).toBe(true);
    expect(isVoiceCallRequest("语音聊吗")).toBe(true);
    expect(isVoiceCallRequest("我手机语音功能坏了")).toBe(false);
    expect(isVoiceCallRequest("我平时喜欢语音聊天")).toBe(false);
    expect(isVoiceCallRequest("我现在不能和你语音")).toBe(false);
    expect(isVoiceCallRequest("能不能和你语音聊天")).toBe(true);
    expect(isVoiceCallRequest("方便语音吗")).toBe(true);
    expect(isVoiceCallRequest("就是语音吗")).toBe(true);
    for (const text of ["可以和你语音聊天吗", "语音聊吗", "方便语音吗", "就是语音吗"]) {
      expect(VOICE_CHAT_DECLINES).toContain(localVoiceReply([{ role: "user", content: text }]));
    }
    // 本地短路也要轮换：历史里说过的那句不再选
    const first = localVoiceReply([{ role: "user", content: "语音聊吗" }]);
    expect(localVoiceReply(
      [{ role: "user", content: "语音聊吗" }],
      [{ role: "assistant", content: first }],
    )).not.toBe(first);
    expect(localVoiceReply([{ role: "user", content: "我手机语音功能坏了" }])).toBe("");
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "可以啊，晚点给你打语音" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "voice-request-1",
          platform: "soul",
          contact_id: "voice-new",
          contact_name: "摆烂随心享快乐",
          messages: [{ role: "user", content: "你好呀小姐姐，可以和你语音聊天吗" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const voiceBody = await response.json();
    expect(voiceBody.action).toBe("send");
    expect(voiceBody.local).toBe(true);
    expect(VOICE_CHAT_DECLINES).toContain(voiceBody.reply);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("routes video requests through the model and blocks a video promise", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "好啊，晚点给你发视频" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "video-request-1",
          platform: "soul",
          contact_id: "video-new",
          contact_name: "视频测试",
          messages: [{ role: "user", content: "可以视频看看你吗" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const videoBody = await response.json();
    expect(videoBody.action).toBe("send");
    // 视频拒绝句改成 3 句轮换（2026-10-06），只要落在候选里、且没有答应发视频就算过
    expect(VIDEO_CHAT_DECLINES).toContain(videoBody.reply);
    expect(videoBody.reply).not.toContain("好啊");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("场景：对方要求视频");
  });

  it("routes AI doubts through the model instead of sending a fixed challenge reply", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "哈哈，你还真敢问" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "ai-doubt-1",
          platform: "soul",
          contact_id: "ai-doubt",
          contact_name: "AI质疑测试",
          messages: [{ role: "user", content: "你是不是AI机器人" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "哈哈，你还真敢问",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("被质疑：轻微怀疑当玩笑");
  });

  it("stops spending a second model call when a nickname boundary turns into a relationship test", async () => {
    const now = Math.floor(Date.now() / 1000);
    const history = [
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "mora-boundary",
        contact_name: "莫拉维亚",
        role: "user",
        content: "看看有没有机会发展一下",
        created_at: now - 120,
      },
      {
        id: 2,
        token: "test-token",
        platform: "soul",
        contact_id: "mora-boundary",
        contact_name: "莫拉维亚",
        role: "assistant",
        content: "看你表现呗",
        created_at: now - 110,
      },
      {
        id: 3,
        token: "test-token",
        platform: "soul",
        contact_id: "mora-boundary",
        contact_name: "莫拉维亚",
        role: "user",
        content: "宝贝",
        created_at: now - 100,
      },
      {
        id: 4,
        token: "test-token",
        platform: "soul",
        contact_id: "mora-boundary",
        contact_name: "莫拉维亚",
        role: "assistant",
        content: "才聊几句就喊宝贝，你这进度条拉太快了",
        created_at: now - 90,
      },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "不喜欢啥，喊宝贝还是我这人" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "不是不喜欢，就是宝贝这个称呼太快了，先正常聊着呗。" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "boundary-feedback-repair",
          platform: "soul",
          contact_id: "mora-boundary",
          contact_name: "莫拉维亚",
          messages: [
            { role: "user", content: "哈哈哈" },
            { role: "user", content: "不喜欢" },
          ],
        }),
      }),
      env: { DB: new MockD1([...history].reverse()), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    // 2026-10-05 决策：二次重写通道整体关闭，模型第一次的输出就是最终回复。
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(payload.reply || "").length).toBeGreaterThan(0);
    expect(String(payload.reply || "")).not.toContain("先正常聊着呗");
  });

  it("sends a dead-end reply as-is now that the rewrite channel is off", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "哈哈 先聊点别的" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "听着就挺累的，是工作堆一块了吗？" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "dead-end-repair",
          platform: "soul",
          contact_id: "dead-end-contact",
          contact_name: "测试对象",
          messages: [{ role: "user", content: "最近压力挺大的" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(payload.reply || "")).toContain("先聊点别的");
    expect(String(payload.reply || "")).not.toContain("工作堆一块");
  });

  it("sends a low-signal acknowledgement as-is now that the rewrite channel is off", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "嗯，怎么了" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "被领导这么说确实挺堵心的，是因为哪件事？" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "generic-low-signal-repair",
          platform: "soul",
          contact_id: "low-signal-contact",
          contact_name: "低质量回复测试",
          messages: [{ role: "user", content: "我今天被领导说了，心里挺烦的" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 星暮的表达硬规则会把疑问句补上问号，这里只验证“原样发出、不再重写”。
    expect(String(payload.reply || "")).toBe("嗯，怎么了？");
  });

  it("sends an off-topic answer as-is now that the rewrite channel is off", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "一个人住，离婚之后就自己过了。" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "荣昌卤鹅听着不错，你常去耍吗？" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "context-repair",
          platform: "soul",
          contact_id: "context-repair-contact",
          contact_name: "上下文修复测试",
          messages: [{ role: "user", content: "有空来荣昌耍，吃卤鹅" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(payload.reply || "")).toContain("离婚之后就自己过了");
    expect(String(payload.reply || "")).not.toContain("卤鹅");
  });

  it("never asks the model twice for the same reply anymore", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "哈哈 先聊点别的" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        choices: [{ message: { content: "" } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "repair-keeps-original",
          platform: "soul",
          contact_id: "repair-keeps-original-contact",
          contact_name: "修复失败保留原文测试",
          messages: [{ role: "user", content: "最近压力挺大的" }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "哈哈 先聊点别的",
      timing: { repair_attempted: false },
    });
  });

  it("returns the local age reply through the chat endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "age-request-1",
          platform: "soul",
          contact_id: "age-new",
          contact_name: "临时年龄测试",
          messages: [{ role: "user", content: "你多大了" }],
        }),
      }),
      env: {
        DB: new MockD1([], [{ id: "female", name: "星暮", system_prompt: "你是星暮，29岁女性，重庆人。" }]),
        KV: new MockKV(),
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "29呀 你呢？",
      local: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not repeat the same local age reply within ten minutes", async () => {
    const now = Math.floor(Date.now() / 1000);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1([
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "age-repeat",
        contact_name: "年龄重复测试",
        role: "assistant",
        content: "29呀 你呢",
        created_at: now - 30,
      },
    ], [{ id: "female", name: "星暮", system_prompt: "你是星暮，29岁女性，重庆人。" }]);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "age-repeat-request-1",
          platform: "soul",
          contact_id: "age-repeat",
          contact_name: "年龄重复测试",
          messages: [{ role: "user", content: "你多大了" }],
        }),
      }),
      env: {
        DB: db,
        KV: new MockKV(),
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "刚说过了呀 我29",
      local: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not answer a child's age with Xingmu's own age", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "child-age-request-1",
          platform: "soul",
          contact_id: "child-age-contact",
          contact_name: "孩子年龄测试",
          messages: [{ role: "user", content: "你孩子多大" }],
        }),
      }),
      env: {
        DB: new MockD1([], [{
          id: "female",
          name: "星暮",
          system_prompt: "你是王雅慧，对外叫星暮。29岁，重庆人，离异，无子女，独居。",
        }]),
        KV: new MockKV(),
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "我没孩子。",
      local: true,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps questions about another person out of direct-work and location handling", () => {
    expect(classifyConversationTurn([{ role: "user", content: "你孩子多大" }])).toBe("child_age");
    expect(classifyConversationTurn([{ role: "user", content: "你爸多大了" }])).toBe("other_age");
    expect(classifyConversationTurn([{ role: "user", content: "你孩子做什么工作" }])).toBe("other_person");
    expect(classifyConversationTurn([{ role: "user", content: "你朋友住在哪" }])).toBe("other_person");
    expect(isDirectWorkQuestion("你孩子做什么工作")).toBe(false);
    expect(isDirectWorkQuestion("你做什么工作")).toBe(true);

    const childAgeBrief = buildTurnBrief({
      messages: [{ role: "user", content: "你孩子多大" }],
    });
    expect(childAgeBrief).toContain("不能拿你自己的年龄回答");
    expect(childAgeBrief).toContain("不能编造家庭成员");
  });

  it("uses the active divorced fact instead of a stale married-persona prompt", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(
        JSON.stringify({ choices: [{ message: { content: "不是，我离过婚。" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ))
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "identity-override-1",
          platform: "soul",
          contact_id: "identity-new",
          contact_name: "身份测试",
          messages: [{ role: "user", content: "你结婚了吗" }],
        }),
      }),
      env: {
        DB: (() => {
          const db = new MockD1([], [{
            id: "female",
            name: "星暮",
            system_prompt: "你是星暮，29岁女性，重庆人，已婚未育。老公平常出差，你和公婆同住。",
          }]);
          db.personaFactRows.set("female", {
            persona_id: "female",
            facts_json: JSON.stringify({
              age_mode: "fixed_age",
              fixed_age: 29,
              birth_year: null,
              marital_status: "divorced",
              has_children: false,
              children_age: null,
              hometown: "重庆",
              current_city: "重庆",
              current_district: "两江新区",
              common_area: "",
              work_city: "重庆",
              work_district: "江北区",
              location_precision: "district",
              proactive_location_allowed: false,
            }),
            version: 2,
            updated_at: 200,
          });
          return db;
        })(),
        KV: new MockKV(),
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "不是，我离过婚。",
    });
  });

  it("lets Su Tang refuse or redirect contact info without human takeover", async () => {
    const now = Math.floor(Date.now() / 1000);
    const history = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      token: "test-token",
      platform: "qq",
      contact_id: "legacy-qq-contact",
      contact_name: "QQ覆盖测试",
      role: "user",
      content: index < 3 ? `旧手机回收，加个QQ吧 ${index + 1}` : `今天在忙 ${index + 1}`,
      created_at: index < 15 ? now - 3600 - index : now - 90000 - index,
      source: "sync",
      message_key: `legacy-qq-${index + 1}`,
    }));
    const db = new MockD1(
      history,
      [{ id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，做数码回收客服。" }],
    );
    db.tokenPersonas.set("test-token", "female_sutang");
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({ contact_qq: "12345678" }),
      version: 1,
      updated_at: now,
    });
    db.deviceOverrideRows.set("test-token\u0000female", {
      token: "test-token",
      persona_id: "female_sutang",
      facts_json: JSON.stringify({ contact_qq: "22345678" }),
      config_version: 2,
      updated_at: now,
    });

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "legacy-qq-override-1",
          platform: "qq",
          contact_id: "legacy-qq-contact",
          contact_name: "QQ覆盖测试",
          messages: [{ role: "user", content: "给我个QQ吧" }],
        }),
      }),
      env: {
        DB: db,
        KV: new MockKV(),
        CONTACT_QQ: "99999999",
      },
    } as never);

    // 2026-10-12 用户要求：苏棠不再人工接管，微信、QQ、电话由她自己回绝，聊天继续。
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.action).toBe("send");
    expect(body.human_takeover).toBeUndefined();
    expect(String(body.reply || "")).toMatch(/豆瓣|QQ/);
  });

  it("seeds the final Su Tang persona in schema and the v13 action-ladder migration", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
    const migration = readFileSync(
      new URL("../db/migrations/20261012_sutang_persona_v13_action_ladder.sql", import.meta.url),
      "utf8",
    );
    const stateMigration = readFileSync(
      new URL("../db/migrations/20261012_sutang_persona_v15_state_transition.sql", import.meta.url),
      "utf8",
    );
    const sutangStart = schema.indexOf("VALUES ('female_sutang'");
    const sutangEnd = schema.indexOf("ON CONFLICT(id) DO UPDATE", sutangStart);
    const sutangSchema = schema.slice(sutangStart, sutangEnd);

    expect(sutangSchema).toContain("沉浸式都市情感剧中的女主角“苏棠”");
    expect(sutangSchema).toContain("3 到 20 个字");
    expect(sutangSchema).toContain("书影音软件");
    expect(sutangSchema).toContain("精神自留地");
    expect(sutangSchema).toContain("偷拍或隐私风险");
    expect(sutangSchema).toContain("两个人一起挑、一起确认");
    expect(sutangSchema).toContain("言语轻浮却行动退缩");
    expect(sutangSchema).toContain("State Transition & Progression");
    expect(sutangSchema).toContain("1次认可 + 1次具体推进");
    expect(sutangSchema).not.toContain("黑丝");
    expect(sutangSchema).not.toContain("出浴真空");
    expect(sutangSchema).not.toContain("最终奖励");
    expect(sutangSchema).not.toContain("服从训练");
    expect(migration).toContain("Action Progression & Anti-Loop");
    expect(migration).toContain("sutang_action_ladder");
    expect(migration).toContain("第一次可以试探，第二次必须给具体下一步");
    expect(migration).toContain("同一诚意最多考一次");
    expect(migration).toContain("隐私安全");
    expect(stateMigration).toContain("State Transition & Progression");
    expect(stateMigration).toContain("1次认可 + 1次具体推进");
    expect(stateMigration).toContain("问号只用于二选一、时间确认、轻偏好确认");
    expect(sutangSchema).not.toContain("男方主动承担所有成本与统筹责任");
    expect(schema).toContain('"has_children":true,"children_age":3');
  });

  it("routes a first contact request through the model and only blocks a real account leak", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "可以呀，我微信是private_xh" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "qq-gate-1",
          platform: "soul",
          contact_id: "qq-new",
          contact_name: "QQ测试",
          messages: [{ role: "user", content: "给我发个Q" }],
        }),
      }),
      env: {
        DB: new MockD1(),
        KV: kv,
        DEEPSEEK_API_KEY: "deepseek-key",
        CONTACT_CHANNEL: "wechat",
        CONTACT_WECHAT: "private_xh",
      },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "微信先不急 在这聊挺好",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("【联系方式回应】");
  });

  it("does not resend an old contact refusal after the conversation moves on", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const now = Math.floor(Date.now() / 1000);
    const history = [
      {
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-moved-on",
        contact_name: "已经不聊联系方式了",
        role: "user",
        content: "联系方式给我呗",
        created_at: now - 90,
        source: "sync",
        message_key: "sync:contact-moved-on:1",
      },
      {
        id: 2,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-moved-on",
        contact_name: "已经不聊联系方式了",
        role: "assistant",
        content: "先把话聊顺了 私人号以后再说",
        created_at: now - 80,
        source: "ai",
        message_key: "ai:old-contact-refusal",
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "怎么突然啊这，刚走神了" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "contact-moved-on-1",
          platform: "soul",
          contact_id: "contact-moved-on",
          contact_name: "已经不聊联系方式了",
          messages: [{ role: "user", content: "啊这" }],
        }),
      }),
      env: { DB: new MockD1(history), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "怎么突然啊这，刚走神了",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("removes accidental business talk for a new contact but keeps explicit business answers", () => {
    expect(sanitizeNewContactBusinessReply(
      "我不喜欢跟人语音聊天 你是想咨询手机回收吗|||还是随便聊聊",
      1,
      "可以语音吗",
    )).toBe("还是随便聊聊");
    expect(sanitizeNewContactBusinessReply(
      "新旧手机和老年机都能收",
      1,
      "现在还收手机吗",
    )).toBe("新旧手机和老年机都能收");
  });

  it("does not resurface an old device sale question when the latest message is unrelated", () => {
    expect(sanitizeBusinessTopicDrift(
      "现在这行情，能稳住就不错了 你那16pro到底是自用还是想出嘛",
      "打的太严了 好多事都不能做",
    )).toBe("现在这行情，能稳住就不错了");
    expect(sanitizeBusinessTopicDrift(
      "你那16pro到底是自用还是想出嘛",
      "16pro还出吗",
    )).toBe("你那16pro到底是自用还是想出嘛");
  });

  it("answers direct work questions instead of replacing them with a generic fallback", () => {
    expect(isDirectWorkQuestion("做啥工作")).toBe(true);
    expect(isDirectWorkQuestion("你做什么工作的")).toBe(true);
    expect(isDirectWorkQuestion("你是干啥的")).toBe(true);
    expect(isDirectWorkQuestion("今天工作累死了")).toBe(false);

    const workReply = "做二手手机和旧数码回收，主要线上寄件和同城上门";
    expect(sanitizeBusinessTopicDrift(workReply, "做啥工作")).toBe(workReply);
    expect(sanitizeNewContactBusinessReply(workReply, 1, "做啥工作")).toBe(workReply);
  });

  it("keeps a work answer when the work question is earlier in the incoming batch", () => {
    const messages = [
      { role: "user", content: "你说的没错" },
      { role: "user", content: "你是做什么的" },
      { role: "user", content: "认识一下" },
    ];
    const incomingTurnText = currentUserBatchText(messages);
    const workReply = "认识一下可以啊，我平时做旧数码回收，主要看机子情况";

    expect(incomingTurnText).toContain("你是做什么的");
    expect(sanitizeBusinessTopicDrift(
      workReply,
      "认识一下",
      [],
      incomingTurnText,
    )).toBe(workReply);
    expect(sanitizeNewContactBusinessReply(
      workReply,
      1,
      "认识一下",
      true,
      incomingTurnText,
    )).toBe(workReply);
  });

  it("tells the model to answer direct questions from the full incoming batch", () => {
    const brief = buildTurnBrief({
      messages: [
        { role: "user", content: "你说的没错" },
        { role: "user", content: "你是做什么的" },
        { role: "user", content: "认识一下" },
      ],
      relationStageLevel: 1,
      xingmuScope: true,
    });

    expect(brief).toContain("【必答问题】");
    expect(brief).toContain("你是做什么的");
    expect(brief).toContain("不能跳过，也不能把问题原样反问回去");
    expect(brief).not.toContain("先处理最新、最需要回应的一句");
  });

  it("returns the real work answer for a multi-message incoming batch", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const reply = "认识一下可以啊，我平时做旧数码回收，主要看机子情况";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: reply } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "multi-message-work-reply",
          platform: "soul",
          contact_id: "contact-work-batch",
          contact_name: "莫拉维亚",
          messages: [
            { role: "user", content: "你说的没错" },
            { role: "user", content: "你是做什么的" },
            { role: "user", content: "认识一下" },
          ],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    // 2026-10-07 用户定新口径：一句说一件事，一条不超过15个字，最多两条；
    // 26 个字的整句会被拆成两条（拆在“，”处，不切碎意思）。
    // 他最后一句只有 4 个字（“认识一下”）：只回一条完整短句。
    expect(body).toMatchObject({ action: "send", reply: "认识一下可以啊" });
    expect(body.reply).not.toBe("嗯，你刚说的这个我记住了。");
  });

  it("uses a contextual fallback instead of repeating the old listening phrase", () => {
    expect(sanitizeBusinessTopicDrift(
      "手机啊，二手回收这块，你手上有闲置的没",
      "自己开店，太强了",
    )).not.toContain("我在听");
    expect(sanitizeBusinessTopicDrift(
      "嗯，那说点别的，你平时都收哪些机子",
      "好",
    )).toBe("嗯 行");
    expect(sanitizeBusinessTopicDrift(
      "我平时做旧数码回收，有空来店里看看",
      "认识一下",
    )).toBe("行啊 聊聊呗");
  });

  it("does not reverse a boundary just established in the previous reply", () => {
    const history = [{ role: "assistant", content: "别叫我女神，怪不好意思的" }];
    expect(sanitizeBoundaryConsistency(
      "没啥不好意思的，重庆妹儿都经夸",
      "其实还好吧",
      history,
    )).toBe("哈哈 真不用这么叫");
    expect(sanitizeBoundaryConsistency("哈哈 知道了", "其实还好吧", history)).toBe("哈哈 知道了");
    expect(sanitizeBoundaryConsistency(
      "没啥不好意思的，重庆妹儿都经夸",
      "其实还好吧",
      [],
    )).toBe("没啥不好意思的，重庆妹儿都经夸");
  });

  it("keeps ordinary phone mentions while removing explicit business hooks", () => {
    expect(sanitizeBusinessTopicDrift(
      "你也可以带着手机去吧",
      "你也可以带着手机去吧",
    )).toBe("你也可以带着手机去吧");
    expect(sanitizeBusinessTopicDrift(
      "这个手机镜头拍得挺清爽",
      "刚扔了张照片过来",
    )).toBe("这个手机镜头拍得挺清爽");
    expect(sanitizeBusinessTopicDrift(
      "现在这行情能稳住就不错了 你那16pro到底是自用还是想出嘛",
      "打的太严了 好多事都不能做",
    )).toBe("现在这行情能稳住就不错了");
  });

  it("uses the exact six-stage funnel guidance", () => {
    const stage1 = buildXingmuFunnelPrompt(1, "你好", [], false, { userTurnCount: 5 });
    expect(stage1).toContain("【星暮六段漏斗】认识阶段");
    expect(stage1).toContain("不要提回收旧数码");
    expect(stage1).toContain("不约束语气");
    expect(stage1).toContain("不要把阶段、漏斗或推进任务说给用户听");

    const stage2 = buildXingmuFunnelPrompt(2, "你好", [], false, { userTurnCount: 14 });
    expect(stage2).toContain("【星暮六段漏斗】信任阶段");
    expect(stage2).toContain("用生活毛边做树根");

    const stage3 = buildXingmuFunnelPrompt(3, "你好", [], false, { userTurnCount: 27 });
    expect(stage3).toContain("【星暮六段漏斗】拉扯阶段");
    expect(stage3).toContain("我平时就是收这些的");

    const stage4 = buildXingmuFunnelPrompt(4, "你好", [], false, { userTurnCount: 40 });
    expect(stage4).toContain("【星暮六段漏斗】聊到旧物阶段");
    expect(stage4).toContain("按抽屉、书桌、储物间、阳台这些角落讲");

    const stage5 = buildXingmuFunnelPrompt(5, "你好", [], false, { userTurnCount: 40 });
    expect(stage5).toContain("【星暮六段漏斗】愿意回收阶段");
    expect(stage5).toContain("禁止评估入口");

    const stage6 = buildXingmuFunnelPrompt(6, "你好", [], false, { userTurnCount: 50 });
    expect(stage6).toContain("【星暮六段漏斗】评估入口阶段");
    expect(stage6).toContain("评估报价，搜 shanhs668");
  });

  it("persists the Xingmu funnel from the current request without counting imported history", async () => {
    const now = Math.floor(Date.now() / 1000);
    const imported = Array.from({ length: 60 }, (_, index) => ({
      id: index + 1,
      token: "test-token",
      platform: "soul",
      contact_id: "contact-state",
      contact_name: "状态测试",
      role: "user",
      content: "导入历史-" + index,
      created_at: now - index,
    }));
    const db = new MockD1(imported);
    const fetchMock = vi.fn().mockImplementation(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: "在呢" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = () => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: "persist-funnel-1",
        platform: "soul",
        contact_id: "contact-state",
        contact_name: "状态测试",
        messages: [{ role: "user", content: "今天刚下班，有点累" }],
      }),
    });

    const first = await onRequest({
      request: request(),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const second = await onRequest({
      request: request(),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const row = db.funnelRows.get("test-token\u0000single:test-token:soul:contact-state");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(row.stage).toBe(1);
    expect(row.user_turn_count).toBe(1);
    expect(JSON.parse(row.evidence_json).lifeSignal).toBe(true);
  });

  it("understands a context-dependent social exit without sending a reply", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "[[NO_REPLY:busy]]" } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "semantic-social-exit",
          platform: "soul",
          contact_id: "contact-social-exit",
          contact_name: "离场测试",
          messages: [
            { role: "assistant", content: "那你先忙" },
            { role: "user", content: "我这边临时有点事，回头说" },
          ],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "skip",
      error: "social_exit",
      cooldown_ms: 35 * 60_000,
    });
    expect(db.pendingRows).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends one short caring line instead of silence when he says goodnight", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "clear",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const fetchMock = vi.fn().mockImplementation(async () => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: "[[NO_REPLY:sleep]]" } }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "goodnight-care-1",
          platform: "soul",
          contact_id: "contact-goodnight",
          contact_name: "contact-goodnight",
          messages: [{ role: "user", content: "bye go sleep" }],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.action).toBe("send");
    expect(body.cooldown_ms).toBe(8 * 60 * 60_000);
    expect(db.pendingRows).toHaveLength(1);
    expect(db.pendingRows[0].content).toBe(body.reply);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("detects the agent's own departure and returns it as a hidden cooldown", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "我先去忙了，晚点找你 [[SELF_LEAVE:busy]]" } }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "self-social-exit",
          platform: "soul",
          contact_id: "contact-self-exit",
          contact_name: "主动离场测试",
          messages: [{ role: "user", content: "那你忙吧" }],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "我先去忙了，晚点找你",
      self_leave_ms: 35 * 60_000,
    });
    expect(db.pendingRows).toHaveLength(1);
    expect(db.pendingRows[0].content).toBe("我先去忙了，晚点找你");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("recognizes semantic leave markers and chooses a context-safe cooldown", () => {
    expect(isSocialExitMarker(" [[NO_REPLY]] ")).toBe(true);
    expect(isSocialExitMarker(" [[NO_REPLY:sleep]] ")).toBe(true);
    expect(isSocialExitMarker("先别回复")).toBe(false);
    expect(parseSocialExitInstruction("[[NO_REPLY:sleep]]")).toEqual({
      isExit: true,
      exitType: "sleep",
      cooldownMs: 8 * 60 * 60_000,
    });
    expect(parseSocialExitInstruction("[[NO_REPLY]]")).toEqual({
      isExit: true,
      exitType: "",
      cooldownMs: null,
    });
    expect(extractSelfLeaveInstruction("我先去忙了 [[SELF_LEAVE:busy]]")).toEqual({
      content: "我先去忙了",
      cooldownMs: 35 * 60_000,
    });
    expect(inferSocialExitCooldownMs([{ role: "user", content: "我先洗澡，一会儿说" }]))
      .toBe(25 * 60_000);
    expect(inferSocialExitCooldownMs([{ role: "user", content: "我先睡了，晚安" }]))
      .toBe(8 * 60 * 60_000);
    expect(inferSocialExitCooldownMs([{ role: "user", content: "回头聊" }]))
      .toBe(15 * 60_000);
    expect(inferSocialExitCooldownMs([{ role: "user", content: "我这边临时有点事，回头说" }]))
      .toBe(35 * 60_000);
  });

  it("reuses a pending evaluation quote before delivery confirmation", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    db.funnelRows.set("test-token\u0000single:test-token:soul:contact-evaluation", {
      token: "test-token",
      group_id: "single:test-token:soul:contact-evaluation",
      stage: 6,
      user_turn_count: 42,
      evidence_json: JSON.stringify({
        willingToRecycle: true,
        noRejection: true,
      }),
      evaluation_quote_sent: 0,
      completed: 0,
      last_request_id: "evaluation-seed",
      stage_entered_at: 100,
      last_advanced_at: 100,
      last_user_message_at: 100,
      last_negative_at: 0,
      updated_at: 100,
    });
    vi.stubGlobal("fetch", vi.fn());
    const request = (requestId: string) => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: requestId,
        platform: "soul",
        contact_id: "contact-evaluation",
        contact_name: "评估测试",
        messages: [{ role: "user", content: "家里有旧手机，这个怎么收" }],
      }),
    });
    const env = { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" };

    const first = await onRequest({ request: request("evaluation-turn-1"), env } as never);
    const firstBody = await first.json();
    const second = await onRequest({ request: request("evaluation-turn-2"), env } as never);
    const secondBody = await second.json();

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(firstBody).toMatchObject({ action: "send", reply: XINGMU_PRODUCT_REPLY, local: true });
    expect(secondBody).toMatchObject({ action: "send", reply: XINGMU_PRODUCT_REPLY, local: true });
    expect(secondBody.reply_id).toBe(firstBody.reply_id);
    expect(db.pendingRows).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not send an evaluation pending after the topic changed or the pending expired", async () => {
    const makeDb = () => {
      const db = new MockD1();
      db.funnelRows.set("test-token\u0000single:test-token:soul:contact-pending-topic", {
        token: "test-token",
        group_id: "single:test-token:soul:contact-pending-topic",
        stage: 6,
        user_turn_count: 42,
        evidence_json: JSON.stringify({
          willingToRecycle: true,
          noRejection: true,
        }),
        evaluation_quote_sent: 0,
        completed: 0,
        last_request_id: "pending-topic-seed",
        stage_entered_at: 100,
        last_advanced_at: 100,
        last_user_message_at: 100,
        last_negative_at: 0,
        updated_at: 100,
      });
      return db;
    };
    const now = Math.floor(Date.now() / 1000);
    const seedPending = (db: MockD1, createdAt: number) => db.pendingRows.push({
      id: "pending-evaluation-old",
      token: "test-token",
      request_id: "pending-evaluation-old-request",
      platform: "soul",
      contact_id: "contact-pending-topic",
      contact_name: "评估时效测试",
      content: XINGMU_PRODUCT_REPLY,
      status: "pending",
      action_type: "text",
      media_group_id: "",
      media_asset_id: "",
      sent_content: "",
      created_at: createdAt,
    });
    const envFor = (db: MockD1) => ({ DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" });
    const requestFor = (requestId: string, content: string) => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: requestId,
        platform: "soul",
        contact_id: "contact-pending-topic",
        contact_name: "评估时效测试",
        messages: [{ role: "user", content }],
      }),
    });

    const movedOnDb = makeDb();
    seedPending(movedOnDb, now);
    const movedOnFetch = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ choices: [{ message: { content: "今天先忙你的" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ));
    vi.stubGlobal("fetch", movedOnFetch);
    const movedOn = await onRequest({
      request: requestFor("pending-topic-moved-on", "今天挺忙"),
      env: envFor(movedOnDb),
    } as never);
    await expect(movedOn.json()).resolves.toMatchObject({
      action: "send",
      reply: "今天先忙你的",
    });
    expect(movedOnFetch).toHaveBeenCalled();

    const expiredDb = makeDb();
    seedPending(expiredDb, now - 20 * 60);
    const expiredFetch = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", expiredFetch);
    const expired = await onRequest({
      request: requestFor("pending-topic-expired", "这个怎么收"),
      env: envFor(expiredDb),
    } as never);
    const expiredBody = await expired.json();

    expect(expired.status).toBe(200);
    expect(expiredBody).toMatchObject({ action: "send", reply: XINGMU_PRODUCT_REPLY, local: true });
    expect(expiredBody.reply_id).not.toBe("pending-evaluation-old");
    expect(expiredDb.pendingRows).toHaveLength(2);
    expect(expiredFetch.mock.calls.some(([url]) => String(url).includes("/chat/completions"))).toBe(false);
  });

  it("marks the evaluation quote complete only after delivery and then returns to daily chat", async () => {
    const db = new MockD1();
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({
      city: "重庆",
      condition: "晴",
      temp: 25,
      updated_at: Math.floor(Date.now() / 1000),
    }));
    db.funnelRows.set("test-token\u0000single:test-token:soul:contact-evaluation-confirm", {
      token: "test-token",
      group_id: "single:test-token:soul:contact-evaluation-confirm",
      stage: 6,
      user_turn_count: 42,
      evidence_json: JSON.stringify({
        willingToRecycle: true,
        noRejection: true,
      }),
      evaluation_quote_sent: 0,
      completed: 0,
      last_request_id: "evaluation-confirm-seed",
      stage_entered_at: 100,
      last_advanced_at: 100,
      last_user_message_at: 100,
      last_negative_at: 0,
      updated_at: 100,
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "可以 回头慢慢说" } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const env = { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" };
    const evaluation = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "evaluation-confirm-1",
          platform: "soul",
          contact_id: "contact-evaluation-confirm",
          contact_name: "评估确认",
          messages: [{ role: "user", content: "家里有旧手机，这个怎么收" }],
        }),
      }),
      env,
    } as never);
    const evaluationBody = await evaluation.json();

    const confirmed = await onRequest({
      request: new Request("https://example.com/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ reply_id: evaluationBody.reply_id, sent_content: XINGMU_PRODUCT_REPLY }),
      }),
      env,
    } as never);
    const row = db.funnelRows.get("test-token\u0000single:test-token:soul:contact-evaluation-confirm");

    expect(confirmed.status).toBe(200);
    expect(row.evaluation_quote_sent).toBe(1);
    expect(row.completed).toBe(1);

    const daily = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "evaluation-confirm-2",
          platform: "soul",
          contact_id: "contact-evaluation-confirm",
          contact_name: "评估确认",
          messages: [{ role: "user", content: "那后面再说" }],
        }),
      }),
      env,
    } as never);
    const dailyBody = await daily.json();

    expect(daily.status).toBe(200);
    expect(dailyBody).toMatchObject({ action: "send", reply: "可以 回头慢慢说" });
    expect(dailyBody).not.toHaveProperty("funnel_stage");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("never falls back to a configured QQ account for Xingmu", () => {
    const blocked = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 6,
      activity: {},
      incomingText: "给我个微信吧",
      messages: [{ role: "user", content: "成交了" }],
      contactChannel: "qq",
      contactQq: "12345678",
      xingmuScope: true,
      dealCompleted: true,
    });
    const allowed = resolveContactRequestPolicy({
      requestCount: 1,
      stage: 6,
      activity: {},
      incomingText: "给我个微信吧",
      messages: [{ role: "user", content: "成交了" }],
      contactChannel: "qq",
      contactAccount: "private_xh",
      contactQq: "12345678",
      xingmuScope: true,
      dealCompleted: true,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.contactChannel).toBe("wechat");
    expect(allowed.allowed).toBe(true);
    expect(allowed.reply).toContain("private_xh");
    expect(allowed.reply).not.toContain("12345678");
  });
});
