import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { readFileSync } from "node:fs";
import { onRequest } from "../functions/api/[[route]]";
import {
  buildLayeredSystemPrompt,
  buildDaypartRule,
  resolveDaypart,
  buildTurnBrief,
  avoidRepeatedAssistantReply,
  detectContactMaritalStatus,
  voiceStickerPressure,
  isWeakOpener,
  isLowValueReply,
  needsHerToLead,
  translateStickerContent,
  buildSituationTimeline,
  PROACTIVE_TOPIC_RULE,
  HUMAN_FEEL_RULE,
  ADVANCEMENT_RULE,
  OUTPUT_HARD_RULE,
  QUESTION_PACING_RULE,
  PROACTIVE_STYLE_SUTANG,
} from "../functions/api/_reply_policy";
import {
  MockD1,
  MockKV,
  mockChatSequence,
} from "./chat-test-helpers";

describe("chat history and reply", () => {
  it("always uses the private WeChat channel for Xingmu", async () => {
    const makeDb = () => {
      const db = new MockD1();
      db.funnelRows.set("test-token\u0000single:test-token:soul:contact-config", {
        token: "test-token",
        group_id: "single:test-token:soul:contact-config",
        stage: 6,
        user_turn_count: 42,
        evidence_json: JSON.stringify({
          willingToRecycle: true,
          dealCompleted: true,
          noRejection: true,
        }),
        evaluation_quote_sent: 1,
        completed: 1,
        last_request_id: "contact-config-seed",
        stage_entered_at: 100,
        last_advanced_at: 100,
        last_user_message_at: 100,
        last_negative_at: 0,
        updated_at: 100,
      });
      return db;
    };
    const request = () => new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        request_id: "contact-config-turn",
        platform: "soul",
        contact_id: "contact-config",
        contact_name: "联系方式配置",
        messages: [{ role: "user", content: "给我个微信吧" }],
      }),
    });
    vi.stubGlobal("fetch", vi.fn());

    const wechat = await onRequest({
      request: request(),
      env: {
        DB: makeDb(),
        KV: new MockKV(),
        CONTACT_CHANNEL: "wechat",
        CONTACT_WECHAT: "13800138000",
      },
    } as never);
    await expect(wechat.json()).resolves.toMatchObject({
      action: "send",
      reply: "行 那我把私人微信号给你：13800138000 加的时候说下你是谁",
      contact_gate: "allowed",
    });

    const configuredQq = await onRequest({
      request: request(),
      env: {
        DB: makeDb(),
        KV: new MockKV(),
        CONTACT_CHANNEL: "qq",
        CONTACT_QQ: "12345678",
        CONTACT_WECHAT: "private_xh",
      },
    } as never);
    await expect(configuredQq.json()).resolves.toMatchObject({
      action: "send",
      reply: "行 那我把私人微信号给你：private_xh 加的时候说下你是谁",
      contact_gate: "allowed",
    });
  });

  it("deduplicates nearby duplicate history before building model context", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const now = Math.floor(Date.now() / 1000);
    const db = new MockD1([
      { id: 1, token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "测试", role: "user", content: "重复消息", created_at: now - 2 },
      { id: 2, token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "测试", role: "user", content: "重复消息", created_at: now - 1 },
    ]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "在呢" } }] }), {
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
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "测试",
          messages: [{ role: "user", content: "最新问题" }],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const historyMessages = JSON.parse(String(init.body)).messages.filter((message) => String(message.content).includes("重复消息"));
    expect(historyMessages).toHaveLength(1);
  });

  it("uses a compact profile and up to twenty recent unique history messages", async () => {
    const history = [{
      id: 16,
      token: "test-token",
      platform: "soul",
      contact_id: "contact-1",
      contact_name: "梦想",
      role: "user",
      content: "刚发的问题",
      created_at: 115,
    }, ...Array.from({ length: 15 }, (_, index) => {
      const number = 15 - index;
      return {
        id: number,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "梦想",
        role: number % 2 === 0 ? "user" : "assistant",
        content: `历史-${number}`,
        created_at: 100 + number,
      };
    })];
    const db = new MockD1(history).withOptions({
      contactLinks: [{ group_id: "group:shared", token: "test-token", platform: "soul", contact_id: "contact-1", contact_name: "梦想" }],
    });
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    db.profileRows.set("test-token\u0000group:shared", {
      profile_json: JSON.stringify({ basic: { name: "张先生", gender: "男" }, preferences: { hobbies: ["羽毛球"], likes: ["爬山"] }, notes: [""] }),
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "周末有空" } }] }), {
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
          platform: "soul",
          contact_id: "contact-1",
          contact_name: "梦想",
          messages: [
            { role: "user", content: "刚发的问题", created_at: 115 },
            { role: "user", content: "明天的安排呢" },
          ],
        }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const promptMessages = JSON.parse(String(init.body)).messages;
    expect(promptMessages[0].content).toContain("【长期客户档案】");
    expect(promptMessages[0].content).toContain('"name":"张先生"');
    expect(promptMessages[0].content).not.toContain('"notes"');
    const rawHistoryLines = promptMessages.filter((message) => String(message.content).startsWith("[soul "));
    expect(rawHistoryLines.length).toBeLessThanOrEqual(20);
    expect(rawHistoryLines.some((message) => String(message.content).includes("刚发的问题"))).toBe(false);
    expect(promptMessages.filter((message) => String(message.content).includes("刚发的问题"))).toHaveLength(2);
    expect(promptMessages.some((message) => String(message.content).includes("明天的安排呢"))).toBe(true);
  });

  it("keeps greetings and daily talk inside the current time of day", () => {
    const evening = resolveDaypart("2026-10-05 19:52:03");
    expect(evening.label).toBe("晚上");
    expect(evening.greeting).toBe("晚上好");
    const eveningRule = buildDaypartRule("2026-10-05 19:52:03");
    expect(eveningRule).toContain("现在是晚上");
    expect(eveningRule).toContain("绝对不许说“早上好、下午好”");
    expect(resolveDaypart("2026-10-05 08:10:00").label).toBe("早上");
    expect(buildDaypartRule("2026-10-05 08:10:00")).toContain("不许说娃哄睡了");
    expect(resolveDaypart("2026-10-05 23:40:00").label).toBe("深夜");
  });

  it("forces an answer when the batch mixes a greeting with real questions", () => {
    const brief = buildTurnBrief({
      messages: [
        { role: "user", content: "在干嘛呢" },
        { role: "user", content: "你多大了呀" },
        { role: "user", content: "你是97年的吗" },
      ],
      relationStageLevel: 1,
      xingmuScope: false,
    });
    expect(brief).toContain("【必答问题】");
    expect(brief).toContain("你多大了呀");
    expect(brief).not.toContain("先把那件具体的事答了");
  });

  it("keeps a repeated line away from the same person for half an hour", () => {
    const now = 1_790_000_000;
    const history = [{ role: "assistant", content: "刚把娃哄睡", created_at: now - 20 * 60 }];
    const repeated = avoidRepeatedAssistantReply("刚把娃哄睡", history, "在吗", now, "这会儿才算清静");
    expect(repeated).not.toBe("刚把娃哄睡");
  });

  it("drops old-persona wording from the history sent to the model", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { id: 1, token: "test-token", platform: "soul", contact_id: "polluted", contact_name: "老客户", role: "assistant", content: "做二手手机和旧数码回收的", created_at: now - 600, source: "human_phone" },
      { id: 2, token: "test-token", platform: "soul", contact_id: "polluted", contact_name: "老客户", role: "user", content: "从事什么行业呢", created_at: now - 60, source: "sync" },
    ];
    const db = new MockD1(history, [
      { id: "female", name: "星暮", identity_terms: JSON.stringify(["旧数码", "回收"]) },
      { id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，做电商运营。", identity_terms: JSON.stringify(["电商运营"]) },
    ]);
    db.tokenPersonas.set("test-token", "female_sutang");
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ choices: [{ message: { content: "做电商运营的呢" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ platform: "soul", contact_id: "polluted", contact_name: "老客户", messages: [{ role: "user", content: "从事什么行业呢" }] }),
      }),
      env: { DB: db, KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    const systemPrompt = String(payload.messages[0].content);
    expect(systemPrompt).not.toContain("二手手机");
    expect(systemPrompt).not.toContain("旧数码");
    expect(systemPrompt).toContain("【时段约束】");
    expect(systemPrompt).not.toContain("【生活素材】");
    // 2026-10-06 新增的两条“必须分辨”：第三方归属、她欠回复时不许倒打一耙
    expect(systemPrompt).toContain("分清是谁的人");
    expect(systemPrompt).toContain("只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。");
    // 2026-10-07 事实一致：生活细节可以编，但编了就守住，不许改口。
    // 真机事故：卡卡罗特（重庆本地人）那边，位置一会儿一个说法，对方两次说“你在逗我”。
    expect(systemPrompt).toContain("【事实一致】");
    expect(systemPrompt).toContain("编了就守住");
    expect(systemPrompt).toContain("不能拿它给生活细节改口");
  });

  it("adds relative age and blocks only a false just-arrived claim", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T21:14:00.000Z"));
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "谢谢 你眼光不错|||你这个点才想起我" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "桃子幺幺",
          contact_name: "桃子幺幺",
          messages: [{
            role: "user",
            content: "你这高跟鞋真好看",
            timestamp: "9月25日 02:21",
            created_at: Math.floor(Date.parse("2026-09-24T18:21:00.000Z") / 1000),
          }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      // 两段都是完整表达，不因为第二段末尾是“我”就当成半句话删掉。
      reply: "谢谢 你眼光不错|||你这个点才想起我",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.messages[0].content).toContain("只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。");
    expect(payload.messages[0].content).not.toContain("时间关系：");
    expect(payload.messages[0].content).not.toContain("已隔 2 小时 53 分");
    expect(payload.messages[0].content).not.toContain("你是真人，不会一直盯着手机");
    expect(payload.messages.at(-1).role).toBe("user");
    // 2026-10-07 晚：历史行不再写“X 小时前”（模型会拿它算“她晾了他多久”，然后开口交代）。
    expect(payload.messages.at(-1).content).not.toContain("前】");
    expect(payload.messages.at(-1).content).toMatch(/^【\d{2}\/\d{2} \d{2}:\d{2}/);
    expect(payload.messages.at(-1).content).toContain("对方：你这高跟鞋真好看");
  });

  it("warns only when voice or stickers get out of hand", () => {
    // 2026-10-07 用户要求：偶尔一两条语音 → 正常用转写聊；发得多/发得长/一连串刷 → 警告。
    const voice = (seconds = 5) => ({ role: "user", content: "[语音]", voice_seconds: seconds });
    const sticker = (name = "笑哭") => ({ role: "user", content: "[" + name + "]" });
    const text = (value) => ({ role: "user", content: value });

    expect(voiceStickerPressure([voice()]).level).toBe("ok");
    expect(voiceStickerPressure([voice(), voice()]).level).toBe("ok");
    expect(voiceStickerPressure([voice(), text("在吗"), voice()]).level).toBe("ok");
    // 三条语音 → 多
    expect(voiceStickerPressure([voice(), voice(), voice()]).level).toBe("warn");
    // 单条 ≥30 秒 → 多
    expect(voiceStickerPressure([voice(35)]).level).toBe("warn");
    // 连着三条语音/表情 → 多
    expect(voiceStickerPressure([sticker(), voice(), sticker()]).level).toBe("warn");
    // 连着三个表情已经是“发一串” → 也该警告
    expect(voiceStickerPressure([sticker("笑哭"), sticker("狗子"), sticker("吃瓜")]).level).toBe("warn");
    // 表情门槛放宽针对“夹着文字、分散着发”的情况：5 个没事，6 个才警告
    // 注意只看最近 10 条他的消息，所以下面两组都控制在 10 条内、且没有连续 3 个
    const five = [sticker(), text("哈"), sticker(), text("哈"), sticker(), sticker(), text("哈"), sticker(), text("哈")];
    expect(voiceStickerPressure(five).level).toBe("ok");
    const six = [sticker(), text("哈"), sticker(), text("哈"), sticker(), sticker(), text("哈"), sticker(), text("哈"), sticker()];
    expect(voiceStickerPressure(six).level).toBe("warn");
    // 纯文字永远不触发
    expect(voiceStickerPressure([text("今天好累"), text("你呢")]).level).toBe("ok");
    // 转写文字已经在内容里时，也算语音（老形态）
    expect(voiceStickerPressure([{ role: "user", content: "对方语音转文字：我好累" }]).level).toBe("ok");
  });

  it("warns once and mutes the contact when voice spam continues", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    db.tokenPersonas.set("test-token", "female_sutang");
    const spam = {
      request_id: "spam-1",
      platform: "soul",
      contact_id: "spam-contact",
      contact_name: "爱发语音的大叔",
      messages: [
        { role: "user", content: "[语音]", voice_seconds: 8 },
        { role: "user", content: "[语音]", voice_seconds: 12 },
        { role: "user", content: "[语音]", voice_seconds: 6 },
      ],
    };
    const first = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify(spam),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const firstBody = await first.json();
    expect(firstBody.action).toBe("send");
    expect(firstBody.reason).toBe("voice_sticker_warning");
    expect(String(firstBody.reply)).toContain("语音");
    // 警告走本地短路，不调模型
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("lets Su Tang ask his look once, then never again after he sends a photo", () => {
    const base = {
      personaPrompt: "你是苏棠，做电商运营。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-10 21:40:00",
      weekday: "星期六",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "在吗" }],
      historyMessages: [],
      xingmuSoulScope: false,
    };
    const fresh = buildLayeredSystemPrompt(base);
    expect(fresh).toContain("当前档案：他还没发过照片");
    expect(fresh).toContain("你长什么样呀 发张我看看");
    expect(fresh).toContain("可以主动问一次");

    const byFile = buildLayeredSystemPrompt({ ...base, hisPhotoOnFile: true });
    expect(byFile).toContain("永不再问");
    expect(byFile).toContain("当前档案：他已经发过照片");

    const byHistory = buildLayeredSystemPrompt({
      ...base,
      historyMessages: [{ role: "user", content: "[图片]" }],
    });
    expect(byHistory).toContain("永不再问");
    expect(byHistory).toContain("当前档案：他已经发过照片");

    const herFresh = buildLayeredSystemPrompt(base);
    expect(herFresh).toContain("当前档案：她还没给他看过照片");
    const herSent = buildLayeredSystemPrompt({ ...base, herPhotoOnFile: true });
    expect(herSent).toContain("当前档案：她已经给他看过照片");
  });

  it("tells her to lead when he only offers a weak opener or keeps brushing her off", () => {
    // 2026-10-07 用户纠正：“在干嘛”是递话头，不是要行程表；他一直“嗯嗯哦哦”时该她主动带节奏。
    expect(isWeakOpener("在干嘛")).toBe(true);
    expect(isWeakOpener("在干嘛呢？")).toBe(true);
    expect(isWeakOpener("在吗")).toBe(true);
    expect(isWeakOpener("今天加班到十点")).toBe(false);
    expect(isLowValueReply("嗯")).toBe(true);
    expect(isLowValueReply("哈哈")).toBe(true);
    expect(isLowValueReply("是吗")).toBe(true);
    expect(isLowValueReply("我在跟客户对方案")).toBe(false);
    expect(needsHerToLead([{ role: "user", content: "嗯" }, { role: "user", content: "哦" }])).toBe(true);
    expect(needsHerToLead([{ role: "user", content: "嗯" }])).toBe(true);
    expect(needsHerToLead([{ role: "user", content: "在干嘛" }])).toBe(true);
    expect(needsHerToLead([{ role: "user", content: "今天被老板骂了 加班到十点" }])).toBe(false);
  });
  it("never tells the model to excuse a late reply", () => {
    // 2026-10-07 实测：EW / 相信光！/ 行者 三条回复全以“昨晚睡得沉 你这条我上午才看到”开场，
    // 根因是提示词里写着“要么认一句自己没接上（睡着了、忙忘了）”。
    const prompt = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠，做电商运营。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-07 20:45:00",
      weekday: "星期三",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "在干嘛呢", created_at: 1 }],
      historyMessages: [],
      xingmuSoulScope: false,
    });
    expect(prompt).toContain("只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。");
    expect(prompt).toContain(PROACTIVE_TOPIC_RULE);
    expect(prompt).toContain(HUMAN_FEEL_RULE);
    expect(prompt).toContain(ADVANCEMENT_RULE);
    expect(prompt).toContain(OUTPUT_HARD_RULE);
    expect(prompt).toContain(QUESTION_PACING_RULE);
    expect(prompt).toContain(PROACTIVE_STYLE_SUTANG);
    // 不许再出现“让他自己交代一句”的教法（旧句是“要么认一句自己没接上（睡着了、忙忘了）”）
    expect(prompt).not.toContain("认一句自己没接上");
    expect(prompt).not.toContain("这两天忙晕了");
  });
  it("turns stickers into virtual-sticker text with their meaning", () => {
    // 2026-10-07 用户要求：表情是虚拟表情，模型要按意思回（月亮=晚安），
    // 不能把图案当成真东西去夸，也不能把“摸一下”当成他真动手。
    expect(translateStickerContent("[月亮]")).toBe("[表情包：月亮（晚安/想你）]");
    expect(translateStickerContent("[笑哭][笑哭][笑哭]")).toBe("[表情包：笑哭 ×3（哭笑不得/被逗笑）]");
    expect(translateStickerContent("对方发来 Soul 互动表情「皮一下」：对方和你开玩笑，气氛轻松调皮"))
      .toBe("[互动表情：皮一下]");
    expect(translateStickerContent("[Soul互动表情]")).toBe("[互动表情]");
    expect(translateStickerContent("[语音互动表情]")).toBe("[互动表情]");
    expect(translateStickerContent("[表情]")).toBe("[表情包]");
    // 媒体占位符不能被当表情：
    expect(translateStickerContent("[语音]")).toBe("[语音]");
    expect(translateStickerContent("[图片]")).toBe("[图片]");
    expect(translateStickerContent("[闪照]")).toBe("[闪照]");
    // 正常文字原样保留：
    expect(translateStickerContent("在吗")).toBe("在吗");
    expect(translateStickerContent("[呲牙笑]哈哈")).toBe("[表情包：呲牙笑（开心地笑）]哈哈");
  });
  it("forbids pretending a voice message was not heard when there is no transcript", () => {
    // 2026-10-07 真机（渔夫）：转写成功但重读没拿到，模型手里只有 [语音]，于是编了“语音听了一半 后面没听清呢”。
    const prompt = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠，做电商运营。",
      personaFacts: null,
      platform: "soul",
      profileContext: "",
      currentDatetime: "2026-10-07 20:00:00",
      weekday: "星期二",
      homeLocation: { city: "重庆", district: "两江新区" },
      workLocation: { city: "重庆", district: "江北区" },
      weather: null,
      stageText: "",
      relationStageLevel: 2,
      messageDelay: null,
      messages: [{ role: "user", content: "[语音]", created_at: 1 }],
      historyMessages: [],
      xingmuSoulScope: false,
    });
    expect(prompt).toContain("【没转出文字的语音】");
    expect(prompt).toContain("不许说“听不清/没听清/听了一半/没听完/你再说一遍/重发一遍”");
  });

  it("only treats his own words as his marital status", () => {
    // 2026-10-07 用户要求：确认对方已婚就不再回复这个人。
    expect(detectContactMaritalStatus([{ role: "user", content: "我已婚" }])).toBe("married");
    expect(detectContactMaritalStatus([{ role: "user", content: "我老婆管得严" }])).toBe("married");
    expect(detectContactMaritalStatus([{ role: "user", content: "我单身" }])).toBe("single");
    expect(detectContactMaritalStatus([{ role: "user", content: "我还没结婚" }])).toBe("single");
    // 她自己说“我已婚/我有老公”是她的人设，不算他的婚况。
    expect(detectContactMaritalStatus([{ role: "assistant", content: "我已婚" }])).toBe("");
    // 她问他“你结婚了吗”也不是他的回答。
    expect(detectContactMaritalStatus([{ role: "assistant", content: "你结婚了吗" }])).toBe("");
    expect(detectContactMaritalStatus([{ role: "user", content: "今天好累" }])).toBe("");
  });

  it("skips a married contact without calling the model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1();
    db.tokenPersonas.set("test-token", "female_sutang");
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "married-1",
          platform: "soul",
          contact_id: "married-contact",
          contact_name: "稳重的大叔",
          messages: [{ role: "user", content: "我已婚，孩子都上小学了" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.action).toBe("skip");
    expect(body.reason).toBe("contact_married");
    // 连模型都没调。
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tells the model the timeline: his latest message, her last one, the gap, and who owes a reply", () => {
    // 2026-10-07（方案 B 第一层）：用户要求让模型知道消息前后排序，别把旧的当刚发生的。
    const now = 1_800_000_000;
    const timeline = buildSituationTimeline(
      [{ role: "user", content: "睡了", created_at: now - 26 * 3600, time_kind: "first_observed" }],
      [{ role: "assistant", content: "你咋也还不睡呀", created_at: now - 39 * 3600 }],
      now,
    );
    expect(timeline).toContain("【现在是什么情况");
    expect(timeline).toContain("他最新一条");
    expect(timeline).toContain("他这条你还没回");
    // 2026-10-07 晚（实测 EW/相信光！/行者）：之前写“他最新一条：…（11小时前）”“你上一条：…（17小时前）”
    // “你俩中间隔了：13小时”，模型一睁眼就算“她晾了他多久”，于是每条都以“昨晚睡着了没看到你这条”开场。
    // 现在既不给相对时长，也不单列“你上一条”，更不写“中间隔了”。
    expect(timeline).not.toContain("你上一条");
    expect(timeline).not.toContain("你俩中间隔了");
    expect(timeline).not.toContain("小时前");
    // 2026-10-07（时间可信）：这时间不是他真发的，就标出来，别让模型当成“他刚说的”。
    expect(timeline).toContain("我们读到的时间");
    expect(timeline).toContain("不要当成刚发生的事来接");
    // 她回过之后就不再提示“欠他一个回应”
    const replied = buildSituationTimeline(
      [
        { role: "user", content: "睡了", created_at: now - 3600 },
        { role: "assistant", content: "那你快睡", created_at: now - 3500 },
        { role: "user", content: "在忙吗", created_at: now - 60 },
      ],
      [],
      now,
    );
    expect(replied).toContain("他最新一条");
    expect(replied).not.toContain("你上一条");
  });

  it("labels every transcript line with 对方/我 and a time", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { id: 1, token: "test-token", platform: "soul", contact_id: "transcript-a", contact_name: "顺序测试", role: "user", content: "很久以前第一条", created_at: now - 7200, source: "sync", message_key: "t1" },
      { id: 2, token: "test-token", platform: "soul", contact_id: "transcript-a", contact_name: "顺序测试", role: "assistant", content: "紧跟着的第二条", created_at: now - 7190, source: "ai", message_key: "t2", persona_id: "female_sutang" },
      { id: 3, token: "test-token", platform: "soul", contact_id: "transcript-a", contact_name: "顺序测试", role: "user", content: "隔了一小时的第三条", created_at: now - 3600, source: "sync", message_key: "t3" },
    ];
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "好的" } }] }), {
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
          request_id: "transcript-order-1",
          platform: "soul",
          contact_id: "transcript-a",
          contact_name: "顺序测试",
          messages: [{ role: "user", content: "现在这句话", created_at: now }],
        }),
      }),
      env: { DB: new MockD1(history), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const promptMessages = JSON.parse(String(init.body)).messages;
    const transcript = promptMessages.slice(1);
    const second = transcript.find((message) => String(message.content).includes("紧跟着的第二条"));
    const third = transcript.find((message) => String(message.content).includes("隔了一小时的第三条"));
    const latest = promptMessages.at(-1);

    // 2026-10-07（方案 B 第一层）：每一行都带时间，模型才能分清哪条是刚发生的。
    // 同一批连着发的只显示时刻（最短），隔得久的带完整日期和“多久前”。
    expect(second.content).toContain("我：紧跟着的第二条");
    // 2026-10-07：去掉“X 小时前”后，同一批的短格式依赖“上一条时间”的推进；
    // 只要行首带时间就算合格（短格式或完整日期都接受）。
    expect(second.content).toMatch(/^【(?:\d{2}:\d{2}|\d{2}\/\d{2} \d{2}:\d{2})/);
    expect(third.content).toContain("对方：隔了一小时的第三条");
    expect(third.content).toMatch(/^【\d{2}\/\d{2} \d{2}:\d{2}/);
    expect(latest.content).toContain("对方：现在这句话");
    expect(latest.content).toMatch(/^【\d{2}\/\d{2} \d{2}:\d{2}/);
    // 只给绝对时刻，不再给“多久前”
    expect(latest.content).not.toContain("前】");
  });

  it("feeds the model the conversation in time order", () => {
    // 2026-10-07 用户反馈（貌若潘安的黄金圣斗士）：早期按写入顺序排，16:48 的“下午好”排在 17:55 之后，
    // 模型看到的顺序是乱的，于是出现“答旧话/断层”。改成按时间排（同秒再按写入顺序）。
    // 看板本来就用 created_at 排序，不受影响。
    const sources = [
      readFileSync(new URL("../functions/api/route.ts", import.meta.url), "utf8"),
      readFileSync(new URL("../functions/api/_chat_api.ts", import.meta.url), "utf8"),
    ];
    const historySelects = sources.flatMap((source) =>
      source
        .split("\n")
        .filter((line) => line.includes("FROM chat_history") && line.includes("persona_id = ?"))
    );

    expect(historySelects.length).toBeGreaterThan(0);
    for (const line of historySelects) {
      expect(line).toContain("ORDER BY created_at DESC, id DESC");
    }
  });


  it("drops re-synced copies of the AI's own replies", async () => {
    const db = new MockD1();
    const now = Math.floor(Date.now() / 1000);
    db.pendingRows.push({
      id: "ai-sent-1",
      token: "test-token",
      request_id: "chat-sent-1",
      platform: "soul",
      contact_id: "dup-contact",
      contact_name: "重复测试",
      content: "第一句|||第二句",
      status: "confirmed",
      action_type: "text",
      media_group_id: "",
      media_asset_id: "",
      created_at: now - 30,
      confirmed_at: now - 25,
    });

    const response = await onRequest({
      request: new Request("https://example.com/api/messages/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "dup-contact",
          contact_name: "重复测试",
          messages: [
            { role: "assistant", content: "第一句", source: "human_phone", created_at: now - 28, message_key: "dup-1" },
            { role: "assistant", content: "第二句 ", source: "human_phone", created_at: now - 27, message_key: "dup-2" },
            { role: "user", content: "新来的消息", source: "sync", created_at: now - 20, message_key: "dup-3" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      accepted: 1,
      skipped_duplicates: 2,
    });
  });

  it("uses past mode for old greetings instead of pretending the message just arrived", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T21:14:00.000Z"));
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "刚忙完 刚看到你消息|||在的 前几天有点忙" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "桃子幺幺",
          contact_name: "桃子幺幺",
          messages: [{
            role: "user",
            content: "在吗",
            timestamp: "9月21日 06:59",
            created_at: Math.floor(Date.parse("2026-09-20T22:59:00.000Z") / 1000),
          }],
        }),
      }),
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      // 2026-10-07 晚（用户要求）：他隔了很久才发时，不许以“刚看到你消息”这种交代开场，
      // 开头那句交代会被代码删掉（用户原话：真人不会解释半天为什么没回）。
      reply: "在的 前几天有点忙",
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const prompt = JSON.parse(String(init.body)).messages[0].content;
    expect(prompt).toContain("较早前的消息");
    expect(prompt).toContain("只接对方最新一句；不主动解释、不主动道歉、不主动汇报自己在忙什么。");
    expect(prompt).not.toContain("你是真人，不会一直盯着手机");
    expect(prompt).not.toContain("已隔 3 天 22 小时");
  });

  it("does not infer staleness from unrelated database history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T00:59:00.000Z"));
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "在的" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const historyRows = [
      { id: 1, role: "user", content: "旧消息", created_at: Math.floor(Date.parse("2026-09-21T00:00:00.000Z") / 1000) },
    ];
    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "测试联系人",
        messages: [{ role: "user", content: "在吗" }],
        request_id: "confirm-only-reply",
      }),
    });
    await onRequest({
      request,
      env: { DB: new MockD1(historyRows), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const prompt = JSON.parse(String(init.body)).messages[0].content;
    expect(prompt).not.toMatch(/对方最后一条消息是 \d+ 小时前发的/);
  });

  it("removes leaked time and speaker prefixes from the model reply", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "\u91cd\u5e86", condition: "\u6674", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "[22:15] \u4f60\u8bf4\uff1a\u4e0d\u5c31\u90a3\u4e2ayyds\u561b \u6211\u770b\u5230\u4e86" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-1",
        contact_name: "contact-1",
        messages: [{ role: "user", content: "\u77e5\u9053\u6211\u53d1\u7684\u4ec0\u4e48\u8868\u60c5\u4e0d\uff1f" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "\u4e0d\u5c31\u90a3\u4e2ayyds\u561b \u6211\u770b\u5230\u4e86",
    });
  });

  it("removes leaked dated context markers from the middle of a reply", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "\u91cd\u5e86", condition: "\u6674", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "\u4f4d\u7f6e\u5c31\u7b97\u4e86\uff0c\u624d\u804a\u51e0\u5929\u5c31\u4e92\u6362\u5730\u5740\u592a\u5feb\u4e86 [soul 10/01 18:57] \u4f60\u4e5f\u662f\u6025\u6027\u5b50\uff0c\u89c1\u9762\u7684\u4e8b\u5148\u653e\u653e\u5427" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-mid-marker",
        contact_name: "contact-mid-marker",
        messages: [{ role: "user", content: "\u4f60\u53d1\u4e2a\u4f4d\u7f6e\u7ed9\u6211" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      // “了”后面重新起“你也是……”是新的一句，按自然换意断成两段。
      reply: "\u4f4d\u7f6e\u5c31\u7b97\u4e86\uff0c\u624d\u804a\u51e0\u5929\u5c31\u4e92\u6362\u5730\u5740\u592a\u5feb\u4e86|||\u4f60\u4e5f\u662f\u6025\u6027\u5b50\uff0c\u89c1\u9762\u7684\u4e8b\u5148\u653e\u653e\u5427",
    });
  });

  it("removes leaked prefixes from later reply lines and pipe segments", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "给谁 你对象啊|||你说：我眯了啊 明天还一堆单子|||[09/25 03:40] 明天还得跑单子" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-3",
        contact_name: "contact-3",
        messages: [{ role: "user", content: "在吗" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      // 泄露前缀照旧清掉；第三段和前一秒重复表达同一个意思，不重复发送。
      reply: "给谁 你对象啊|||我眯了啊 明天还一堆单子",
    });
  });

  it("does not remove speaker words that are part of normal reply text", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "\u91cd\u5e86", condition: "\u6674", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "\u4f60\u8bf4\u5462 \u6211\u8fd8\u5728\u770b\u6d88\u606f" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "contact-2",
        contact_name: "contact-2",
        messages: [{ role: "user", content: "\u5728\u5417" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      reply: "\u4f60\u8bf4\u5462 \u6211\u8fd8\u5728\u770b\u6d88\u606f",
    });
  });

  it("keeps natural content-defined segments instead of forcing one segment", async () => {
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "谢谢 你眼光不错 ||| 你怎么这个点还醒着" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "测试联系人",
        contact_name: "测试联系人",
        messages: [{ role: "user", content: "你这高跟鞋真好看" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    const body = await response.json();
    expect(body.action).toBe("send");
    expect(String(body.reply)).toContain("谢谢 你眼光不错");
    expect(String(body.reply)).toContain("你怎么这个点还醒着");
  });

  it("passes Beijing time to the model without injecting a rest-period policy", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T19:44:00.000Z"));
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "睡了 被你消息吵醒了 ||| 这么晚还没睡" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        messages: [{ role: "user", content: "睡了吗" }],
      }),
    });
    const response = await onRequest({
      request,
      env: { DB: new MockD1(), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const prompt = JSON.parse(String(init.body)).messages[0].content;
    expect(prompt).toContain("2026-09-25 03:44:00");
    expect(prompt).toContain("星期五");
    expect(prompt).not.toContain("业务消息可以远程回复");
    expect(prompt).not.toContain("有正常作息和情绪");
    expect(prompt).toContain("先把那件具体的事答了");
    expect(prompt).toContain("不要汇报自己正在做什么");
    expect(prompt).not.toContain("你在家休息");
    expect(prompt).not.toContain("远程回下业务消息")
    expect(prompt).not.toContain("躺床上睡不着");
    await expect(response.json()).resolves.toMatchObject({
      action: "send",
      // 两段自然承接，不需要为了短消息硬删第二段。
      reply: "睡了 被你消息吵醒了|||这么晚还没睡",
    });
  });

  it("formats historical messages in China time instead of server time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T19:44:00.000Z"));
    const historyRows = [
      { id: 1, role: "user", content: "昨晚在吗", created_at: Math.floor(Date.parse("2026-09-24T19:40:00.000Z") / 1000) },
    ];
    const kv = new MockKV();
    await kv.put("weather:cache", JSON.stringify({ city: "重庆", condition: "晴", temp: 25, updated_at: Math.floor(Date.now() / 1000) }));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: "在的" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const request = new Request("https://example.com/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
      body: JSON.stringify({
        platform: "soul",
        contact_id: "期待下一步的我们",
        contact_name: "期待下一步的我们",
        messages: [{ role: "user", content: "在吗" }],
        request_id: "confirm-only-reply",
      }),
    });
    await onRequest({
      request,
      env: { DB: new MockD1(historyRows), KV: kv, DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const historyMessage = JSON.parse(String(init.body)).messages.find((message) =>
      String(message.content).includes("昨晚在吗"),
    );
    expect(historyMessage.content).toContain("09/25 03:40");
    expect(historyMessage.content).not.toContain("19:40");
  });
  it("activates the selected persona with a valid device key", async () => {
    const db = new MockD1([], [
      { id: "female", name: "星暮" },
      { id: "male_chenyu", name: "陈屿" },
    ]);
    const request = new Request("https://example.com/api/config/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_key: "test-token",
        action: "activate_persona",
        persona_id: "male_chenyu",
      }),
    });

    const response = await onRequest({
      request,
      env: { DB: db, KV: new MockKV() },
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      active_persona_id: "male_chenyu",
      active_persona_name: "陈屿",
    });
    expect(db.tokenPersonas.get("test-token")).toBe("male_chenyu");
    db.tokenPersonas.set("other-token", "female");
    const otherConfig = await onRequest({
      request: new Request("https://example.com/api/config", {
        headers: { Authorization: "Bearer other-token" },
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);
    await expect(otherConfig.json()).resolves.toMatchObject({ active_persona_id: "female" });
    expect(db.tokenPersonas.get("test-token")).toBe("male_chenyu");
  });

  it("returns the shared persona location from config and ignores old device locations", async () => {
    const db = new MockD1();
    db.personaFactRows.set("female", {
      persona_id: "female",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 29,
        marital_status: "married",
        has_children: false,
        hometown: "重庆",
        current_city: "重庆",
        current_district: "两江新区",
        common_area: "",
        work_city: "重庆",
        work_district: "江北区",
        location_precision: "district",
        proactive_location_allowed: false,
      }),
      version: 3,
      updated_at: 200,
    });
    db.locationRows.set("test-token", {
      home_city: "北京",
      home_district: "朝阳区",
      work_city: "上海",
      work_district: "浦东新区",
    });

    const configResponse = await onRequest({
      request: new Request("https://example.com/api/config", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);

    await expect(configResponse.json()).resolves.toMatchObject({
      location: {
        home: { city: "重庆", district: "两江新区" },
        work: { city: "重庆", district: "江北区" },
      },
      persona_facts: { config_version: 3 },
    });
  });

  it("rejects old mobile persona facts saves and keeps the shared facts unchanged", async () => {
    const db = new MockD1();
    db.personaFactRows.set("female", {
      persona_id: "female",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 29,
        marital_status: "divorced",
        has_children: false,
        vehicle: "宝马X3",
        housing: "自有住房",
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
    db.pendingRows.push({
      id: "old-pending",
      token: "test-token",
      request_id: "old-request",
      platform: "soul",
      contact_id: "old-contact",
      contact_name: "旧会话",
      content: "旧回复",
      status: "pending",
      action_type: "text",
      media_group_id: "",
      media_asset_id: "",
      sent_content: "",
      created_at: 1,
      persona_id: "female",
      persona_version: 1,
    });
    const request = new Request("https://example.com/api/config/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        device_key: "test-token",
        action: "save_persona_facts",
        age_mode: "fixed_age",
        fixed_age: "31",
        birth_year: "",
        marital_status: "single",
        has_children: "true",
        children_age: "4",
        contact_qq: "22345678",
        hometown: "重庆",
        current_city: "成都",
        current_district: "武侯区",
        common_area: "天府三街附近",
        work_city: "成都",
        work_district: "高新区",
        location_precision: "district",
        proactive_location_allowed: "false",
      }),
    });

    const response = await onRequest({
      request,
      env: { DB: db, KV: new MockKV() },
    } as never);

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      code: "shared_persona_dashboard_only",
    });
    expect(db.deviceOverrideRows.size).toBe(0);
    expect(db.personaFactRows.get("female")?.version).toBe(2);
    expect(JSON.parse(String(db.personaFactRows.get("female")?.facts_json))).toMatchObject({
      fixed_age: 29,
      current_city: "重庆",
    });
    expect(db.pendingRows.find((row) => row.id === "old-pending")?.status).toBe("pending");
  });

  it("saves shared persona facts from the dashboard and rejects a stale version", async () => {
    const db = new MockD1();
    db.personaFactRows.set("female", {
      persona_id: "female",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 29,
        marital_status: "married",
        has_children: false,
        hometown: "重庆",
        current_city: "重庆",
        current_district: "两江新区",
        common_area: "",
        work_city: "重庆",
        work_district: "江北区",
        location_precision: "district",
        proactive_location_allowed: false,
      }),
      version: 5,
      updated_at: 200,
    });
    const makeRequest = (expectedVersion: number, fixedAge: number) => onRequest({
      request: new Request("https://example.com/api/persona-facts", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Dashboard-Password": "secret",
        },
        body: JSON.stringify({
          persona_id: "female",
          expected_version: expectedVersion,
          age_mode: "fixed_age",
          fixed_age: fixedAge,
          marital_status: "married",
          has_children: false,
          hometown: "重庆",
          current_city: "重庆",
          current_district: "两江新区",
          work_city: "重庆",
          work_district: "江北区",
          location_precision: "district",
          proactive_location_allowed: false,
        }),
      }),
      env: { DB: db, KV: new MockKV(), DASHBOARD_PASSWORD: "secret" },
    } as never);

    const saved = await makeRequest(5, 35);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toMatchObject({
      success: true,
      shared_version: 6,
      facts: { fixed_age: 35 },
    });

    const stale = await makeRequest(5, 36);
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      code: "persona_version_conflict",
      current_version: 6,
    });
    expect(JSON.parse(String(db.personaFactRows.get("female")?.facts_json))).toMatchObject({
      fixed_age: 35,
    });
  });

  it("uses the latest persona facts on the next chat without requiring publish", async () => {
    const db = new MockD1([], [{
      id: "female_sutang",
      name: "苏棠",
      system_prompt: "你是苏棠，29岁。",
      is_active: 1,
      created_at: 1,
    }]);
    db.tokenPersonas.set("test-token", "female_sutang");
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 29,
        marital_status: "married",
        has_children: true,
        children_age: 3,
        hometown: "重庆",
        current_city: "重庆",
        current_district: "两江新区",
        work_city: "重庆",
        work_district: "江北区",
      }),
      version: 1,
      updated_at: 100,
    });
    const kv = new MockKV();
    await kv.put("persona:drawers:female_sutang", JSON.stringify({ topics: [], counters: [], custom: [] }));
    const env = { DB: db, KV: kv, DASHBOARD_PASSWORD: "secret", DEEPSEEK_API_KEY: "deepseek-key" };
    const published = await onRequest({
      request: new Request("https://example.com/api/persona/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Dashboard-Password": "secret" },
        body: JSON.stringify({ persona_id: "female_sutang", expected_version: 1 }),
      }),
      env,
    } as never);
    expect(published.status).toBe(200);
    const publishedBody = await published.json();
    expect(publishedBody).toMatchObject({
      success: true,
      published_version: 1,
      source_version: 1,
    });

    // 用户明确要求：资料改完，下一条聊天立即按新版本执行，不再卡“发布正式版”。
    db.personaFactRows.set("female_sutang", {
      persona_id: "female_sutang",
      facts_json: JSON.stringify({
        age_mode: "fixed_age",
        fixed_age: 35,
        marital_status: "married",
        has_children: true,
        children_age: 3,
        hometown: "重庆",
        current_city: "重庆",
        current_district: "两江新区",
        work_city: "重庆",
        work_district: "江北区",
      }),
      version: 2,
      updated_at: 200,
    });
    const fetchMock = mockChatSequence(["不应该走模型"]);
    vi.stubGlobal("fetch", fetchMock);
    const chat = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "snapshot-live-version",
          platform: "soul",
          contact_id: "snapshot-contact",
          contact_name: "快照测试",
          messages: [{ role: "user", content: "你多大？" }],
        }),
      }),
      env,
    } as never);
    expect(chat.status).toBe(200);
    await expect(chat.json()).resolves.toMatchObject({
      action: "send",
      persona_id: "female_sutang",
      persona_version: 2,
    });
    const reply = String(db.pendingRows.at(-1)?.content || "");
    expect(reply).toContain("35");
    expect(reply).not.toContain("29");
  });

  it("does not return platform style restrictions in app config", async () => {
    const response = await onRequest({
      request: new Request("https://example.com/api/config", {
        headers: { Authorization: "Bearer test-token" },
      }),
      env: { DB: new MockD1(), KV: new MockKV() },
    } as never);

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).not.toHaveProperty("platform_style_hints");
  });

  it("removes the voice and sticker repulsion rule from persona seed data", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
    const legacyMigration = readFileSync(new URL("../db/migrations/20260925_four_personas.sql", import.meta.url), "utf8");
    const removalMigration = readFileSync(new URL("../db/migrations/20260926_remove_media_repulsion_rule.sql", import.meta.url), "utf8");
    const builtFunctions = readFileSync(new URL("../dist-func/index.js", import.meta.url), "utf8");

    expect(schema).not.toContain("对方发语音或表情后告知以后别发，你反感");
    expect(legacyMigration).not.toContain("对方发语音或表情后告知以后别发，你反感");
    expect(removalMigration).toContain("UPDATE personas");
    expect(removalMigration).toContain("REPLACE(");
    expect(builtFunctions).not.toContain("PLATFORM_STYLE_HINTS");
    expect(builtFunctions).not.toContain("platform_style_hints");
  });

  it("stores four aligned personas in the seed and production migration", () => {
    const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
    const migration = readFileSync(new URL("../db/migrations/20260928_device_persona_and_pending_replies.sql", import.meta.url), "utf8");
    const newContactMigration = readFileSync(new URL("../db/migrations/20260928_new_contact_natural_reply.sql", import.meta.url), "utf8");
    const contactMigration = readFileSync(new URL("../db/migrations/20260928_contact_gate_relationship_layers.sql", import.meta.url), "utf8");
    const compactMigration = readFileSync(new URL("../db/migrations/20260929_compact_personas.sql", import.meta.url), "utf8");
    const xingmuMigration = readFileSync(new URL("../db/migrations/20260930_update_new_xingmu_persona.sql", import.meta.url), "utf8");
    const funnelMigration = readFileSync(new URL("../db/migrations/20261001_persist_xingmu_funnel.sql", import.meta.url), "utf8");
    const carMigration = readFileSync(new URL("../db/migrations/20261001_add_bmw_x3_to_xingmu_persona.sql", import.meta.url), "utf8");
    const voiceMigration = readFileSync(new URL("../db/migrations/20261003_persona_voice_funnel_v2.sql", import.meta.url), "utf8");
    const vehicleMigration = readFileSync(new URL("../db/migrations/20261003_persona_vehicle_facts.sql", import.meta.url), "utf8");

    expect(schema).toContain("你是王雅慧，对外叫星暮，熟了叫慧慧");
    expect(migration).toContain("你是星暮，29岁女性，重庆人，已婚未育。");
    expect(schema).toContain("做二手手机和废旧数码回收，主要走线上寄件和同城上门");
    expect(compactMigration).toContain("你做全国二手手机和数码回收");
    expect(xingmuMigration).toContain("UPDATE personas");
    expect(xingmuMigration).toContain("你是王雅慧，对外叫星暮，熟了叫慧慧");
    expect(xingmuMigration).not.toContain("已婚未育");
    expect(xingmuMigration).not.toContain("公婆");
    expect(xingmuMigration).not.toContain("宝马X3");
    expect(funnelMigration).toContain("CREATE TABLE IF NOT EXISTS customer_funnel_states");
    expect(funnelMigration).toContain("做二手手机和废旧数码回收");
    expect(funnelMigration).toContain("有一辆宝马X3");
    expect(carMigration).toContain("UPDATE personas");
    expect(carMigration).toContain("有一辆宝马X3");
    expect(voiceMigration).toContain("默认每条3到12字");
    expect(voiceMigration).toContain("漏斗只决定业务边界");
    expect(voiceMigration).toContain("'$.marital_status', 'divorced'");
    expect(schema).toContain('"marital_status":"divorced"');
    expect(vehicleMigration).toContain("'$.vehicle', '宝马X3'");
    expect(vehicleMigration).toContain("'$.housing', '自有住房'");
    expect(schema).toContain('"vehicle":"宝马X3"');
    expect(schema).not.toContain("每条回复50字以内");
    expect(schema).not.toContain("你负责全国二手手机和数码设备回收");
    expect(newContactMigration).toContain("不靠陌生人推销");
    expect(newContactMigration).toContain("只有对方明确问工作")
    expect(schema).not.toContain("对方要联系方式只给QQ");
    expect(schema).not.toContain("对方索要联系方式只给QQ号");
    expect(contactMigration).toContain("对方索要联系方式不能马上给");
    expect(contactMigration).toContain("不能自行编号码");
    expect(contactMigration).toContain("聊天有边界");
    expect(migration).toContain("UPDATE personas");
    expect(migration).toContain("active_persona_id");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS pending_replies");
  });

  it("rejects old mobile location saves even when the payload is incomplete", async () => {
    const response = await onRequest({
      request: new Request("https://example.com/api/config/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_key: "test-token",
          action: "save_location",
          home_city: "重庆",
          home_district: "",
          work_city: "重庆",
          work_district: "两江新区",
        }),
      }),
      env: { DB: new MockD1(), KV: new MockKV() },
    } as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "shared_persona_dashboard_only",
    });
  });
});
