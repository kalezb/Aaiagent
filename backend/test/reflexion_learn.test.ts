import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLAYBOOK_CARDS,
  deleteCustomPlaybookCard,
  handlePlaybookRequest,
  learnFromConversation,
  loadPersonaPlaybookCards,
  matchPlaybookCards,
  saveCustomPlaybookCard,
  setCachedCustomCards,
} from "../functions/api/_persona_playbook";

describe("Reflexion Playbook & Self-Learning Engine", () => {
  it("loads default built-in playbook cards for female_sutang", async () => {
    const cards = await loadPersonaPlaybookCards(null, "female_sutang");
    expect(cards.length).toBeGreaterThanOrEqual(6);
    expect(cards.some((c) => c.id === "pb_001_inferiority")).toBe(true);
    expect(cards.some((c) => c.id === "pb_002_dialect_praise")).toBe(true);
    expect(cards.some((c) => c.id === "pb_006_invite_ladder")).toBe(true);
  });

  it("dynamically matches default cards based on conversation context", () => {
    // 1. Inferiority
    const hitsInferior = matchPlaybookCards("female_sutang", "我不是帅哥还是算了", {
      userInferiority: true,
    });
    expect(hitsInferior.length).toBeGreaterThan(0);
    expect(hitsInferior[0]).toContain("绝对禁止索要照片");

    // 2. Dialect praise
    const hitsDialect = matchPlaybookCards("female_sutang", "妹子你嫩个乖，意思是长相好看", {});
    expect(hitsDialect.length).toBeGreaterThan(0);
    expect(hitsDialect[0]).toContain("绝对禁止反驳说“我不需要你解释”");

    // 3. Stalled deep conversation
    const hitsStall = matchPlaybookCards("female_sutang", "今天工作好累啊天天加班", {
      stallTurns: 8,
    });
    expect(hitsStall.length).toBeGreaterThan(0);
    expect(hitsStall[0]).toContain("屋里太静");

    // 4. Vulgar harassment protection
    const hitsVulgar = matchPlaybookCards("female_sutang", "跪在我面前想舔你", {});
    expect(hitsVulgar.length).toBeGreaterThan(0);
    expect(hitsVulgar.some((h) => h.includes("绝对禁止顺从迎合"))).toBe(true);
    expect(hitsVulgar.some((h) => h.includes("拉高身价"))).toBe(true);

    // 5. 家庭与线下边界
    const hitsFamily = matchPlaybookCards("female_sutang", "你婆婆在家吗", {});
    expect(hitsFamily.length).toBeGreaterThan(0);
    expect(hitsFamily.some((h) => h.includes("不编造经历"))).toBe(true);
    expect(hitsFamily.some((h) => h.includes("不答应、不给地址"))).toBe(true);
  });

  it("saves and matches a custom vernacular card in real time", async () => {
    const customCard = {
      id: "pb_custom_test_parttime",
      personaId: "female_sutang",
      triggerCondition: "对方问做不做兼职或副业",
      instruction: "【自学避坑锦囊】娇嗔说在家带娃脑子都转不动了，哪有那本事，绝不聊投资或商业话题。",
      priority: 90,
      keywords: ["兼职", "副业", "投资", "赚钱"],
      source: "user" as const,
    };

    await saveCustomPlaybookCard(null, customCard);

    // Verify it is returned in matchPlaybookCards
    const hits = matchPlaybookCards("female_sutang", "你平时做不做副业兼职啊？", {});
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.includes("在家带娃脑子都转不动了"))).toBe(true);

    // Cleanup
    await deleteCustomPlaybookCard(null, "female_sutang", "pb_custom_test_parttime");
    const hitsAfterDelete = matchPlaybookCards("female_sutang", "你平时做不做副业兼职啊？", {});
    expect(hitsAfterDelete.some((h) => h.includes("在家带娃脑子都转不动了"))).toBe(false);
  });

  it("autonomously learns and generates a playbook card from a stalled conversation with user feedback", async () => {
    const result = await learnFromConversation({
      personaId: "female_sutang",
      contactName: "测试客户",
      flawDescription: "对方问微信号，她直接说不给，太生硬了吵架了",
      messages: [
        { role: "user", content: "方便加个微信号吗？" },
        { role: "assistant", content: "我不加微信，你别要了" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.card.triggerCondition).toContain("微信");
    expect(result.card.instruction).toContain("【自学避坑锦囊】");
    expect(result.card.instruction).toContain("当前资料里的QQ");
    expect(result.card.instruction).not.toContain("豆瓣");
    expect(result.analysis).toContain("避坑锦囊");

    // Verify this newly learned card matches incoming text immediately
    const hits = matchPlaybookCards("female_sutang", "你微信多少我加你一下", {});
    expect(hits.some((h) => h.includes("当前资料里的QQ"))).toBe(true);
  });

  it("autonomously diagnoses failure points without manual user hints", async () => {
    // Dialogue case: Customer expressed inferiority and Agent was demanding photo
    const resultInferior = await learnFromConversation({
      personaId: "female_sutang",
      contactName: "Remember",
      messages: [
        { role: "assistant", content: "发张生活照看看嘛" },
        { role: "user", content: "我不是帅哥还是算了，喜欢埋心底就好" },
      ],
    });

    expect(resultInferior.success).toBe(true);
    expect(resultInferior.card.triggerCondition).toContain("自卑");
    expect(resultInferior.card.instruction).toContain("绝对禁止索要照片");

    // Dialogue case: Customer used dialect praise
    const resultPraise = await learnFromConversation({
      personaId: "female_sutang",
      contactName: "时间去哪了",
      messages: [
        { role: "user", content: "重庆话嫩个乖，就是长相好看乖巧的意思" },
      ],
    });

    expect(resultPraise.success).toBe(true);
    expect(resultPraise.card.triggerCondition).toContain("赞美");
    expect(resultPraise.card.instruction).toContain("必须害羞娇嗔接住");
  });

  it("handles HTTP API routes correctly for dashboard", async () => {
    const mockEnv = {
      DASHBOARD_PASSWORD: "secret-password",
      KV: {
        store: new Map<string, string>(),
        async get(key: string, type: string) {
          const val = this.store.get(key);
          return val && type === "json" ? JSON.parse(val) : val;
        },
        async put(key: string, val: string) {
          this.store.set(key, val);
        },
      },
    };

    // 1. Unauthorized request
    const unauthReq = new Request("http://localhost/api/playbook-cards", {
      headers: {},
    });
    const unauthRes = await handlePlaybookRequest({
      request: unauthReq,
      env: mockEnv,
      url: new URL(unauthReq.url),
      path: "/api/playbook-cards",
      method: "GET",
    });
    expect(unauthRes?.status).toBe(401);

    // 2. GET cards
    const getReq = new Request("http://localhost/api/playbook-cards?persona_id=female_sutang", {
      headers: { "X-Dashboard-Password": "secret-password" },
    });
    const getRes = await handlePlaybookRequest({
      request: getReq,
      env: mockEnv,
      url: new URL(getReq.url),
      path: "/api/playbook-cards",
      method: "GET",
    });
    expect(getRes?.status).toBe(200);
    const getData = await getRes?.json();
    expect(getData.success).toBe(true);
    expect(getData.cards.length).toBeGreaterThanOrEqual(6);

    // 3. POST new card
    const postReq = new Request("http://localhost/api/playbook-cards", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dashboard-Password": "secret-password",
      },
      body: JSON.stringify({
        personaId: "female_sutang",
        triggerCondition: "对方问住在哪个小区",
        instruction: "只说在两江新区，具体小区娇嗔保密，防陌生人上门。",
        keywords: ["小区", "哪个小区", "具体住址"],
      }),
    });
    const postRes = await handlePlaybookRequest({
      request: postReq,
      env: mockEnv,
      url: new URL(postReq.url),
      path: "/api/playbook-cards",
      method: "POST",
    });
    expect(postRes?.status).toBe(200);
    const postData = await postRes?.json();
    expect(postData.success).toBe(true);
    expect(postData.card.instruction).toContain("【自学避坑锦囊】");

    // 4. POST /api/reflexion-learn
    const learnReq = new Request("http://localhost/api/reflexion-learn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Dashboard-Password": "secret-password",
      },
      body: JSON.stringify({
        persona_id: "female_sutang",
        contact_name: "时间去哪了",
        messages: [
          { role: "user", content: "重庆话嫩个乖，就是长相好看乖巧的意思" },
        ],
      }),
    });
    const learnRes = await handlePlaybookRequest({
      request: learnReq,
      env: mockEnv,
      url: new URL(learnReq.url),
      path: "/api/reflexion-learn",
      method: "POST",
    });
    expect(learnRes?.status).toBe(200);
    const learnData = await learnRes?.json();
    expect(learnData.success).toBe(true);
    expect(learnData.card).toBeDefined();
    expect(learnData.analysis).toContain("时间去哪了");

    // 5. Protected delete (cannot delete built-in cards)
    const delBuiltinReq = new Request("http://localhost/api/playbook-cards?id=pb_001_inferiority", {
      method: "DELETE",
      headers: { "X-Dashboard-Password": "secret-password" },
    });
    const delBuiltinRes = await handlePlaybookRequest({
      request: delBuiltinReq,
      env: mockEnv,
      url: new URL(delBuiltinReq.url),
      path: "/api/playbook-cards",
      method: "DELETE",
    });
    expect(delBuiltinRes?.status).toBe(400);
  });
});
