import { describe, expect, it } from "vitest";
import {
  normalizeChatRequest,
  normalizeHostingMode,
  normalizePlatform,
  prepareChatInput,
  validateTurnSnapshot,
} from "../functions/api/_chat_input";
import { DEFAULT_PROGRAM_RULES, normalizeProgramRules } from "../functions/api/_program_rules";
import {
  CHAT_CONTRACT_VERSION,
  contractMessageDigest,
  normalizeContractMessages,
} from "../functions/api/_chat_contract";

describe("chat input layer", () => {
  it("normalizes platform and request fields without touching business rules", () => {
    const request = normalizeChatRequest({
      platform: "SOUL",
      contact_id: " contact-1 ",
      contact_name: " 客户 ",
      request_id: "req-1",
      schema_version: 2,
      conversation_stage: "FIRST_CONTACT",
      relationship_origin: "match",
      messages: [{ role: "user", content: "你好" }],
    });
    expect(request).toMatchObject({
      platform: "soul",
      contactId: "contact-1",
      contactName: "客户",
      requestId: "req-1",
      hostingMode: "monitor_only",
      conversationStage: "first_contact",
      relationshipOrigin: "match",
    });
    expect(request.schemaVersion).toBe(CHAT_CONTRACT_VERSION);
    expect(normalizePlatform("unknown")).toBe("");
    expect(normalizeHostingMode("MONITOR_ONLY")).toBe("monitor_only");
  });

  it("drops platform notices before later chat logic sees them", () => {
    const result = prepareChatInput(
      [{ role: "user", content: "【平台提示】对方正在输入……" }],
      normalizeProgramRules(DEFAULT_PROGRAM_RULES),
    );
    expect(result).toEqual({ kind: "skip", reason: "platform_notice" });
  });

  it("returns the configured fixed voice reply before a model call", () => {
    const rules = normalizeProgramRules({
      ...DEFAULT_PROGRAM_RULES,
      untranscribedVoice: {
        enabled: true,
        mode: "fixed_reply",
        fixedReply: "在呢 你打字跟我说嘛",
        redirectInstruction: "",
      },
    });
    expect(prepareChatInput([{ role: "user", content: "[语音]" }], rules)).toEqual({
      kind: "fixed_reply",
      reason: "untranscribed_voice_fixed",
      reply: "在呢 你打字跟我说嘛",
    });
  });

  it("keeps voice type and transcript state inside the shared handoff", async () => {
    const normalized = normalizeContractMessages([
      {
        role: "user",
        content: "[语音]",
        type: "voice",
        transcript: "我到家了",
        sequence: 0,
        client_message_id: "m1",
        created_at: 100,
      },
      {
        role: "user",
        content: "你吃了吗",
        type: "text",
        sequence: 1,
        client_message_id: "m2",
        created_at: 101,
      },
    ]);

    expect(normalized[0]).toMatchObject({
      type: "voice",
      transcript: "我到家了",
      transcript_status: "complete",
    });
    expect(normalized[1]).toMatchObject({
      type: "text",
      transcript_status: "not_applicable",
    });
    expect(await contractMessageDigest(normalized)).toHaveLength(64);
  });

  it("matches the Android digest for the shared contract sample", async () => {
    const normalized = normalizeContractMessages([
      {
        role: "user",
        content: "[语音]",
        type: "voice",
        transcript: "我到家了",
        transcript_status: "complete",
        sequence: 0,
        client_message_id: "voice-1",
        created_at: 100,
      },
      {
        role: "assistant",
        content: "那就先歇会儿",
        type: "text",
        transcript: "",
        transcript_status: "not_applicable",
        sequence: 1,
        client_message_id: "text-2",
        created_at: 101,
      },
    ]);

    expect(await contractMessageDigest(normalized)).toBe(
      "cab69066eff827ce844274b47098672e3211295a6079df0167ade37993d36c71",
    );
  });

  it("accepts only a complete turn snapshot that matches the messages", async () => {
    const messages = [
      { role: "user", content: "你说呀", created_at: 100 },
      { role: "user", content: "你说多少", created_at: 101 },
    ];
    const digest = await contractMessageDigest(normalizeContractMessages(messages));
    expect(await validateTurnSnapshot({
      turn_id: "turn-1",
      message_count: 2,
      last_message_at: 101,
      capture_complete: true,
      contact_verified: true,
      message_digest: digest,
    }, messages, 2)).toEqual({ ok: true, reason: "" });
    expect(await validateTurnSnapshot({
      turn_id: "turn-1",
      message_count: 1,
      last_message_at: 101,
      capture_complete: true,
      contact_verified: true,
      message_digest: digest,
    }, messages, 2)).toEqual({ ok: false, reason: "snapshot_message_count_mismatch" });
    expect(await validateTurnSnapshot({
      turn_id: "turn-1",
      message_count: 2,
      last_message_at: 101,
      capture_complete: false,
      contact_verified: true,
      message_digest: digest,
    }, messages, 2)).toEqual({ ok: false, reason: "snapshot_capture_incomplete" });
    expect(await validateTurnSnapshot({
      turn_id: "turn-1",
      message_count: 2,
      last_message_at: 101,
      capture_complete: true,
      contact_verified: true,
      message_digest: "different",
    }, messages, 2)).toEqual({ ok: false, reason: "snapshot_message_digest_mismatch" });
    expect(await validateTurnSnapshot(null, messages, 2))
      .toEqual({ ok: false, reason: "snapshot_required" });
    expect(await validateTurnSnapshot({
      turn_id: "turn-1",
      message_count: 2,
      last_message_at: 101,
      capture_complete: true,
      contact_verified: true,
    }, messages, 2)).toEqual({ ok: false, reason: "snapshot_message_digest_missing" });
    expect(await validateTurnSnapshot({
      turn_id: "turn-1",
      message_count: 2,
      last_message_at: 101,
      capture_complete: true,
      contact_verified: false,
      message_digest: digest,
    }, messages, 2)).toEqual({ ok: false, reason: "snapshot_contact_not_verified" });
  });
});
