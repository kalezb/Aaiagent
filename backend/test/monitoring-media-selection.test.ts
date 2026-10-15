import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import {
  buildLayeredSystemPrompt,
  buildRelationshipBoundaryPrompt,
  avoidRepeatedAssistantReply,
  capReplyLength,
  fixSpousePerspective,
  isSelfMediaOffer,
  owesReplyFromHistory,
  isPhotoAuthenticityChallenge,
  detectContactMaritalStatus,
  dropPhotoAdmissionClauses,
  dropBlameSegmentsWhenOwing,
  dropAcceptedSelfMediaSegments,
} from "../functions/api/_reply_policy";
import {
  buildMediaDirectiveInstruction,
  findMatchingMediaGroup,
  hasNonPersonalMediaContext,
  hasContextualMediaRequest,
  isExplicitBodyMediaRequest,
  isExplicitMediaRequest,
  isRealtimeImageRequest,
  normalizePersonalPhotoIntent,
  resolveMediaGroupForDirective,
  shouldClassifyPersonalPhotoIntent,
} from "../functions/api/_media_policy";
import {
  defaultDrawersForPersona,
  matchActiveDrawers,
} from "../functions/api/_persona_drawers";
import {
  MockD1,
  MockKV,
  mockChatSequence,
} from "./chat-test-helpers";

