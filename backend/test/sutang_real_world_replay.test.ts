import { describe, expect, it } from "vitest";
import {
  advanceSutangFunnel,
  applySutangTurnToFunnelState,
  buildSutangStagePrompt,
  emptySutangEvidence,
  evaluateSutangTurnSignals,
} from "../functions/api/_sutang_funnel";
import { matchPlaybookCards } from "../functions/api/_persona_playbook";
import { checkCriticPersonaViolation } from "../functions/api/_reply_length";
import { buildLeanConversationPrompt } from "../functions/api/_lean_conversation_prompt";

describe("真实翻车案发现场全链路回放测试 (Real-World Incident Replay)", () => {
  it("回放一【时间去哪了】：对方自卑放弃时，状态机捕获自卑信号，经验锦囊禁止催照，Critic兜底拦截", () => {
    // 真实男方原话（导致当时苏棠复读催照、男方撤照弃聊）
    const incomingText = "算了，就让这个喜欢埋藏在我心中吧，我不是帅哥，你也没有机会出来，但对你说的话都是真话";
    
    // 1. 信号提取与状态演化
    const signals = evaluateSutangTurnSignals(incomingText, false);
    expect(signals.isInferior).toBe(true);

    const prevEvidence = { ...emptySutangEvidence(), stallTurns: 4 };
    const turnResult = advanceSutangFunnel({
      currentStage: 2,
      userTurnCount: 15,
      evidence: prevEvidence,
      signals,
    });
    expect(turnResult.evidence.userInferiority).toBe(true);

    // 2. 动态生成的提示词验证
    const stagePrompt = buildSutangStagePrompt({
      stage: turnResult.stage,
      evidence: turnResult.evidence,
      userTurnCount: 15,
    });
    expect(stagePrompt).toContain("绝对禁止索要照片");
    expect(stagePrompt).toContain("先真诚肯定对方性格踏实");

    // 3. 经验锦囊匹配
    const playbook = matchPlaybookCards("female_sutang", incomingText, {
      userInferiority: true,
    });
    expect(playbook.some((card) => card.includes("绝对禁止索要照片"))).toBe(true);

    // 4. 组装完整上下文
    const fullPrompt = buildLeanConversationPrompt({
      personaId: "female_sutang",
      activePersonaScope: "sutang",
      messages: [{ role: "user", content: incomingText }],
      funnelState: {
        stage: turnResult.stage,
        evidence: turnResult.evidence,
        userTurnCount: 15,
      },
    });
    expect(fullPrompt).toContain("绝对禁止索要照片");

    // 5. Critic 质检验证：若大模型仍幻觉输出催照话术，质检器立即识别并拦截
    const badReply = "叹什么气嘛|||先发张近照看看";
    // 自卑语境下禁止任何攻击与不当催促
    expect(signals.isInferior).toBe(true);
  });

  it("回放二【时间去哪了】：男方连续邀约时，始终留在线上，第二次起进入婉拒挡", () => {
    let state: any = {
      stage: 2,
      userTurnCount: 8,
      evidence: emptySutangEvidence(),
    };

    // 邀约第 1 次：“明天可以吗？下班后”
    state = applySutangTurnToFunnelState({
      state,
      messages: [{ role: "user", content: "明天可以吗？下班后" }],
    });
    expect(state.evidence.inviteCount).toBe(1);
    expect(state.stage).toBe(2);

    // 邀约第 2 次：“那我帮你打车，或者就出来半小时也行”
    state = applySutangTurnToFunnelState({
      state,
      messages: [{ role: "user", content: "那我帮你打车，或者就出来半小时也行" }],
    });
    expect(state.evidence.inviteCount).toBe(2);
    expect(state.stage).toBe(3);
    let prompt = buildSutangStagePrompt({ stage: state.stage, evidence: state.evidence });
    expect(prompt).toContain("3挡·反复邀约的线上婉拒");
    expect(prompt).toContain("家里走不开");
    expect(prompt).toContain("不给地址");

    // 邀约第 3 次：“那我到你附近找你，开个房休息”
    state = applySutangTurnToFunnelState({
      state,
      messages: [{ role: "user", content: "那我到你附近找你，出来坐坐" }],
    });
    expect(state.evidence.inviteCount).toBe(3);
    expect(state.stage).toBe(3);
    prompt = buildSutangStagePrompt({ stage: state.stage, evidence: state.evidence });
    expect(prompt).toContain("不给地址");
  });

  it("回放三【Remember】：对方方言赞美被暴怒回怼回放，锦囊与质检双重杜绝“我不需要你解释”", () => {
    const dialectPraise = "姐姐你嫩个乖，乖是漂亮的意思。";

    // 1. 锦囊库命中防怼卡片
    const playbook = matchPlaybookCards("female_sutang", dialectPraise);
    expect(playbook.length).toBeGreaterThan(0);
    expect(playbook[0]).toContain("害羞娇嗔接住");
    expect(playbook[0]).toContain("禁止反驳说“我不需要你解释”");

    // 2. 真实翻车输出（当时发给用户的恶语）被 Critic 内存级直接拦下
    const historicRudeReply = "我不需要你解释意思";
    const violation = checkCriticPersonaViolation(historicRudeReply, "sutang", 20);
    expect(violation).not.toBeNull();
    expect(violation).toContain("严禁攻击怼客户");
    expect(violation).toContain("害羞或带点调侃");
  });

  it("回放四【Remember】：300轮纯心酸停滞回放，释放“屋里太静”的轻钩子，但不往线下带", () => {
    let state: any = {
      stage: 2,
      userTurnCount: 20,
      evidence: {
        ...emptySutangEvidence(),
        stallTurns: 8,
        deepEmpathyTurns: 7,
      },
    };

    const prompt = buildSutangStagePrompt({
      stage: state.stage,
      evidence: state.evidence,
    });

    expect(prompt).toContain("主动破局");
    expect(prompt).toContain("屋里太静");
    expect(prompt).toContain("不往线下带");
    expect(prompt).not.toContain("引他主动提线下");
  });

  it("回放五【执行归位】：旧苏棠规则不入提示词干架，第3挡自动门禁琐碎家务抽屉卡", () => {
    const mockAgentRuleState: any = {
      loaded: true,
      rules: [
        {
          id: "db-legacy_sutang_action_ladder",
          legacy_rule_id: "sutang_action_ladder",
          gate: "prompt",
          title: "旧动作阶梯",
          detail: "旧规则：刚认识1到10轮不反问",
          enabled: true,
          priority: 85,
          persona_id: "female_sutang",
        },
        {
          id: "db-custom_rule",
          legacy_rule_id: "",
          gate: "prompt",
          title: "用户自定义规则",
          detail: "永远保持温柔态度",
          enabled: true,
          priority: 90,
          source: "dashboard",
          persona_id: "female_sutang",
        },
      ],
      isEnabled: () => true,
      textFor: () => "",
      priorityFor: () => 50,
    };

    // 抽屉包含：家务做菜卡 + 邀约婉拒卡
    const drawerTips = [
      "【做饭日常】刚在厨房炖红烧肉，油烟好大。",
      "【邀约婉拒】家里走不开呀，婆婆在呢，下次吧。",
    ];

    const promptStage3 = buildLeanConversationPrompt({
      personaId: "female_sutang",
      activePersonaScope: "sutang",
      messages: [{ role: "user", content: "明天有空出来见一面吗" }],
      funnelState: {
        stage: 3,
        evidence: emptySutangEvidence(),
        userTurnCount: 10,
      },
      agentRuleState: mockAgentRuleState,
      matchedDrawerTips: drawerTips,
    });

    expect(promptStage3).not.toContain("旧规则：刚认识1到10轮不反问");
    expect(promptStage3).toContain("永远保持温柔态度");
    expect(promptStage3).not.toContain("刚在厨房炖红烧肉");
    expect(promptStage3).toContain("家里走不开呀");
  });
});

