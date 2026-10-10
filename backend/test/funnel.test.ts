import { describe, expect, it } from "vitest";
import {
  applyFunnelTurn,
  collectFunnelEvidence,
  emptyFunnelEvidence,
  emptyFunnelState,
  stageMinUserTurns,
} from "../functions/api/_funnel";

function state(overrides = {}) {
  return {
    ...emptyFunnelState(),
    evidence: { ...emptyFunnelEvidence() },
    ...overrides,
  };
}

describe("persistent Xingmu funnel", () => {
  it("does not advance from message count alone", () => {
    const result = applyFunnelTurn({
      state: state({ userTurnCount: 5, stage: 1 }),
      messages: [{ role: "user", content: "在干嘛" }],
      platform: "soul",
      requestId: "turn-6",
      nowSec: 100,
    });

    expect(result.state.userTurnCount).toBe(6);
    expect(result.state.stage).toBe(1);
  });

  it("uses the shortened six-stage turn windows", () => {
    expect([1, 2, 3, 4, 5, 6].map(stageMinUserTurns))
      .toEqual([1, 6, 12, 20, 26, 30]);
  });

  it("keeps the stage paused when no new user message arrives", () => {
    const result = applyFunnelTurn({
      state: state({
        stage: 1,
        userTurnCount: 10,
        evidence: {
          ...emptyFunnelEvidence(),
          conversationBackAndForth: true,
          soulUnseenUnderstood: true,
        },
      }),
      messages: [],
      platform: "soul",
      requestId: "idle-check",
      countTurn: false,
      nowSec: 50,
    });

    expect(result.state.stage).toBe(1);
    expect(result.advanced).toBe(false);
  });

  it("advances one stage only when the window and evidence are both satisfied", () => {
    const result = applyFunnelTurn({
      state: state({ userTurnCount: 5, stage: 1 }),
      historyMessages: [
        { role: "user", content: "今天下班路过咖啡店，想看看你的日常照" },
        { role: "assistant", content: "刚到家，晚点说" },
      ],
      messages: [{ role: "user", content: "今天有点累" }],
      platform: "soul",
      requestId: "turn-6",
      nowSec: 100,
    });

    expect(result.advanced).toBe(true);
    expect(result.state.stage).toBe(2);
    expect(result.state.evidence.photoSignal).toBe(true);
    expect(result.state.evidence.lifeSignal).toBe(true);
  });

  it("counts a request batch once and does not count imported history", () => {
    const first = applyFunnelTurn({
      state: state(),
      historyMessages: Array.from({ length: 50 }, (_, index) => ({
        role: "user",
        content: "导入历史-" + index,
      })),
      messages: [
        { role: "user", content: "第一条" },
        { role: "user", content: "第二条" },
      ],
      platform: "soul",
      requestId: "same-request",
      nowSec: 100,
    });
    const duplicate = applyFunnelTurn({
      state: first.state,
      messages: [{ role: "user", content: "重复重试" }],
      platform: "soul",
      requestId: "same-request",
      countTurn: false,
      nowSec: 101,
    });

    expect(first.state.userTurnCount).toBe(2);
    expect(duplicate.state.userTurnCount).toBe(2);
  });

  it("demotes one stage for a clear negative signal at most once per day", () => {
    const first = applyFunnelTurn({
      state: state({ stage: 4, userTurnCount: 40 }),
      messages: [{ role: "user", content: "别再发消息了，不感兴趣" }],
      platform: "soul",
      requestId: "negative-1",
      nowSec: 200_000,
    });
    const second = applyFunnelTurn({
      state: first.state,
      messages: [{ role: "user", content: "拉黑了" }],
      platform: "soul",
      requestId: "negative-2",
      nowSec: 200_100,
    });

    expect(first.state.stage).toBe(3);
    expect(first.negative).toBe(true);
    expect(second.state.stage).toBe(3);
  });

  it("requires willingness before entering the evaluation stage", () => {
    const blocked = applyFunnelTurn({
      state: state({ stage: 5, userTurnCount: 29 }),
      messages: [{ role: "user", content: "今天挺忙" }],
      platform: "soul",
      requestId: "stage-5-blocked",
      nowSec: 300_000,
    });
    const ready = applyFunnelTurn({
      state: blocked.state,
      messages: [{ role: "user", content: "家里有旧手机，怎么收" }],
      platform: "soul",
      requestId: "stage-5-ready",
      nowSec: 300_100,
    });

    expect(blocked.state.stage).toBe(5);
    expect(ready.state.stage).toBe(6);
    expect(ready.state.evidence.willingToRecycle).toBe(true);
  });

  it("requires real device context before counting photo and recycle willingness evidence", () => {
    const casualPhoto = collectFunnelEvidence({
      messages: [{ role: "user", content: "我刚拍了张照片，晚点发朋友圈" }],
      platform: "soul",
    });
    const requestedPhoto = collectFunnelEvidence({
      messages: [{ role: "user", content: "想看看你的日常照" }],
      platform: "soul",
    });
    const genericFamily = collectFunnelEvidence({
      messages: [{ role: "user", content: "我家里有事，晚点聊" }],
      platform: "soul",
    });
    const excludedDevice = collectFunnelEvidence({
      messages: [{ role: "user", content: "旧耳机收不收" }],
      platform: "soul",
    });
    const supportedDevices = collectFunnelEvidence({
      messages: [{ role: "user", content: "家里有旧手机、旧键盘鼠标和U盘，怎么收" }],
      platform: "soul",
    });

    expect(casualPhoto.photoSignal).toBe(false);
    expect(requestedPhoto.photoSignal).toBe(true);
    expect(genericFamily.willingToRecycle).toBe(false);
    expect(excludedDevice.willingToRecycle).toBe(false);
    expect(supportedDevices.acceptedBusinessTopic).toBe(true);
    expect(supportedDevices.willingToRecycle).toBe(true);
  });

  it("does not bypass the minimum turn window when a deal is already reported", () => {
    const result = applyFunnelTurn({
      state: state({ stage: 1, userTurnCount: 2 }),
      messages: [{ role: "user", content: "之前的旧手机已经收成了" }],
      platform: "soul",
      requestId: "deal-too-early",
      nowSec: 400_000,
    });

    expect(result.state.evidence.dealCompleted).toBe(true);
    expect(result.state.stage).toBe(1);
    expect(result.advanced).toBe(false);
  });

  it("does not reopen the funnel after the evaluation quote was sent", () => {
    const result = applyFunnelTurn({
      state: state({
        stage: 6,
        userTurnCount: 50,
        evaluationQuoteSent: true,
        completed: true,
        lastNegativeAt: 0,
      }),
      messages: [{ role: "user", content: "别再发消息了，不感兴趣" }],
      platform: "soul",
      requestId: "negative-after-complete",
      nowSec: 500_000,
    });

    expect(result.state.stage).toBe(6);
    expect(result.state.completed).toBe(true);
    expect(result.negative).toBe(true);
  });
});
