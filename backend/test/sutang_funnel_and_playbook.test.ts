import { describe, expect, it } from "vitest";
import {
  advanceSutangFunnel,
  applySutangTurnToFunnelState,
  buildSutangStagePrompt,
  emptySutangEvidence,
  evaluateSutangTurnSignals,
} from "../functions/api/_sutang_funnel";
import { matchPlaybookCards } from "../functions/api/_persona_playbook";

describe("Sutang Funnel & Self-Learning Playbook Architecture", () => {
  it("progresses stage from ice_break to resonance after enough turns or deep empathy", () => {
    const initial = emptySutangEvidence();
    const turn1 = advanceSutangFunnel({
      currentStage: 1,
      userTurnCount: 3,
      evidence: initial,
      signals: { isInvite: false, isInferior: false, isEmpathy: false, hasSentPhoto: false },
    });
    expect(turn1.stage).toBe(1);

    const turn2 = advanceSutangFunnel({
      currentStage: 1,
      userTurnCount: 7,
      evidence: turn1.evidence,
      signals: { isInvite: false, isInferior: false, isEmpathy: true, hasSentPhoto: false },
    });
    expect(turn2.stage).toBe(2);
  });

  it("triggers a gentle night hook when stalled in stage 2, without pushing offline", () => {
    const evidence = {
      ...emptySutangEvidence(),
      stallTurns: 7,
      deepEmpathyTurns: 6,
    };
    const prompt = buildSutangStagePrompt({ stage: 2, evidence });
    expect(prompt).toContain("主动破局");
    expect(prompt).toContain("屋里太静");
    expect(prompt).not.toContain("引他主动提线下");
    expect(prompt).not.toContain("被窝真冷");
  });

  it("keeps every invite on the online side: 1st invite stays, 2nd invite goes to refusal stage", () => {
    const first = advanceSutangFunnel({
      currentStage: 2,
      userTurnCount: 10,
      evidence: emptySutangEvidence(),
      signals: { isInvite: true, isInferior: false, isEmpathy: false, hasSentPhoto: false },
    });
    expect(first.stage).toBe(2);
    expect(first.evidence.inviteCount).toBe(1);

    const second = advanceSutangFunnel({
      currentStage: 2,
      userTurnCount: 12,
      evidence: first.evidence,
      signals: { isInvite: true, isInferior: false, isEmpathy: false, hasSentPhoto: false },
    });
    expect(second.stage).toBe(3);
    expect(second.evidence.inviteCount).toBe(2);

    const prompt = buildSutangStagePrompt({ stage: second.stage, evidence: second.evidence });
    expect(prompt).toContain("3挡·反复邀约的线上婉拒");
    expect(prompt).toContain("家里走不开");
    expect(prompt).toContain("不给地址");
    expect(prompt).toContain("不答应");
  });

  it("never advances past the online refusal stage", () => {
    let evidence = { ...emptySutangEvidence(), inviteCount: 9 };
    const result = advanceSutangFunnel({
      currentStage: 3,
      userTurnCount: 30,
      evidence,
      signals: { isInvite: true, isInferior: false, isEmpathy: false, hasSentPhoto: false },
    });
    expect(result.stage).toBe(3);
    expect(result.evidence.inviteCount).toBe(10);
  });

  it("forbids photo nagging when user expresses inferiority", () => {
    const signals = evaluateSutangTurnSignals("算了，我不是帅哥，埋藏心底吧", false);
    expect(signals.isInferior).toBe(true);

    const evidence = {
      ...emptySutangEvidence(),
      userInferiority: true,
    };
    const prompt = buildSutangStagePrompt({ stage: 2, evidence });
    expect(prompt).toContain("绝对禁止索要照片");
    expect(prompt).toContain("先真诚肯定对方性格踏实");
  });

  it("applies a turn to funnel state without hotel fields", () => {
    const state = applySutangTurnToFunnelState({
      state: { stage: 2, userTurnCount: 5, evidence: emptySutangEvidence() },
      messages: [{ role: "user", content: "周末出来见一面吧" }],
      requestId: "req-1",
      hasSeenPhoto: false,
      nowSec: 100,
    });
    expect(state.stage).toBe(2);
    expect(state.evidence.inviteCount).toBe(1);
    expect(state.evidence).not.toHaveProperty("hotelDiscussed");
    expect(state.evidence).not.toHaveProperty("doubanGiven");
  });

  it("matches Reflexion playbook cards for dialect compliments and prevents rude rebuttals", () => {
    const cards = matchPlaybookCards("female_sutang", "姐姐你嫩个乖，乖是漂亮的意思");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]).toContain("害羞娇嗔接住");
    expect(cards[0]).toContain("禁止反驳说“我不需要你解释”");
  });

  it("matches Reflexion playbook cards for sassy parries, milk tea sincerity, and grounded lifestyle", () => {
    // 1. Sassy banter
    const sassyHits = matchPlaybookCards("female_sutang", "做我女朋友可以不，想抱你");
    expect(sassyHits.some((h) => h.includes("做梦比较快") || h.includes("带刺娇嗔"))).toBe(true);

    // 2. Milk tea sincerity bridge
    const wechatHits = matchPlaybookCards("female_sutang", "加个微信呗，微信号多少");
    expect(wechatHits.some((h) => h.includes("支付宝口令") || h.includes("喜茶"))).toBe(true);

    // 3. Micro lifestyle anchoring
    const lifeHits = matchPlaybookCards("female_sutang", "周末都在干嘛呢，累不累");
    expect(lifeHits.some((h) => h.includes("天天看数据脑壳疼") || h.includes("瘫家里"))).toBe(true);
  });
});

