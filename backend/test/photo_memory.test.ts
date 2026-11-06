import {
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { onRequest } from "../functions/api/[[route]]";
import {
  latestIncomingPhotoTimestamp,
  recoverIncomingPhotoFromHistory,
  rememberIncomingPhotoFromMessages,
} from "../functions/api/_photo_memory";
import { buildLeanConversationPrompt } from "../functions/api/_lean_conversation_prompt";
import {
  MockD1,
  MockKV,
} from "./chat-test-helpers";

describe("incoming photo memory", () => {
  it("does not inject a photo demand into normal Su Tang chat", () => {
    const prompt = buildLeanConversationPrompt({
      personaId: "female_sutang",
      personaPrompt: "你是苏棠。",
      platform: "soul",
      messages: [{ role: "user", content: "明天哪走得开，婆婆孩子都在" }],
      historyMessages: [
        { role: "assistant", content: "我还没见过你照片呢" },
        { role: "user", content: "我只有寸照了" },
      ],
      activePersonaScope: "sutang",
    });

    expect(prompt).not.toContain("只能让他先发一张近照");
    expect(prompt).not.toContain("你还没看过他的照片");
    expect(prompt).not.toContain("【照片】");
  });

  it("recognizes actual incoming image messages instead of photo words", () => {
    expect(latestIncomingPhotoTimestamp([
      { role: "user", content: "照片看着挺好的呀", created_at: 5 },
      { role: "assistant", content: "[图片]", created_at: 6 },
      { role: "user", content: "[图片]", created_at: 10 },
      { role: "user", content: "[图片:asset-2]", created_at: 20 },
    ])).toBe(20);

    expect(latestIncomingPhotoTimestamp([
      { role: "user", content: "我只有寸照了", created_at: 10 },
      { role: "user", content: "照片看着挺好的呀", created_at: 20 },
    ])).toBe(0);
  });

  it("keeps the earliest actual photo time and never overwrites it with a later image", async () => {
    const db = new MockD1();
    await rememberIncomingPhotoFromMessages(db, {
      token: "test-token",
      platform: "soul",
      contactId: "contact-photo",
      contactName: "照片联系人",
      messages: [{ role: "user", content: "[图片]", created_at: 50 }],
      nowSec: 100,
    });
    await rememberIncomingPhotoFromMessages(db, {
      token: "test-token",
      platform: "soul",
      contactId: "contact-photo",
      contactName: "照片联系人",
      messages: [{ role: "user", content: "[图片]", created_at: 80 }],
      nowSec: 120,
    });

    expect(db.contactsRows.find((row) => row.contact_id === "contact-photo")?.his_photo_at).toBe(50);
  });

  it("recovers a missed photo mark from the cloud message history", async () => {
    const db = new MockD1(
      [{
        id: 1,
        token: "test-token",
        platform: "soul",
        contact_id: "contact-history-photo",
        role: "user",
        content: "[图片]",
        created_at: 1792338417,
      }],
      [{ id: "female", name: "星暮" }],
      [{
        token: "test-token",
        platform: "soul",
        contact_id: "contact-history-photo",
        contact_name: "照片联系人",
        his_photo_at: 0,
      }],
    );

    const recovered = await recoverIncomingPhotoFromHistory(db, {
      token: "test-token",
      platform: "soul",
      contactId: "contact-history-photo",
      contactName: "照片联系人",
      nowSec: 200,
    });

    expect(recovered).toBe(1792338417);
    expect(db.contactsRows[0].his_photo_at).toBe(1792338417);
  });

  it("records an image before any early return from the reply flow", async () => {
    const db = new MockD1(
      [],
      [{ id: "female", name: "星暮" }],
      [{
        token: "test-token",
        platform: "soul",
        contact_id: "contact-early-return",
        contact_name: "提前返回",
        his_photo_at: 0,
        is_whitelisted: 1,
      }],
    );
    db.conversationStatsRows.push({
      token: "test-token",
      platform: "soul",
      contact_id: "contact-early-return",
      mode: "manual",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await onRequest({
      request: new Request("https://example.com/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          request_id: "photo-before-early-return",
          platform: "soul",
          contact_id: "contact-early-return",
          contact_name: "提前返回",
          messages: [{
            role: "user",
            content: "[图片]",
            created_at: 1792338417,
          }],
        }),
      }),
      env: {
        DB: db,
        KV: new MockKV(),
        DEEPSEEK_API_KEY: "deepseek-key",
      },
    } as never);

    await expect(response.json()).resolves.toMatchObject({
      action: "skip",
      reason: "human_takeover_active",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.contactsRows[0].his_photo_at).toBe(1792338417);
  });
});