describe("media selection", () => {
  it("records an image only after the phone confirms delivery", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u60f3\u770b\u4f60\u7167\u7247", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" }],
      mediaSendRows: [],
    });
    const fetchMock = mockChatSequence(["DAILY"]);
    vi.stubGlobal("fetch", fetchMock);
    const generatedResponse = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "confirm-topic-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "\u60f3\u770b\u4f60\u7167\u7247" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const generated = await generatedResponse.json();
    expect(db.historyRows).toHaveLength(0);

    const confirmResponse = await onRequest({
      request: new Request("https://example.com/api/chat/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({ reply_id: generated.reply_id, sent_content: "ignored" }),
      }),
      env: { DB: db, KV: new MockKV() },
    } as never);
    expect(confirmResponse.status).toBe(200);
    expect(db.historyRows[0].content).toMatch(/^\[\u56fe\u7247:daily_01\]$/u);
    expect(db.options.mediaSendRows).toHaveLength(1);
    expect(db.options.mediaSendRows[0]).toMatchObject({ group_id: "daily", asset_id: "daily_01" });
  });

  it("does not select a topic image in semi-auto mode", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "text reply" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", trigger_keywords: "\u60f3\u770b\u4f60\u7167\u7247", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily" }],
    });
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "semi-topic-image",
          platform: "soul",
          hosting_mode: "semi_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "\u60f3\u770b\u4f60\u7167\u7247" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    expect(body.action).toBe("send");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/chat/completions"))).toBe(true);
  });

  it("blocks realtime or weather questions from topic image matching", () => {
    const groups = [
      { id: "daily", trigger_keywords: "\u7167\u7247,\u65e5\u5e38\u7167,\u751f\u6d3b\u7167" },
      { id: "body", trigger_keywords: "\u8eab\u6750,\u8eab\u6750\u7167,\u770b\u817f" },
    ];
    const realtimeQuestions = [
      "\u4f60\u73b0\u5728\u7a7f\u7684\u4ec0\u4e48",
      "\u4f60\u73b0\u5728\u5728\u5e72\u561b",
      "\u53d1\u4e00\u5f20\u73b0\u5728\u7684\u7167\u7247",
      "\u4f60\u90a3\u8fb9\u5929\u6c14\u600e\u4e48\u6837",
      "\u4f60\u73b0\u5728\u8eab\u6750\u600e\u4e48\u6837",
    ];

    for (const question of realtimeQuestions) {
      expect(isRealtimeImageRequest(question), question).toBe(true);
      expect(findMatchingMediaGroup(groups, question)).toBeNull();
    }
    expect(findMatchingMediaGroup(groups, "\u60f3\u770b\u770b\u4f60\u7684\u65e5\u5e38\u7167")?.group.id).toBe("daily");
    expect(findMatchingMediaGroup(groups, "\u770b\u770b\u8eab\u6750\u7167")?.group.id).toBe("body");
  });

  it("requires an explicit request for star-soul topic images", () => {
    const groups = [
      { id: "daily", trigger_keywords: "\u65e5\u5e38\u7167,\u7167\u7247,\u4ee5\u56fe\u6362\u56fe" },
      { id: "body", trigger_keywords: "\u8eab\u6750\u7167,\u8eab\u6750,\u770b\u817f" },
    ];

    expect(isExplicitMediaRequest("\u6211\u559c\u6b22\u770b\u8eab\u6750\u7167")).toBe(false);
    expect(isExplicitMediaRequest("\u4e0d\u60f3\u770b\u8eab\u6750\u7167")).toBe(false);
    expect(isExplicitMediaRequest("\u770b\u770b\u4f60\u7684\u8eab\u6750\u7167")).toBe(true);
    expect(isExplicitMediaRequest("[\u4ee5\u56fe\u6362\u56fe]")).toBe(true);
    expect(findMatchingMediaGroup(groups, "\u6211\u559c\u6b22\u770b\u8eab\u6750\u7167", { requireExplicitRequest: true })).toBeNull();
    expect(findMatchingMediaGroup(groups, "\u770b\u770b\u4f60\u7684\u8eab\u6750\u7167", { requireExplicitRequest: true })?.group.id).toBe("body");
    expect(findMatchingMediaGroup(groups, "[\u4ee5\u56fe\u6362\u56fe]", { requireExplicitRequest: true })?.group.id).toBe("daily");
  });

  it("only treats explicit body language as a body-photo request", () => {
    const groups = [
      { id: "daily", name: "日常照" },
      { id: "body", name: "身材照" },
    ];

    expect(isExplicitBodyMediaRequest("发一下身材照呗")).toBe(true);
    expect(isExplicitBodyMediaRequest("看看你的腿")).toBe(true);
    expect(isExplicitBodyMediaRequest("照片拍得不错")).toBe(false);
    expect(isExplicitBodyMediaRequest("发一下呗")).toBe(false);
    expect(isExplicitMediaRequest("发一下你的照片")).toBe(true);
    expect(isExplicitMediaRequest("给一下你的照片")).toBe(true);
    expect(isExplicitMediaRequest("可以看看你样子吗")).toBe(true);
    expect(isExplicitMediaRequest("看看你可以吗")).toBe(true);
    expect(isExplicitMediaRequest("看一下机器的照片")).toBe(false);
    expect(hasContextualMediaRequest(["看一下"])).toBe(false);
    expect(hasContextualMediaRequest(["发一下"])).toBe(false);
    expect(hasContextualMediaRequest(["给一下"])).toBe(false);
    expect(hasContextualMediaRequest(["看一下照片"])).toBe(true);
    expect(hasContextualMediaRequest(["可以看看你样子吗"])).toBe(true);
    expect(hasContextualMediaRequest(["看看你可以吗"])).toBe(true);
    expect(hasContextualMediaRequest(["想看你照片", "看一下"])).toBe(true);
    expect(hasContextualMediaRequest(["想看你照片", "给一下"])).toBe(true);
    expect(hasContextualMediaRequest(["看一下你现在的机器的样子", "看一下呗"])).toBe(false);
    expect(hasContextualMediaRequest(["看一下机器的照片", "给一下"])).toBe(false);
    expect(hasNonPersonalMediaContext(["看一下你现在的机器的样子", "看一下呗"])).toBe(true);
    expect(hasNonPersonalMediaContext(["想看你照片", "看一下呗"])).toBe(false);
    expect(shouldClassifyPersonalPhotoIntent(["可以看看你样子吗"])).toBe(true);
    expect(shouldClassifyPersonalPhotoIntent(["嗯嗯，好的"])).toBe(false);
    expect(normalizePersonalPhotoIntent("`DAILY`")).toBe("daily");
    expect(normalizePersonalPhotoIntent("BODY\n")).toBe("body");
    expect(normalizePersonalPhotoIntent("NONE，因为是在说机器")).toBe("none");
    expect(normalizePersonalPhotoIntent("[[SEND_MEDIA:daily]]")).toBe("none");
    expect(resolveMediaGroupForDirective(groups, "body", ["想看你照片", "发一下呗"])?.id).toBe("daily");
    expect(resolveMediaGroupForDirective(groups, "body", ["想看身材照", "发一下呗"])?.id).toBe("body");
    expect(resolveMediaGroupForDirective(groups, "unknown", ["想看你照片"])).toBeNull();
    expect(resolveMediaGroupForDirective([{ id: "body", name: "身材照" }], "body", ["发一下呗"])).toBeNull();
    expect(buildMediaDirectiveInstruction(groups)).toContain("给一下");
    expect(buildMediaDirectiveInstruction(groups)).toContain("机器");
  });

  it("lets the model choose a contextual daily photo without an exact keyword", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence(["DAILY"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "contextual-daily-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [
            { role: "user", content: "想看你照片" },
            { role: "user", content: "看一下呗" },
          ],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ action: "send_media", media: { group_id: "daily", asset_id: "daily_01" } });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/chat/completions"))).toBe(true);
  });

  it("lets the model interpret personal appearance wording without a photo keyword", async () => {
    for (const [requestId, incoming] of [
      ["appearance-daily-image", "可以看看你样子吗"],
      ["you-can-image", "看看你可以吗"],
    ]) {
      const db = new MockD1().withOptions({
        mediaGroups: [
          { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
        ],
        mediaAssets: [
          { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
        ],
      });
      const fetchMock = mockChatSequence(["DAILY"]);
      vi.stubGlobal("fetch", fetchMock);

      const response = await onRequest({
        request: new Request("https://example.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
          body: JSON.stringify({
            request_id: requestId,
            platform: "soul",
            hosting_mode: "full_auto",
            contact_id: "contact-1",
            contact_name: "contact",
            messages: [{ role: "user", content: incoming }],
          }),
        }),
        env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
      } as never);
      const body = await response.json();

      expect(response.status, incoming).toBe(200);
      expect(body, incoming).toMatchObject({
        action: "send_media",
        media: { group_id: "daily", asset_id: "daily_01" },
      });
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/chat/completions")), incoming).toBe(true);
    }
  });

  it("sends a daily photo when the photo intent classifier recognizes a personal appearance request", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence([
      "DAILY",
      "照片先不发了，聊聊呗",
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "classified-daily-image",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "可以看看你样子吗" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();
    const chatCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/chat/completions"));
    const classifierBody = JSON.parse(String(chatCalls[0]?.[1]?.body || "{}"));

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      action: "send_media",
      media: { group_id: "daily", asset_id: "daily_01" },
    });
    expect(chatCalls).toHaveLength(1);
    expect(String(classifierBody.messages?.[0]?.content || "")).toContain("照片意图分类器");
  });

  it("does not use photo keywords to veto a semantic media decision when the classifier was not needed", async () => {
    const db = new MockD1().withOptions({
      mediaGroups: [
        { id: "daily", name: "日常照", trigger_keywords: "想看你照片", is_active: 1 },
      ],
      mediaAssets: [
        { id: "daily_01", group_id: "daily", file_name: "daily_01.jpg", content_type: "image/jpeg" },
      ],
    });
    const fetchMock = mockChatSequence(["[[SEND_MEDIA:daily]]"]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "semantic-directive-without-keyword",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "让我认认你" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      action: "send_media",
      media: { group_id: "daily", asset_id: "daily_01" },
    });
    expect(hasContextualMediaRequest(["让我认认你"])).toBe(false);
  });

  it("honours a model media directive even when the classifier said NONE", async () => {
    // 2026-10-05 改动：分类器只当“额外触发器”，不再否决模型已经发出的指令。
    // 旧行为是这里会被否决掉，最后回一句“照片先不发了，聊聊呗”。
    const db = new MockD1().withOptions({
      mediaGroups: [{ id: "daily", name: "日常照", is_active: 1 }],
      mediaAssets: [{ id: "daily_01", group_id: "daily", file_name: "daily_01.jpg" }],
    });
    const fetchMock = mockChatSequence([
      "NONE",
      "[[SEND_MEDIA:daily]]",
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          request_id: "model-directive-with-none-classifier",
          platform: "soul",
          hosting_mode: "full_auto",
          contact_id: "contact-1",
          contact_name: "contact",
          messages: [{ role: "user", content: "发张照片看看" }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.action).toBe("send_media");
    expect(body.media.group_id).toBe("daily");
  });

  it("drops a segment the persona already said days ago", () => {
    // 真机原样（你压到我头发了）：模型把两天前说过的“重庆人嘛 你说呢”原句搬出来当新回复。
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { role: "user", content: "你是重庆人吗", created_at: now - 2 * 86400 },
      { role: "assistant", content: "重庆人嘛 你说呢|||不过这两天忙晕了 才顾上回你", created_at: now - 2 * 86400 },
    ];
    const reply = "重庆人嘛 你说呢|||娃睡了 才顾上看手机";
    expect(avoidRepeatedAssistantReply(reply, history, "忙啥呢 这是", now))
      .toBe("娃睡了 才顾上看手机");
  });

  it("uses only the new Su Tang knowledge cards", () => {
    const drawers = defaultDrawersForPersona("female_sutang");
    const ids = (drawers.topics || []).map((item) => item.id);
    expect(ids).toHaveLength(28);
    expect(ids).toContain("scene_01_black_stockings");
    expect(ids).toContain("scene_13_invitation_reward");
    expect(ids).toContain("scene_14_rainy_neck");
    expect(ids).toContain("scene_16_douban_tree_hole");
    expect(ids).toContain("scene_23_sunny_hot_summer");
    expect(ids).toContain("scene_24_cold_wind_winter");
    expect(ids).toContain("scene_25_pleasant_breeze");
    expect(ids).toContain("scene_26_mother_in_law_cover");
    expect(ids).toContain("scene_27_contrast_mature_woman");
    expect(ids).toContain("scene_28_body_massage_spa");
    expect(ids).not.toContain("sofa_tired");
    expect(ids).not.toContain("food_hungry");

    const stockings = matchActiveDrawers(drawers, "你今天穿黑丝了吗").join("\n");
    expect(stockings).not.toContain("黑丝与腿部触感");
    expect(stockings).not.toContain("刚把黑丝脱了");

    const invite = matchActiveDrawers(drawers, "想约你开房").join("\n");
    expect(invite).toContain("打压轻浮与纠正姿态");
    expect(invite).toContain("真站我跟前");
    expect(invite).not.toContain("一句硬话回掉");

    const rainyNeck = matchActiveDrawers(drawers, "今晚下雨 后背酸得厉害").join("\n");
    expect(rainyNeck).toContain("居家放松与颈背酸胀");
    expect(rainyNeck).toContain("后背和颈椎酸得要命");

    expect(matchActiveDrawers(drawers, "今天吃什么了")).toEqual([]);
  });

  it("detects photo authenticity challenge and strips admissions", () => {
    // 2026-10-06 真机：他说“这是网图吧”，模型顺手认了（“嗯 网上找的”）——等于当场露馅。
    expect(isPhotoAuthenticityChallenge("这是网图吧")).toBe(true);
    expect(isPhotoAuthenticityChallenge("这不是你吧")).toBe(true);
    expect(isPhotoAuthenticityChallenge("今天天气不错")).toBe(false);
    expect(dropPhotoAdmissionClauses("嗯 网上找的")).toBe("");
    expect(dropPhotoAdmissionClauses("我自己拍的呀 你这话我可记住了")).toBe("我自己拍的呀 你这话我可记住了");
    expect(dropPhotoAdmissionClauses("我自己拍的呀|||其实是网上找的")).toBe("我自己拍的呀");
  });

  it("never sends time markers back to the contact", async () => {
    // 2026-10-07：模型会把喂给它的时间标记原样吐出来（真机漏过“【10/06，21:07，0”）。
    // 三种格式（中文方括号 / 英文方括号 / ISO）都必须清掉。
    for (const content of ["【10/06 01:32，13小时前】对方：睡了", "[2026-10-06 01:32] 对方：睡了", "2026-10-06T01:32:00+08:00 对方：睡了"]) {
      const db = new MockD1([], [
        { id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，做电商运营。", identity_terms: JSON.stringify(["电商运营"]) },
      ]);
      db.tokenPersonas.set("test-token", "female_sutang");
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(
        JSON.stringify({ choices: [{ message: { content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )));
      vi.stubGlobal("fetch", fetchMock);
      const response = await onRequest({
        request: new Request("https://example.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
          body: JSON.stringify({
            platform: "soul",
            contact_id: "tm",
            contact_name: "时间标记测试",
            messages: [{ role: "user", content: "在吗", created_at: Math.floor(Date.now() / 1000) }],
          }),
        }),
        env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
      } as never);
      const body = await response.json();
      const sent = String(body.reply || "");
      expect(sent).not.toContain("【");
      expect(sent).not.toContain("2026-10-06");
      expect(sent).not.toContain("01:32");
    }
  });

  it("never sends prompt-marker leakage like 【10/06，21:07，0", async () => {
    // 2026-10-06 真机：模型偶发把提示词里的中文方括号标记吐出来，差点当成消息发出去。
    const db = new MockD1([], [
      { id: "female_sutang", name: "苏棠", system_prompt: "你是苏棠，做电商运营。", identity_terms: JSON.stringify(["电商运营"]) },
    ]);
    db.tokenPersonas.set("test-token", "female_sutang");
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(
      JSON.stringify({ choices: [{ message: { content: "【10/06，21:07，0" } }] }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    vi.stubGlobal("fetch", fetchMock);
    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer test-token" },
        body: JSON.stringify({
          platform: "soul",
          contact_id: "xq",
          contact_name: "稀奇",
          messages: [{ role: "user", content: "吃了没", created_at: Math.floor(Date.now() / 1000) }],
        }),
      }),
      env: { DB: db, KV: new MockKV(), DEEPSEEK_API_KEY: "deepseek-key" },
    } as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(String(body.reply || "")).not.toContain("【");
    expect(String(body.reply || "")).not.toContain("21:07");
  });

  it("never blames him when she is the one who owes a reply", () => {
    // 真机（请叫我球⚽️）：昨天凌晨聊完她一句没回，他今天又发来；
    // 她回“昨晚聊着聊着就没影了 我还等着呢”——倒打一耙，被用户当场撤回。
    const heThenHe = [
      { role: "user", content: "梦都能接上呢～" },
      { role: "user", content: "早上好" },
    ];
    expect(owesReplyFromHistory([], heThenHe)).toBe(true);
    const sheThenHe = [
      { role: "assistant", content: "我醒了就得翻半天才迷糊回去" },
      { role: "user", content: "早上好" },
    ];
    expect(owesReplyFromHistory([], sheThenHe)).toBe(false);

    expect(dropBlameSegmentsWhenOwing("昨晚聊着聊着就没影了 我还等着呢")).toBe("");
    expect(dropBlameSegmentsWhenOwing("你怎么不回我")).toBe("");
    // 正常的段不受影响
    expect(dropBlameSegmentsWhenOwing("早呀 昨晚睡挺好")).toBe("早呀 昨晚睡挺好");
    expect(dropBlameSegmentsWhenOwing("早呀|||你怎么不回我")).toBe("早呀");
    // 提示词里也要写明这条
    expect(buildRelationshipBoundaryPrompt(2, "早上好", [])).not.toContain("倒打一耙");
  });

  it("never forces the model to ask about marital status (real case, asked 3 times)", () => {
    // 2026-10-07 用户澄清：要求只有一条——排除已婚的；不是“必须问清婚况”。
    // 之前那句“直接问，别绕：聊上几句之后就问一句他到底单身还是已婚”是连问三遍的源头。
    const prompt = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠。",
      platform: "soul",
      homeLocation: { city: "重庆", district: "江北区" },
      workLocation: { city: "重庆", district: "江北区" },
      currentDatetime: "2026-10-07 18:00",
      weather: { city: "重庆", condition: "晴", temp: 25 },
      messages: [{ role: "user", content: "搞不来那些弯弯拐拐的" }],
      historyMessages: [],
      contactMaritalStatus: "",
    });
    expect(prompt).not.toContain("直接问，别绕");
    expect(prompt).not.toContain("你是单身还是已婚呀");
    const known = buildLayeredSystemPrompt({
      personaPrompt: "你是苏棠。",
      platform: "soul",
      homeLocation: { city: "重庆", district: "江北区" },
      workLocation: { city: "重庆", district: "江北区" },
      currentDatetime: "2026-10-07 18:00",
      weather: { city: "重庆", condition: "晴", temp: 25 },
      messages: [{ role: "user", content: "在忙吗" }],
      historyMessages: [],
      contactMaritalStatus: "single",
    });
    // 2026-10-07 用户要求：婚况不进提示词（别白烧 token）。已婚的根本走不到这里（引擎层挡掉），
    // 单身/离异照常聊，也不需要任何提醒。
    expect(known).not.toContain("婚况");
    expect(known).not.toContain("单身");
  });

  it("recognizes his marital status even without 我 (real case: 雾琐星河岸)", () => {
    // 2026-10-07 真机：他说“肯定是单身撒”“单身汉”，因为没有“我”字，旧判断认不出来，
    // 于是她连问三遍“你是单身还是已婚呀”，被对方点破“你问了三次了”。
    expect(detectContactMaritalStatus([{ role: "user", content: "肯定是单身撒" }])).toBe("single");
    expect(detectContactMaritalStatus([{ role: "user", content: "单身汉" }])).toBe("single");
    expect(detectContactMaritalStatus([{ role: "user", content: "我离异" }])).toBe("single");
    // 已婚仍要认出来（这类会被直接停回）
    expect(detectContactMaritalStatus([{ role: "user", content: "我结婚了" }])).toBe("married");
    expect(detectContactMaritalStatus([{ role: "user", content: "我有老婆" }])).toBe("married");
    // 说别人单身不算他单身，也不能误判成已婚
    expect(detectContactMaritalStatus([{ role: "user", content: "我朋友单身好多年了" }])).toBe("");
    expect(detectContactMaritalStatus([{ role: "user", content: "结婚了还来这个上面哇" }])).toBe("");
    // 她自己说自己已婚不算他的婚况
    expect(detectContactMaritalStatus([{ role: "assistant", content: "我结婚了我有老公" }])).toBe("");
  });

  it("drops the segment where she accepts his photos", () => {
    // 真机：他说“我给你看我的照片”，她回“真的假的 那我得看看”。只删这段，不换固定句。
    expect(isSelfMediaOffer("想不想看我的身材照")).toBe(true);
    expect(isSelfMediaOffer("我给你看看我的腹肌")).toBe(true);
    expect(isSelfMediaOffer("今天天气不错")).toBe(false);
    expect(dropAcceptedSelfMediaSegments("真的假的 那我得看看")).toBe("");
    expect(dropAcceptedSelfMediaSegments("这么主动呀|||那我得看看")).toBe("这么主动呀");
    expect(dropAcceptedSelfMediaSegments("这么晚了还秀腹肌呀")).toBe("这么晚了还秀腹肌呀");
  });

  it("fixes the spouse perspective in replies", () => {
    // 真机（仙逆）：对方说"你老公"指的是苏棠的老公，模型跟着叫"你老公"却讲自己的事。
    expect(fixSpousePerspective("你老公天天跑渠道 估计没空管我聊什么？"))
      .toBe("我老公天天跑渠道 估计没空管我聊什么？");
    expect(fixSpousePerspective("我老公忙呢|||你老公天天跑渠道 估计没空管我"))
      .toBe("我老公忙呢|||我老公天天跑渠道 估计没空管我");
    // 2026-10-06：同族的“娃/孩子”也要一起管住（真机里对方说“娃娃”指的是苏棠的娃）
    expect(fixSpousePerspective("你娃多大了")).toBe("我娃多大了");
    expect(fixSpousePerspective("你孩子睡了吧")).toBe("我孩子睡了吧");
    // 反问对方的情况不算错
    expect(fixSpousePerspective("你老公呢？")).toBe("你老公呢？");
    expect(fixSpousePerspective("你孩子多大了")).toBe("我孩子多大了");
    expect(fixSpousePerspective("我老公做粮油销售的")).toBe("我老公做粮油销售的");
  });

  it("never sends half a sentence when the model breaks a line mid-sentence", () => {
    // 真机（遇见 2026-10-07 23:10）：她发出去“刚关了电脑 屋里就剩”，对方回“就剩什么”。
    const reply = "刚关了电脑 屋里就剩\n我这盏灯还亮着呢";
    const fixed = capReplyLength(reply, "你在干嘛");
    // 句中换行只补成空格，整句话完整留下，不能切成半句。
    expect(fixed).toBe("刚关了电脑 屋里就剩 我这盏灯还亮着呢");
  });

  it("keeps model segments untouched instead of rewriting their words", () => {
    expect(capReplyLength(
      "看这边|||你这起床方式够直接的",
      "起床窝尿啦！",
    )).toBe("看这边|||你这起床方式够直接的");
    expect(capReplyLength(
      "看这边，你这起床方式够直接的",
      "起床窝尿啦！",
    )).toBe("看这边，你这起床方式够直接的");
  });

  it("keeps a complete sentence that ends with a pronoun", () => {
    const fixed = capReplyLength(
      "谢谢 你眼光不错|||你这个点才想起我",
      "你这高跟鞋真好看",
    );

    expect(fixed).toBe("谢谢 你眼光不错|||你这个点才想起我");
  });

  it("keeps one natural sentence as one segment even when his message is long", () => {
    const fixed = capReplyLength(
      "行 那等你忙完再说",
      "我今天从早上开始就一直在开会，手机都没顾上看，刚坐下来才看到你消息",
    );

    expect(fixed).toBe("行 那等你忙完再说");
  });

  it("allows three natural pieces without splitting a thought mid-way", () => {
    const fixed = capReplyLength(
      "刚忙完|||你这起床方式也太直接了|||今天不用赶着出门吗",
      "起床窝尿啦！",
    );

    expect(fixed).toBe("刚忙完|||你这起床方式也太直接了|||今天不用赶着出门吗");
    expect(fixed.split("|||")).toHaveLength(3);
  });

  it("keeps model fragments separate instead of gluing them into a new sentence", () => {
    const fixed = capReplyLength(
      "大学城啊|||那头我可不太熟|||你常往那边跑？",
      "我在大学城",
    );

    expect(fixed).toBe("大学城啊|||那头我可不太熟|||你常往那边跑？");
  });

  it("does not split a complete sentence by length or spaces", () => {
    const reply = "大学城啊 那头我可不太熟 你常往那边跑？";
    expect(capReplyLength(reply, "我在大学城")).toBe(reply);
  });

  it("drops extra whole pieces instead of packing fragments together", () => {
    const fixed = capReplyLength(
      "第一句|||第二句|||第三句|||第四句",
      "继续说",
    );

    expect(fixed).toBe("第一句|||第二句|||第三句");
  });

  it("splits at clear message changes without changing the words", () => {
    expect(capReplyLength(JSON.stringify({ reply: "晚上好 在忙什么呢" }), "晚上好")).toBe("晚上好 在忙什么呢");

    expect(capReplyLength(
      JSON.stringify({
        messages: [
          "刚认识就脸红 你倒挺纯",
          "晚上好 在忙什么呢",
        ],
      }),
      "晚上好",
    )).toBe("刚认识就脸红 你倒挺纯|||晚上好 在忙什么呢");

    expect(capReplyLength(
      JSON.stringify({
        messages: [
          "躺这么早 不闷吗？",
          "我这时候才刚把娃哄睡",
        ],
      }),
      "你睡了吗",
    )).toBe("躺这么早 不闷吗？|||我这时候才刚把娃哄睡");

    expect(capReplyLength(
      JSON.stringify({
        messages: [
          "晚上好",
          "白天在婆婆和同事面前规规矩矩",
        ],
      }),
      "你好，另一面的你",
    )).toBe("晚上好|||白天在婆婆和同事面前规规矩矩");

    expect(capReplyLength(
      JSON.stringify({
        messages: [
          "带娃的人 哪有清闲的",
          "你反应这么大 是没见过还是不信",
        ],
      }),
      "都有娃了啊",
    )).toBe("带娃的人 哪有清闲的|||你反应这么大 是没见过还是不信");
  });

  it("rejects an overlong unstructured message instead of sending a long paragraph", () => {
    const long = "这是一个超过二十五个字并且完全没有任何停顿的完整想法必须继续往下说";
    expect(capReplyLength(JSON.stringify({ messages: [long] }), "在吗"))
      .toBe("嗯 你接着说");
  });

  it("only uses complete punctuation when an overlong message needs a safe fallback split", () => {
    const first = "第一句完整内容要写得长一点";
    const second = "第二句完整内容也要写得长一点";
    expect(capReplyLength(JSON.stringify({ messages: [first + "。" + second + "。"] }), "在吗"))
      .toBe(first + "。|||" + second + "。");
  });

  it("drops a repeated delay excuse but keeps the substance", () => {
    // 真机原样（一一）：23:59 说过“刚看手机才看到”，00:12 又说“刚没顾上看手机”。
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { role: "user", content: "睡着了吗", created_at: now - 900 },
      { role: "assistant", content: "没睡呢 刚看手机才看到|||啥短剧这么上头 一下就入坑了", created_at: now - 700 },
    ];
    const reply = "没睡着呀 刚没顾上看手机|||傻不拉几的 是说自己看剧看傻了呗";
    expect(avoidRepeatedAssistantReply(reply, history, "傻不拉几的", now))
      .toBe("傻不拉几的 是说自己看剧看傻了呗");
  });

  it("keeps a fresh multi-segment reply untouched", () => {
    const now = Math.floor(Date.now() / 1000);
    const history = [
      { role: "assistant", content: "刚把娃哄睡", created_at: now - 3600 },
    ];
    const reply = "今天单子多 刚忙完|||你也早点歇着呀";
    expect(avoidRepeatedAssistantReply(reply, history, "忙啥呢", now)).toBe(reply);
  });
});
