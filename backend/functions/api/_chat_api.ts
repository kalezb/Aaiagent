import {
  avoidRepeatedAssistantReply,
  buildLayeredSystemPrompt,
  countContactRequests,
  currentUserBatchText,
  hasEvaluationQuote,
  extractSelfLeaveInstruction,
  isIntimateTopic,
  EMPTY_REPLY_FALLBACK,
  LATE_REPLY_RULE,
  isContactRequest,
  inferSocialExitCooldownMs,
  isXingmuEvaluationTopic,
  latestIncomingText,
  loadOrCreatePendingReply,
  localAgeReply,
  localExcludedRecycleReply,
  localVoiceReply,
  normalizeLateReplyPersonaPrompt,
  replyGenerationSettings,
  resolveContactRequestPolicy,
  resolvePersonaScope,
  resolveXingmuEvaluationReply,
  sanitizeContactDisclosure,
  sanitizeGroundingMismatch,
  sanitizeBusinessTopicDrift,
  sanitizeBoundaryConsistency,
  sanitizeIntimateTopicReply,
  sanitizeMediaBoundaryReply,
  sanitizeNewContactBusinessReply,
  sanitizePersonaFactsReply,
  sanitizeXingmuProductLeak,
  fixSpousePerspective,
  owesReplyFromHistory,
  isPhotoAuthenticityChallenge,
  capReplyLength,
  detectContactMaritalStatus,
  stripLateReplyExcuse,
  heHasSentPhoto,
  sheHasSentPhoto,
  voiceStickerPressure,
  voiceSpamLine,
  dropPhotoAdmissionClauses,
  normalizeAssistantReplyPresentation,
  parseSocialExitInstruction,
  isFragmentedMessage,
} from "./_reply_policy";
import {
  evaluateActivityState,
  detectActivityFromReply,
  buildTemporalContextPrompt,
  computeRelationshipStage,
  maybeSummarizeConversation,
} from "./_temporal_state";
import {
  applyFunnelTurn,
  emptyFunnelState,
  funnelStageText,
} from "./_funnel";
import {
  buildPersonaFactsPrompt,
  resolvePersonaAge,
} from "./_persona_facts";
import {
  applyReplyDecisionPipeline,
  createImmediateReplyDecision,
} from "./_reply_decision";
import { respondWithImmediateReply } from "./_chat_delivery";
import {
  findMatchingMediaGroup,
  hasNonPersonalMediaContext,
  isBareLookRequest,
  isRealtimeImageRequest,
  parseMediaDirective,
  resolveMediaGroupForDirective,
  isExplicitPrivateMediaRequest,
  shouldClassifyPersonalPhotoIntent,
  stripMediaDirective,
} from "./_media_policy";
import { matchActiveDrawers } from "./_persona_drawers";
import {
  hasInternalRuleLeakGuard,
  isPlatformNoticeContent,
  loadProgramRules,
} from "./_program_rules";
import { loadAgentRuleState } from "./_agent_rule_runtime";
import {
  DEFAULT_GEMINI_INPUT_COST_PER_MILLION,
  DEFAULT_GEMINI_OUTPUT_COST_PER_MILLION,
  buildModelHeaders,
  buildModelRequestPayload,
  invalidateLlmConfigCache,
  isGeminiModelConfig,
  loadLlmConfig,
} from "./_model_runtime";
import {
  normalizeChatRequest,
  prepareChatInput,
  validateChatMessages,
} from "./_chat_input";
import {
  createTimeoutSignal,
  elapsedSince,
  isAbortError,
  json,
  parseJsonBody,
  resolveChatLlmTimeoutMs,
  upstreamErrorDetail,
} from "./_http_runtime";
import {
  effectivePersonaDrawers,
  loadEffectivePersonaFacts,
  loadForeignIdentityTerms,
  loadRuntimePersonaFacts,
  stripForeignPersonaSegments,
} from "./_persona_runtime";
import {
  formatChinaMessageTime,
  getChinaTimeContext,
  requestMessageEpochSeconds,
} from "./_time_runtime";
import {
  enforceTokenBudget,
  estimateLlmCost,
  recordTokenUsage,
  requestReplyRepair,
} from "./_model_call_runtime";
import {
  buildMediaPayload,
  classifyPersonalPhotoIntent,
  loadScopedMediaGroups,
  mediaDirectiveFallback,
  mediaTeaserLine,
  stageScopedMediaReply,
} from "./_media_runtime";
import {
  enforceChatRateLimit,
  isWithinAiHours,
  loadDeviceSettings,
} from "./_device_runtime";
import {
  countInsertedRows,
  dedupeHistoryAgainstCurrent,
  loadMemorySummary,
  loadRecentAssistantReplies,
  makeContactKey,
  makeSingleGroupId,
  mergeMemorySummary,
  persistMemorySummary,
  updateConversationStats,
} from "./_history_runtime";
import {
  compactProfileForPrompt,
  customerProfilePrompt,
  emptyCustomerProfile,
  formatLocation,
  loadCustomerProfile,
  loadDeviceLocation,
  mergeCustomerProfile,
  mergeProfileValue,
  parseJsonObject,
  profileCandidateText,
  resolveProfileGroup,
} from "./_profile_runtime";
import { validateToken } from "./_access_runtime";
import { resolveIncomingDelayPolicy } from "./_message_delay";
import {
  formatCurrentChatMessage,
  formatTranscriptLine,
} from "./_transcript_runtime";
import {
  sanitizeInternalInstructionLeak,
  sanitizeAssistantReply,
  sanitizeStaleAssistantReply,
} from "./_assistant_output";
import {
  loadActivityStats,
  loadFunnelState,
  loadPendingEvaluationQuote,
  markFunnelQuoteSent,
  parseFunnelStateRow,
  persistFunnelState,
} from "./_funnel_runtime";
import { getWeather } from "./_weather_runtime";
import {
  isXingmuPersonaScope,
  resolveContactConfig,
} from "./_persona_scope_runtime";

export async function handleChatRequest({ request, env, context, path, method }) {
    // POST /api/chat — core AI reply
    if (path === "/api/chat" && method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const tokenRow = await validateToken(env.DB, authHeader);
      if (!tokenRow) return json({ error: "\u65e0\u6548\u7684\u8bbe\u5907\u5bc6\u94a5" }, 401);
      const parsedBody = await parseJsonBody(request, 96 * 1024);
      if (parsedBody.error) return json({ error: parsedBody.error }, parsedBody.status);
      const body = parsedBody.body;
      const normalizedRequest = normalizeChatRequest(body);
      const {
        platform,
        contactId: contact_id,
        contactName: contact_name,
        location,
        rawMessages,
        selfNickname,
        hostingMode,
        conversationTimeline,
        conversationStage,
        relationshipOrigin,
        requestId,
      } = normalizedRequest;
      if (!platform || !contact_id || !contact_name) return json({ error: "缺少必要参数" }, 400);
      if (!validateChatMessages(rawMessages)) return json({ error: "消息格式无效或数量超限" }, 400);
      const programRules = await loadProgramRules(env.KV);
      const preparedInput = prepareChatInput(rawMessages, programRules);
      if (preparedInput.kind === "skip") {
        return json({
          action: "skip",
          reason: preparedInput.reason,
          request_id: requestId,
        });
      }
      if (preparedInput.kind === "fixed_reply") {
        return json({
          action: "send",
          reply: preparedInput.reply,
          reason: preparedInput.reason,
          request_id: requestId,
        });
      }
      const messages = preparedInput.messages;
      const activePersonaId = String(tokenRow.active_persona_id || "female");
      const agentRuleState = await loadAgentRuleState(env.DB, activePersonaId);

      const rate = await enforceChatRateLimit(
        env.DB,
        tokenRow.token,
        Math.max(1, Number(env.CHAT_RATE_LIMIT_PER_MINUTE || 30))
      );
      if (!rate.allowed) return json({ error: "请求过于频繁", retry_after_seconds: 60 }, 429);
      const deviceSettings = await loadDeviceSettings(env.DB, tokenRow.token);
      // Borrow xiniuzi: manual takeover + AI duty hours gate the model call (global behavior, same for both models)
      try {
        const conv = await env.DB.prepare("SELECT mode FROM conversation_stats WHERE token = ? AND platform = ? AND contact_id = ?").bind(tokenRow.token, platform, contact_id).first();
        if (conv && String(conv.mode || "") === "manual") {
          await env.DB.prepare("UPDATE conversation_stats SET waiting_since = CASE WHEN waiting_since = 0 THEN ? ELSE waiting_since END, updated_at = ? WHERE token = ? AND platform = ? AND contact_id = ?").bind(Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000), tokenRow.token, platform, contact_id).run();
          return json({ action: "skip", reason: "human_takeover_active", request_id: requestId });
        }
      } catch (_) { /* missing columns before migration: fail open */ }
      if (!isWithinAiHours(deviceSettings)) {
        return json({ action: "skip", reason: "outside_ai_hours", request_id: requestId });
      }
      const chatStartedAt = Date.now();
      const timing = {
        // 2026-10-07：总耗时对不上（total 减去各段还剩约 1 秒），补几段把空档定位出来。
        setup_ms: 0,
        pipeline_ms: 0,
        postllm_ms: 0,
        persist_ms: 0,
        persona_ms: 0,
        context_ms: 0,
        media_intent_ms: 0,
        llm_ms: 0,
        main_llm_ms: 0,
        repair_ms: 0,
        total_ms: 0,
        repair_attempted: false,
        repair_timeout: false,
        llm_budget_ms: resolveChatLlmTimeoutMs(env),
      };
      // Input shape is validated before duplicate/rate/budget checks above.

      // whitelist check
      const contact = await env.DB.prepare("SELECT is_whitelisted, marital_status, marital_checked, voice_warn_at, his_photo_at, her_photo_at, last_activity, last_activity_at, last_reply_at, relationship_stage, mood, conversation_summary, summary_updated_at FROM contacts WHERE token = ? AND platform = ? AND contact_id = ?").bind(tokenRow.token, platform, contact_id).first();
      if (!contact) {
        const nowSec2 = Math.floor(Date.now() / 1000);
        await env.DB.prepare("INSERT INTO contacts (token, platform, contact_id, contact_name, is_whitelisted, notes, created_at) VALUES (?, ?, ?, ?, 1, '', ?)").bind(tokenRow.token, platform, contact_id, contact_name, nowSec2).run();
      } else if (contact.is_whitelisted === 0) {
        return json({ action: "skip" });
      }

      // 2026-10-12 动作静默守门员：洗漱中（20分钟内）或当晚入睡后，接口直接静默跳过回复，防已读不回与秒回穿帮
      const nowSecForActivity = Math.floor(Date.now() / 1000);
      const chinaHour = Number(String(getChinaTimeContext().currentDatetime || "").match(/(\d{1,2}):\d{2}/)?.[1] || new Date().getHours());
      const activityEval = evaluateActivityState(
        contact?.last_activity,
        contact?.last_activity_at,
        nowSecForActivity,
        chinaHour,
      );
      if (activityEval.isSilenced) {
        return json({
          action: "skip",
          reason: activityEval.silenceReason || "activity_in_progress",
          activity: contact?.last_activity,
        });
      }
      if (activityEval.shouldClear && contact?.last_activity) {
        await env.DB.prepare(
          "UPDATE contacts SET last_activity = '', last_activity_at = 0 WHERE token = ? AND platform = ? AND contact_id = ?"
        ).bind(tokenRow.token, platform, contact_id).run();
      }

      // 2026-10-07 用户要求：确认对方已婚就不再回复这个人（直接跳过，连模型都不调）。
      // 2026-10-07 用户要求（原话）：别人答了已婚就不跟他聊，单身或离异可以聊；
      // 婚况放客户资料表里，不要每轮去搜、也不要用提示词白烧 token。
      // 所以：已婚 → 直接不回；判过（marital_checked=1）→ 一个字都不查；
      // 只有从没判过时，才回捞一次历史（一辈子最多一次），判到就写进客户资料表。
      const storedMarital = String(contact?.marital_status || "");
      let maritalSeen = detectContactMaritalStatus(messages);
      if (!storedMarital && Number(contact?.marital_checked || 0) === 0) {
        const maritalRows = await env.DB.prepare(
          "SELECT content FROM chat_history WHERE token = ? AND platform = ? AND contact_id = ? AND role = 'user' " +
          "AND (content LIKE '%单身%' OR content LIKE '%未婚%' OR content LIKE '%没结婚%' OR content LIKE '%结婚%' " +
          "OR content LIKE '%已婚%' OR content LIKE '%老婆%' OR content LIKE '%媳妇%' OR content LIKE '%离异%' " +
          "OR content LIKE '%离过婚%') ORDER BY id DESC LIMIT 200"
        ).bind(tokenRow.token, platform, contact_id).all();
        maritalSeen = detectContactMaritalStatus([
          ...((maritalRows?.results || []).map((row) => ({ role: "user", content: String(row.content || "") }))),
          ...(Array.isArray(messages) ? messages : []),
        ]) || maritalSeen;
        // 2026-10-07 修洞：原来这里只 UPDATE，如果档案表里还没有这个联系人的行，
        // 这条 UPDATE 就一行都没写到 → 标记没写上 → 下一轮又把他的历史翻一遍（白烧）。
        // 改成“有就更新、没有就插入”，保证标记一定写上。
        const marked = await env.DB.prepare(
          "UPDATE contacts SET marital_checked = 1 WHERE token = ? AND platform = ? AND contact_id = ?"
        ).bind(tokenRow.token, platform, contact_id).run();
        const changes = Number(marked && (marked.meta ? marked.meta.changes : marked.changes));
        if (Number.isFinite(changes) && changes === 0) {
          await env.DB.prepare(
            "INSERT INTO contacts (token, platform, contact_id, contact_name, created_at, marital_checked) VALUES (?, ?, ?, ?, ?, 1)"
          ).bind(tokenRow.token, platform, contact_id, String(contactName || contact_id || ""), Math.floor(Date.now() / 1000)).run();
        }
      }
      if (
        agentRuleState.isEnabled("married_excluded", true) &&
        (storedMarital === "married" || maritalSeen === "married")
      ) {
        if (storedMarital !== "married") {
          await env.DB.prepare(
            "UPDATE contacts SET marital_status = 'married' WHERE token = ? AND platform = ? AND contact_id = ?"
          ).bind(tokenRow.token, platform, contact_id).run();
        }
        return json({ action: "skip", reason: "contact_married" });
      }
      // 问到单身就记下来，之后不用再问。
      if (!storedMarital && maritalSeen === "single") {
        await env.DB.prepare(
          "UPDATE contacts SET marital_status = 'single' WHERE token = ? AND platform = ? AND contact_id = ?"
        ).bind(tokenRow.token, platform, contact_id).run();
      }

      // 2026-10-07 用户要求：对方偶尔发一两条语音/表情 → 用转写正常聊；
      // 发得多/发得长/一连串刷 → 先警告一次；警告后还刷 → 停回这个联系人。
      const recentForPressure = await env.DB.prepare(
        "SELECT role, content, transcript, voice_seconds FROM chat_history WHERE token = ? AND platform = ? AND contact_id = ? ORDER BY id DESC LIMIT 10"
      ).bind(tokenRow.token, platform, contact_id).all();
      const pressure = voiceStickerPressure(recentForPressure?.results || [], messages);
      if (pressure.level === "warn") {
        const warnedAt = Number(contact?.voice_warn_at || 0);
        const nowSec3 = Math.floor(Date.now() / 1000);
        if (!warnedAt || nowSec3 - warnedAt > 24 * 3600) {
          await env.DB.prepare(
            "UPDATE contacts SET voice_warn_at = ? WHERE token = ? AND platform = ? AND contact_id = ?"
          ).bind(nowSec3, tokenRow.token, platform, contact_id).run();
          return json({
            action: "send",
            reply: voiceSpamLine(nowSec3 + pressure.voiceCount + pressure.stickerCount),
            reason: "voice_sticker_warning",
            pressure,
          });
        }
        // 警告过了还继续刷：停回他（不拉黑账号，只不再自动回；看板上可改回）。
        await env.DB.prepare(
          "UPDATE contacts SET is_whitelisted = 0 WHERE token = ? AND platform = ? AND contact_id = ?"
        ).bind(tokenRow.token, platform, contact_id).run();
        return json({ action: "skip", reason: "voice_sticker_muted", pressure });
      }

      const personaStartedAt = Date.now();
      // 联系人查询 + 婚否判断这一段（模型调用之前）。
      timing.setup_ms = personaStartedAt - chatStartedAt;
      // 2026-10-07（提速）：这四个查询互不依赖，原来一个接一个等（每个约 100ms）。
      // 现在并发发出；返回值和使用方式都不变。
      const [existingPending, currentLink, activePersona, effectivePersona] = await Promise.all([
        env.DB.prepare(
          "SELECT id, content, status, action_type, media_group_id, media_asset_id, persona_id, persona_version FROM pending_replies WHERE token = ? AND request_id = ? LIMIT 1"
        ).bind(tokenRow.token, requestId).first(),
        env.DB.prepare(
          "SELECT group_id FROM contact_links WHERE token = ? AND platform = ? AND contact_id = ?"
        ).bind(tokenRow.token, platform, contact_id).first(),
        env.DB.prepare(
          "SELECT id, system_prompt FROM personas WHERE id = ? LIMIT 1"
        ).bind(activePersonaId).first(),
        loadEffectivePersonaFacts(env.DB, tokenRow.token, activePersonaId),
      ]);
      // 智能抽屉：按需读取素材，不聊不带，省 token 且更像真人
      const personaDrawers = effectivePersonaDrawers(
        activePersonaId,
        await env.KV.get(`persona:drawers:${activePersonaId}`, "json"),
      );
      timing.persona_ms = Date.now() - personaStartedAt;
      const personaPrompt = normalizeLateReplyPersonaPrompt(
        activePersona?.system_prompt || "\u4f60\u662f\u4e00\u4e2a\u53cb\u597d\u7684\u804a\u5929\u52a9\u624b\u3002",
      );
      const effectivePersonaFacts = effectivePersona.facts;
      const personaVersion = effectivePersona.version;
      const effectiveAge = resolvePersonaAge(effectivePersonaFacts);
      if (existingPending) {
        const stalePersona = String(existingPending.persona_id || "") !== activePersonaId ||
          Number(existingPending.persona_version || 0) !== personaVersion;
        const staleStatus = existingPending.status === "superseded" || existingPending.status === "expired";
        if (stalePersona || staleStatus) {
          await env.DB.prepare(
            "UPDATE pending_replies SET status = 'superseded' WHERE id = ? AND token = ?"
          ).bind(existingPending.id, tokenRow.token).run();
        } else {
          const existingMedia = existingPending.action_type === "image" && existingPending.media_asset_id
            ? await env.DB.prepare("SELECT id, group_id, file_name, content_type FROM media_assets WHERE id = ? LIMIT 1").bind(existingPending.media_asset_id).first()
            : null;
          const existingPayload = buildMediaPayload(existingMedia);
          return json({
            action: existingPending.status === "confirmed" ? "skip" : (existingPayload ? "send_media" : "send"),
            reply: existingPending.content,
            reply_id: existingPending.id,
            media: existingPayload || undefined,
            status: existingPending.status,
            persona_id: activePersonaId,
            persona_version: personaVersion,
          });
        }
      }
      const xingmuPersona = isXingmuPersonaScope(activePersonaId, personaPrompt);
      const starSoulScope = xingmuPersona;
      const activePersonaScope = resolvePersonaScope({
        personaId: activePersonaId,
        personaPrompt,
        xingmuSoulScope: starSoulScope,
      });
      const funnelNowSec = Math.floor(Date.now() / 1000);
      const funnelGroupId = currentLink?.group_id || makeSingleGroupId(tokenRow.token, platform, contact_id);
      let funnelState = starSoulScope
        ? await loadFunnelState(env.DB, tokenRow.token, funnelGroupId, funnelNowSec)
        : emptyFunnelState();
      let funnelAdvancedThisRequest = false;
      if (starSoulScope && funnelState.lastRequestId !== requestId) {
        const funnelTurn = applyFunnelTurn({
          state: funnelState,
          messages,
          platform,
          requestId,
          countTurn: true,
          allowAdvance: true,
          nowSec: funnelNowSec,
        });
        funnelState = funnelTurn.state;
        funnelAdvancedThisRequest = funnelTurn.advanced;
        await persistFunnelState(env.DB, tokenRow.token, funnelGroupId, funnelState);
      }

      let scopedMediaGroups = [];
      // 2026-10-06：关键词命中的图片组不再直接发（那样没有“欲拒还迎”那句话），
      // 先让模型说一句再由主流程发；模型没给图片指令时用这个兜底。
      let keywordMediaGroup = "";
      const recentUserTexts = messages
        .filter((message) => message?.role === "user")
        .map((message) => String(message?.content || "").trim())
        .filter(Boolean)
        .slice(-3);
      if (hostingMode === "full_auto") {
        scopedMediaGroups = await loadScopedMediaGroups(env.DB, activePersonaId, platform);
        {
          // Keyword matching runs for every persona. It used to be skipped for
          // the star-soul persona, which then depended on the model emitting a
          // [[SEND_MEDIA]] marker: the same "发一张日常照呗" that matched the
          // keyword list was quietly refused there.
          const incomingMediaText = latestIncomingText(messages);
          const mediaMatch = isRealtimeImageRequest(incomingMediaText)
            ? null
            : findMatchingMediaGroup(scopedMediaGroups || [], incomingMediaText);
          const resolvedMediaGroup = mediaMatch && !isIntimateTopic(incomingMediaText)
            ? resolveMediaGroupForDirective(scopedMediaGroups, mediaMatch.group.id, recentUserTexts)
            : null;
          if (resolvedMediaGroup) {
            keywordMediaGroup = resolvedMediaGroup;
            const nowSec = Math.floor(Date.now() / 1000);
            const staged = await stageScopedMediaReply({
              db: env.DB,
              token: tokenRow.token,
              personaId: activePersonaId,
              personaVersion,
              platform,
              contactId: contact_id,
              contactName: contact_name,
              requestId,
              group: resolvedMediaGroup,
              createdAt: nowSec,
            });
            if (staged) {
              await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?")
                .bind(nowSec, tokenRow.token).run();
              const teaser = starSoulScope
                ? ""
                : mediaTeaserLine(requestId + "|" + contact_id);
              return json({
                action: "send_media",
                media: {
                  ...staged.mediaPayload,
                  asset_id: staged.pending.media_asset_id || staged.mediaPayload.asset_id,
                  group_id: staged.pending.media_group_id || staged.mediaPayload.group_id,
                },
                // 2026-10-06 用户要求：正常要照片要“欲拒还迎地给”——先说一句再发图。
                ...(teaser ? { reply: teaser } : {}),
                reply_id: staged.pending.id,
                status: "pending",
                local: true,
              });
            }
          }
        }
      }

      const recentAssistantReplies = await loadRecentAssistantReplies(
        env.DB,
        tokenRow.token,
        platform,
        contact_id,
        activePersonaId,
      );
      const incomingForLocalReply = latestIncomingText(messages);
      const localVoice = agentRuleState.isEnabled("voice_call_boundary", true)
        ? localVoiceReply(messages, recentAssistantReplies)
        : "";
      if (localVoice) {
        return respondWithImmediateReply({
          env,
          tokenRow,
          requestId,
          platform,
          contactId: contact_id,
          contactName: contact_name,
          personaId: activePersonaId,
          personaVersion,
          personaScope: activePersonaScope,
          incomingText: latestIncomingText(messages),
          skipLengthCap: true,
          skipPresentation: true,
          decision: createImmediateReplyDecision(
            "local_voice",
            "voice_call_request",
            localVoice,
          ),
        });
      }

      const localExcludedReply = starSoulScope &&
        agentRuleState.isEnabled("business_scope", true)
        ? localExcludedRecycleReply(messages)
        : "";
      const localReply = avoidRepeatedAssistantReply(
        localExcludedReply,
        recentAssistantReplies,
        incomingForLocalReply,
        funnelNowSec,
        "这些不收，只收带屏幕、带电池、带电路的旧数码。",
      );
      if (localReply) {
        return respondWithImmediateReply({
          env,
          tokenRow,
          requestId,
          platform,
          contactId: contact_id,
          contactName: contact_name,
          personaId: activePersonaId,
          personaVersion,
          personaScope: activePersonaScope,
          incomingText: latestIncomingText(messages),
          decision: createImmediateReplyDecision(
            "local_recycle",
            "excluded_recycle_item",
            localReply,
          ),
        });
      }

      const localAge = (agentRuleState.isEnabled("fixed_age", true) ||
        agentRuleState.isEnabled("children_facts", true))
        ? localAgeReply(
        messages,
        personaPrompt,
        recentAssistantReplies,
        funnelNowSec,
        effectiveAge || 0,
        effectivePersonaFacts,
        )
        : "";
      if (localAge) {
        return respondWithImmediateReply({
          env,
          tokenRow,
          requestId,
          platform,
          contactId: contact_id,
          contactName: contact_name,
          personaId: activePersonaId,
          personaVersion,
          personaScope: activePersonaScope,
          incomingText: latestIncomingText(messages),
          decision: createImmediateReplyDecision(
            "local_age",
            "self_age_question",
            localAge,
          ),
        });
      }

      // history
      const budget = await enforceTokenBudget(env.DB, tokenRow);
      if (!budget.allowed) return json({
        error: "本月模型额度已用完",
        spent: budget.spent,
        monthly_limit: budget.limit,
      }, 429);

      const contextStartedAt = Date.now();
      const MAX_MSGS = 60;   // 2026-10-07：10 条太少，几十分钟前说过的关键话直接看不见（真机：他答过的“单身”被截掉，导致她问了三遍）
      // Only MAX_MSGS rows reach the model; the rest of the window exists to
      // survive persona filtering and de-duplication. Fetching 90 rows per
      // request helped burn the D1 daily read budget (free tier: 5M rows/day).
      const HISTORY_FETCH_BUFFER = 20;
      let historyStatement;
      let historyAliases = [{ platform, contact_id }];
      const crossPlatformMemoryEnabled = agentRuleState.isEnabled("cross_platform_memory", true);
      if (crossPlatformMemoryEnabled && currentLink?.group_id) {
        const { results: linkedAliases } = await env.DB.prepare(
          "SELECT platform, contact_id FROM contact_links WHERE token = ? AND group_id = ?"
        ).bind(tokenRow.token, currentLink.group_id).all();
        const aliases = linkedAliases?.length ? linkedAliases : [{ platform, contact_id }];
        if (aliases.length) historyAliases = aliases;
        const clauses = aliases.map(() => "(platform = ? AND contact_id = ?)");
        historyStatement = env.DB.prepare(
          "SELECT id, platform, role, content, created_at, source, persona_id, persona_version, time_kind FROM chat_history WHERE token = ? AND (" + clauses.join(" OR ") + ") AND (role = 'user' OR source = 'human_phone' OR (role = 'assistant' AND persona_id = ?)) ORDER BY created_at DESC, id DESC LIMIT ?"
        ).bind(
          tokenRow.token,
          ...aliases.flatMap((alias) => [alias.platform, alias.contact_id]),
          activePersonaId,
          MAX_MSGS + HISTORY_FETCH_BUFFER,
        );
      } else {
        historyStatement = env.DB.prepare(
          "SELECT id, platform, role, content, created_at, source, persona_id, persona_version, time_kind FROM chat_history WHERE token = ? AND platform = ? AND contact_id = ? AND (role = 'user' OR source = 'human_phone' OR (role = 'assistant' AND persona_id = ?)) ORDER BY created_at DESC, id DESC LIMIT ?"
        ).bind(tokenRow.token, platform, contact_id, activePersonaId, MAX_MSGS + HISTORY_FETCH_BUFFER);
      }
      const profileGroupId = funnelGroupId;
      // 2026-10-07（提速）：这四个加载互不依赖，原来串行执行要等 0.9 秒左右，
      // 现在并发发出。返回值和原来完全一样，只是少等几趟网络。
      const [memoryRow, foreignPersonaTerms, customerProfile, historyResult] = await Promise.all([
        loadMemorySummary(env.DB, tokenRow.token, currentLink?.group_id || "", historyAliases),
        // 别人设的专属词条：用来把历史里残留的旧人设话术挡在提示词外面（真机见过聊天记录里躺着“做二手手机和旧数码回收的”）。
        agentRuleState.isEnabled("old_persona_filter", true)
          ? loadForeignIdentityTerms(env.DB, activePersonaId)
          : Promise.resolve([]),
        loadCustomerProfile(env.DB, tokenRow.token, profileGroupId),
        historyStatement.all(),
      ]);
      const allMsgs = historyResult?.results;
      const allMessages = (allMsgs || []).reverse();
      const recentHistory = allMessages.length <= MAX_MSGS ? allMessages : allMessages.slice(allMessages.length - MAX_MSGS);
      const dedupedHistory = agentRuleState.isEnabled("duplicate_history", true)
        ? dedupeHistoryAgainstCurrent(recentHistory, messages)
        : recentHistory;
      const historyMessages = dedupedHistory
        .filter((message) =>
          !(message?.role === "assistant" &&
            foreignPersonaTerms.some((term) => String(message?.content || "").includes(term)))
        )
        .filter((message) =>
          !(message?.role === "user" && isPlatformNoticeContent(message?.content, programRules))
        );
      const recentMediaContext = [...historyMessages, ...messages]
        .filter((message) => message?.role === "user")
        .map((message) => String(message?.content || "").trim())
        .filter(Boolean)
        .slice(-6);
      const olderMessages = agentRuleState.isEnabled("summary_budget", true)
        ? allMessages.slice(0, Math.max(0, allMessages.length - MAX_MSGS))
          .filter((message) => Number(message.id || 0) > memoryRow.summarizedUpToId)
        : [];
      const summary = mergeMemorySummary(memoryRow.summary, olderMessages);
      const summarizedUpToId = olderMessages.reduce((max, message) => Math.max(max, Number(message.id || 0)), memoryRow.summarizedUpToId);
      if (olderMessages.length > 0) {
        await persistMemorySummary(env.DB, tokenRow.token, currentLink?.group_id || "", historyAliases, summary, summarizedUpToId);
        await env.DB.prepare(
          "UPDATE contacts SET conversation_summary = ?, summary_updated_at = ? WHERE token = ? AND platform = ? AND contact_id = ?"
        ).bind(summary.slice(0, 300), Math.floor(Date.now() / 1000), tokenRow.token, platform, contact_id).run();
      }
      if (starSoulScope) {
        const funnelTurn = applyFunnelTurn({
          state: funnelState,
          historyMessages,
          messages,
          platform,
          requestId,
          countTurn: false,
          allowAdvance: !funnelAdvancedThisRequest,
          nowSec: funnelNowSec,
        });
        if (funnelTurn.advanced || JSON.stringify(funnelTurn.state.evidence) !== JSON.stringify(funnelState.evidence)) {
          funnelState = funnelTurn.state;
          await persistFunnelState(env.DB, tokenRow.token, funnelGroupId, funnelState);
        } else {
          funnelState = funnelTurn.state;
        }
      }

      // weather
      const homeCity = effectivePersonaFacts.current_city || location?.home?.city || "\u91cd\u5e86";
      const weather = deviceSettings.weather_enabled
        ? await getWeather(homeCity, env.KV, env.WEATHER_API_KEY || "")
        : null;

      const chinaTimeForGating = getChinaTimeContext();
      const matchHour = String(chinaTimeForGating.currentDatetime || "").match(/(\d{1,2}):(\d{2})/);
      const currentHour = matchHour ? Number(matchHour[1]) : new Date().getHours();
      const latestText = latestIncomingText(messages);
      const isFrag = isFragmentedMessage(latestText);

      const matchedDrawerTips = matchActiveDrawers(
        personaDrawers,
        latestText,
        {
          ...(agentRuleState.isEnabled("drawer_budget", true)
            ? {}
            : { maxKeywordCards: Number.MAX_SAFE_INTEGER, maxChars: Number.MAX_SAFE_INTEGER }),
          currentHour,
          weatherCondition: weather?.condition,
          weatherTemp: weather?.temp,
          isFragmented: isFrag,
        },
      );
      const matchedKnowledgeCardIds = matchedDrawerTips
        .map((tip) => String(tip).match(/【id:([^】]+)】/u)?.[1] || "")
        .filter(Boolean);



      // model config
      const modelConfig = await loadLlmConfig(env.KV, env, deviceSettings.model_line);
      const modelName = modelConfig.modelName;
      // 2026-10-08：备用模型（Gemini）用的是另一把钥匙；没开备用时行为和以前一模一样。
      const apiKey = (modelConfig && modelConfig.apiKeyOverride) || env.DEEPSEEK_API_KEY || "";
      const llmDeadlineAt = chatStartedAt + timing.llm_budget_ms;

      // system prompt
      const now2 = new Date();
      const chinaTime = getChinaTimeContext(now2);
      const currentDatetime = chinaTime.currentDatetime;
      const weekday = chinaTime.weekday;
      const nowSec2 = Math.floor(Date.now() / 1000);
      const activity = await loadActivityStats(env.DB, tokenRow.token, historyAliases, nowSec2);
      const stage = starSoulScope ? funnelState.stage : 1;
      const stageText = starSoulScope
        ? funnelStageText(stage, funnelState.completed)
        : "你们可以从当前话题自然延续，保持已有的熟悉度，不假装很熟。";
      const profileContext = customerProfilePrompt(customerProfile.profile);
      const messageDelay = deviceSettings.time_enabled
        ? resolveIncomingDelayPolicy(messages, historyMessages, nowSec2)
        : null;
      const evaluationQuoteSent = funnelState.evaluationQuoteSent ||
        hasEvaluationQuote(historyMessages, messages, summary);
      if (starSoulScope && !evaluationQuoteSent) {
        const pendingEvaluation = await loadPendingEvaluationQuote(
          env.DB,
          tokenRow.token,
          platform,
          contact_id,
          nowSec2,
          activePersonaId,
          personaVersion,
        );
        const pendingTopicMatches = isXingmuEvaluationTopic(latestIncomingText(messages));
        if (
          pendingEvaluation &&
          stage >= 6 &&
          funnelState.evidence.willingToRecycle === true &&
          !funnelState.completed &&
          pendingTopicMatches
        ) {
          return respondWithImmediateReply({
            env,
            tokenRow,
            requestId,
            platform,
            contactId: contact_id,
            contactName: contact_name,
            personaId: activePersonaId,
            personaVersion,
            personaScope: activePersonaScope,
            incomingText: latestIncomingText(messages),
            decision: createImmediateReplyDecision(
              "pending_evaluation",
              "existing_evaluation_reply",
              pendingEvaluation.content,
              { funnel_stage: stage },
              pendingEvaluation.id,
            ),
          });
        }
      }
      const evaluationReply = starSoulScope
        ? resolveXingmuEvaluationReply({
            stage,
            incomingText: latestIncomingText(messages),
            historyMessages,
            messages,
            quoteAlreadySent: evaluationQuoteSent,
            willingToRecycle: funnelState.evidence.willingToRecycle === true,
            completed: funnelState.completed,
          })
        : "";
      if (evaluationReply) {
        return respondWithImmediateReply({
          env,
          tokenRow,
          requestId,
          platform,
          contactId: contact_id,
          contactName: contact_name,
          personaId: activePersonaId,
          personaVersion,
          personaScope: activePersonaScope,
          incomingText: latestIncomingText(messages),
          decision: createImmediateReplyDecision(
            "evaluation_rule",
            "evaluation_topic_reached",
            evaluationReply,
            { funnel_stage: stage },
          ),
        });
      }
      const contactConfig = resolveContactConfig(
        env,
        starSoulScope,
        effectivePersonaFacts,
        effectivePersona.hasOverride,
        activePersonaScope === "sutang",
      );
      const contactPolicy = resolveContactRequestPolicy({
        requestCount: countContactRequests(historyMessages, messages),
        stage,
        activity,
        incomingText: latestIncomingText(messages),
        historyMessages,
        messages,
        contactChannel: contactConfig.channel,
        contactAccount: contactConfig.account,
        xingmuScope: starSoulScope,
        sutangScope: activePersonaScope === "sutang",
        dealCompleted: funnelState.evidence.dealCompleted === true,
        acceptedBusinessTopic: funnelState.evidence.acceptedBusinessTopic === true,
        willingToRecycle: funnelState.evidence.willingToRecycle === true,
      });
      const currentContactRequest = messages.some((message) =>
        message?.role === "user" && isContactRequest(message?.content)
      );
      const contactRulesEnabled = agentRuleState.isEnabled("no_contact_leak", true) ||
        agentRuleState.isEnabled("business_contact_boundary", true);
      const contactReply = contactRulesEnabled && currentContactRequest
        ? avoidRepeatedAssistantReply(
            contactPolicy.reply,
            [...historyMessages, ...recentAssistantReplies],
            latestIncomingText(messages),
            nowSec2,
            contactConfig.channel === "douban"
              ? "豆瓣号已经给过你了，往上翻一下哈，加的时候说下你是谁"
              : contactConfig.channel === "qq"
                ? "QQ号已经给过你了，往上翻一下哈，加的时候说下你是谁"
                : "私人微信已经给过你了，往上翻一下哈，加的时候说下你是谁",
          )
        : "";
      if (contactReply) {
        return respondWithImmediateReply({
          env,
          tokenRow,
          requestId,
          platform,
          contactId: contact_id,
          contactName: contact_name,
          personaId: activePersonaId,
          personaVersion,
          personaScope: activePersonaScope,
          incomingText: latestIncomingText(messages),
          skipLengthCap: true,
          skipPresentation: true,
          decision: createImmediateReplyDecision(
            "contact_policy",
            "contact_request_matched",
            contactReply,
            { contact_gate: contactPolicy.allowed ? "allowed" : "blocked" },
          ),
        });
      }

            // 2026-10-07 用户要求（第②步）：他发过照片就永久记住——写在他档案上，清掉聊天记录也不丢。
      // 只写档案，不影响她怎么回；万一写失败也只是没记住，不连累回话。
      try {
        const photoStamp = Math.floor(Date.now() / 1000);
        if (
          agentRuleState.isEnabled("his_photo_memory", true) &&
          heHasSentPhoto(messages, historyMessages)
        ) {
          await env.DB.prepare(
            "UPDATE contacts SET his_photo_at = ? WHERE token = ? AND platform = ? AND contact_id = ? AND his_photo_at = 0"
          ).bind(photoStamp, token, platform, String(contactId || contactName || "")).run();
        }
        if (
          agentRuleState.isEnabled("her_photo_memory", true) &&
          sheHasSentPhoto(messages, historyMessages)
        ) {
          await env.DB.prepare(
            "UPDATE contacts SET her_photo_at = ? WHERE token = ? AND platform = ? AND contact_id = ? AND her_photo_at = 0"
          ).bind(photoStamp, token, platform, String(contactId || contactName || "")).run();
        }
      } catch (photoStampError) {
        console.log(JSON.stringify({ event: "photo_stamp_failed", error: String(photoStampError) }));
      }
      const mediaActionsEnabled = hostingMode === "full_auto" &&
        scopedMediaGroups.length > 0 &&
        agentRuleState.isEnabled("photo_only_explicit", true) &&
        agentRuleState.isEnabled("media_group_selection", true);
      let classifiedPhotoIntent = null;
      if (mediaActionsEnabled && shouldClassifyPersonalPhotoIntent(recentMediaContext)) {
        const mediaIntentStartedAt = Date.now();
        const mediaIntent = await classifyPersonalPhotoIntent({
          env,
          token: tokenRow.token,
          apiKey,
          modelConfig,
          modelName,
          recentUserTexts: recentMediaContext,
          deadlineAt: llmDeadlineAt,
        });
        classifiedPhotoIntent = mediaIntent;
        timing.media_intent_ms = elapsedSince(mediaIntentStartedAt);
        const incomingMediaText = latestIncomingText(messages);
        const resolvedMediaGroup = mediaIntent !== "none" &&
          !isRealtimeImageRequest(incomingMediaText) &&
          // 2026-10-06 用户要求：正常的“想看你长什么样/看看身材照”要放开给，
          // 只有私密、裸照、视频这类露骨请求才拦。
          !isExplicitPrivateMediaRequest(incomingMediaText) &&
          !hasNonPersonalMediaContext(recentMediaContext)
          ? resolveMediaGroupForDirective(scopedMediaGroups, mediaIntent, recentMediaContext)
          : null;
        if (resolvedMediaGroup) {
          const nowSec = Math.floor(Date.now() / 1000);
          const staged = await stageScopedMediaReply({
            db: env.DB,
            token: tokenRow.token,
            personaId: activePersonaId,
            personaVersion,
            platform,
            contactId: contact_id,
            contactName: contact_name,
            requestId,
            group: resolvedMediaGroup,
            createdAt: nowSec,
          });
          if (staged) {
            await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?")
              .bind(nowSec, tokenRow.token).run();
            timing.total_ms = Date.now() - chatStartedAt;
            console.log("chat_timing", JSON.stringify({ request_id: requestId, token: tokenRow.token.slice(-6), platform, timing }));
            return json({
              action: "send_media",
              media: {
                ...staged.mediaPayload,
                asset_id: staged.pending.media_asset_id || staged.mediaPayload.asset_id,
                group_id: staged.pending.media_group_id || staged.mediaPayload.group_id,
              },
              reply_id: staged.pending.id,
              status: "pending",
              request_id: requestId,
              persona_id: activePersonaId,
              persona_version: personaVersion,
              model_line: deviceSettings.model_line || (isGeminiModelConfig(modelConfig) ? "b" : "a"),
              model_name: modelName,
              timing,
            });
          }
        }
      }
      const currentExchanges = (Array.isArray(messages) ? messages.length : 0) + (Array.isArray(historyMessages) ? historyMessages.length : 0);
      const temporalContextPrompt = buildTemporalContextPrompt({
        contact,
        nowSec: nowSecForActivity,
        activityEvaluation: activityEval,
        totalExchanges: currentExchanges,
      });
      const layeredPromptOptions = {
        temporalContextPrompt,
        personaId: activePersonaId,
        personaPrompt,
        // 2026-10-07 用户要求：还不知道对方是否单身时，找机会自然问一句。
        contactMaritalStatus: storedMarital || maritalSeen,
        // 2026-10-07 第③步：先看档案里的永久记录（清掉聊天记录也不丢），再看聊天记录。
        hisPhotoOnFile: Number(contact?.his_photo_at || 0) > 0,
        herPhotoOnFile: Number(contact?.her_photo_at || 0) > 0,
        personaFacts: effectivePersonaFacts,
        platform,
        profileContext,
        currentDatetime,
        weekday,
        homeLocation: {
          city: effectivePersonaFacts.current_city || location?.home?.city || "重庆",
          district: effectivePersonaFacts.current_district || location?.home?.district || "两江新区",
        },
        workLocation: {
          city: effectivePersonaFacts.work_city || location?.work?.city || "重庆",
          district: effectivePersonaFacts.work_district || location?.work?.district || "两江新区",
        },
        weather,
        weatherEnabled: deviceSettings.weather_enabled,
        timeEnabled: deviceSettings.time_enabled,
        stageText,
        relationStageLevel: stage,
        messageDelay,
        messages,
        historyMessages,
        conversationTimeline,
        conversationStage,
        relationshipOrigin,
        memorySummary: String(contact?.conversation_summary || summary || "").trim(),
        evaluationQuoteSent,
        funnelState,
        contactRequest: starSoulScope && currentContactRequest && !contactPolicy.allowed,
        xingmuSoulScope: starSoulScope,
        mediaGroups: scopedMediaGroups,
        mediaActionsEnabled,
        selfNickname,
        matchedDrawerTips,
        programRules,
        agentRuleState,
      };
      const systemPrompt = buildLayeredSystemPrompt(layeredPromptOptions);
      timing.context_ms = Date.now() - contextStartedAt;
      const activeStickerMeanings = programRules.sticker.enabled
        ? programRules.sticker.meanings
        : null;

      const buildLlmMessages = (includeHistory = true, prompt = systemPrompt) => {
        const result = [{ role: "system", content: prompt }];
        const nowSecForTranscript = Math.floor(Date.now() / 1000);
        let previousEpoch = 0;
        // 2026-10-07：同一条消息可能既在历史里、又在这次读到的窗口里（真机：
        // “【10/07 04:06】我：大半夜的 你是饿了吧”连着出现两次），既费 token 又让模型以为是两句话。
        // 按「角色 + 内容 + 时刻」去重（同一时刻的另一句仍保留）。
        // 真机里那两条的入库时刻差了 4 分钟（04:43 / 04:47），所以不能只比精确时刻：
        // 同角色 + 同内容 + 5 分钟内，算同一条。
        const seenLines = [];
        const pushLine = (msg, requestMessage) => {
          const epoch = requestMessageEpochSeconds(msg) || 0;
          const content = String(msg.content || "").trim();
          const duplicated = seenLines.some((line) =>
            line.role === msg.role && line.content === content &&
            (epoch === 0 || line.epoch === 0 || Math.abs(line.epoch - epoch) <= 300));
          if (duplicated) {
            // 跳过的虽是重复行，但它的时间仍然是“上一条”，不推进的话下一行会被当成隔了很久。
            previousEpoch = epoch || previousEpoch;
            return;
          }
          seenLines.push({ role: msg.role, content, epoch });
          result.push({
            role: msg.role === "assistant" ? "assistant" : "user",
            content: formatTranscriptLine(
              requestMessage,
              previousEpoch,
              nowSecForTranscript,
              activeStickerMeanings,
            ),
          });
          previousEpoch = epoch || previousEpoch;
        };
        if (includeHistory) {
          for (const msg of historyMessages) {
            pushLine(msg, msg);
          }
        }
        for (const msg of messages) {
          // 2026-10-07（时间可信）：请求里带来的这几条是手机刚读到的，
          // 没标来源时按“读到的时间”算，别当成他真实发送时间。
          const requestMessage = msg?.time_kind ? msg : { ...msg, time_kind: "first_observed" };
          pushLine(msg, requestMessage);
        }
        return result;
      };
      let llmMessages = buildLlmMessages(true);
      const minimalSystemPrompt = () => buildLayeredSystemPrompt({
        ...layeredPromptOptions,
        profileContext: "",
        stageText: "",
        relationStageLevel: 1,
        messageDelay: null,
        historyMessages: [],
        conversationTimeline: "",
        memorySummary: "",
        evaluationQuoteSent: false,
        funnelState: emptyFunnelState(),
        contactRequest: false,
        mediaGroups: [],
        mediaActionsEnabled: false,
      });

      // call the configured chat model
      const generation = replyGenerationSettings(messages, messageDelay, modelConfig);
      // Gemini 3.x 自带推理思考过程，且单次需要更多输出缓冲以防被截断；DeepSeek 保持原样不碰。
      const effectiveLlmMaxTokens = isGeminiModelConfig(modelConfig)
        ? Math.max(generation.maxTokens, 512)
        : generation.maxTokens;
      const requestTemperature = generation.temperature;
      const llmStartedAt = Date.now();
      const llmFetchTimeoutMs = Math.max(1, llmDeadlineAt - Date.now());
      let data;
      let safetyBlockedReply = false;
      try {
        const callLlm = async (outgoingMessages, maxTokens = effectiveLlmMaxTokens) => {
          const response = await fetch(modelConfig.baseUrl + "/chat/completions", {
            method: "POST",
            headers: buildModelHeaders(apiKey, modelConfig),
            body: JSON.stringify(buildModelRequestPayload(
              modelConfig,
              modelName,
              outgoingMessages,
              requestTemperature,
              maxTokens,
            )),
            signal: createTimeoutSignal(llmFetchTimeoutMs),
          });
          if (response.ok) return { response, data: await response.json() };
          const detail = await upstreamErrorDetail(response);
          return { response, data: null, detail };
        };

        const hasVisibleContent = (value) =>
          Boolean(String(value?.choices?.[0]?.message?.content || "").trim());

        // 2026-10-09: Gemini blocks intimate lines at the safety layer (finish "content_filter"
        // or native "SAFETY"). Retrying the same prompt never helps, so detect it, log it once,
        // and fall through to a human-sounding cover line instead of burning a second call.
        const isSafetyBlocked = (value) => {
          const choice = value?.choices?.[0] || {};
          const reason = String(choice.finish_reason || choice.finishReason || "").toUpperCase();
          if (reason === "CONTENT_FILTER" || reason === "SAFETY") return true;
          const ratings = choice.safetyRatings || choice.safety_ratings || [];
          return Array.isArray(ratings) && ratings.some((r) =>
            String(r?.blocked || "").toLowerCase() === "true" ||
            (Number(r?.probabilityScore || r?.probability_score || 0) > 0.85 &&
              !/^(NEGLIGIBLE|LOW)$/iu.test(String(r?.probability || ""))));
        };

        let result = await callLlm(llmMessages);
        if (!result.response.ok) {
          console.error(
            "chat_llm_upstream_failed",
            JSON.stringify({
              request_id: requestId,
              token: tokenRow.token.slice(-6),
              platform,
              contact_id: contact_id.slice(0, 80),
              upstream_status: result.response.status,
              upstream_detail: result.detail,
              phase: "with_history",
              history_messages: historyMessages.length,
              current_messages: messages.length,
            })
          );
          // Retry once with the current batch only. A poisoned long history or
          // summary must not leave a conversation permanently unable to reply.
          llmMessages = buildLlmMessages(false, minimalSystemPrompt());
          result = await callLlm(llmMessages);
          if (!result.response.ok) {
            console.error(
              "chat_llm_upstream_failed",
              JSON.stringify({
                request_id: requestId,
                token: tokenRow.token.slice(-6),
                platform,
                contact_id: contact_id.slice(0, 80),
                upstream_status: result.response.status,
                upstream_detail: result.detail,
                phase: "current_only",
                history_messages: 0,
                current_messages: messages.length,
              })
            );
          }
        }
        // An empty completion usually means the reasoning ate the whole
        // budget. Retry once with a larger allowance before falling back.
        if (result.response.ok && !hasVisibleContent(result.data)) {
          if (isGeminiModelConfig(modelConfig) && isSafetyBlocked(result.data)) {
            safetyBlockedReply = true;
            console.error(
              "chat_safety_block",
              JSON.stringify({
                request_id: requestId,
                token: tokenRow.token.slice(-6),
                platform,
                contact_id: contact_id.slice(0, 80),
                model: modelName,
                finish_reason: result.data?.choices?.[0]?.finish_reason || result.data?.choices?.[0]?.finishReason || "",
                incoming: latestIncomingText(messages).slice(0, 80),
              })
            );
          } else {
          console.error(
            "chat_empty_model_content",
            JSON.stringify({
              request_id: requestId,
              token: tokenRow.token.slice(-6),
              platform,
              contact_id: contact_id.slice(0, 80),
              model: modelName,
              finish_reason: result.data?.choices?.[0]?.finish_reason || "",
              completion_tokens: result.data?.usage?.completion_tokens ?? null,
              reasoning_chars: String(result.data?.choices?.[0]?.message?.reasoning_content || "").length,
            })
          );
            const retryBudget = isGeminiModelConfig(modelConfig)
              ? Math.max(640, generation.maxTokens * 4)
              : Math.max(480, generation.maxTokens * 4);
            const retry = await callLlm(llmMessages, retryBudget);
            if (retry.response.ok) result = retry;
          }
        }
        if (!result.response.ok) {
          timing.main_llm_ms = elapsedSince(llmStartedAt);
          timing.llm_ms = timing.main_llm_ms;
          timing.total_ms = elapsedSince(chatStartedAt);
          console.log("chat_timing", JSON.stringify({ request_id: requestId, token: tokenRow.token.slice(-6), platform, timing }));
          // 2026-10-08：让上游报错的原文也能看见（只加在错误返回里，正常回复不受影响）。
          const upstreamBody = String(result.detail || "").slice(0, 400);
          return json({
            error: "LLM \u8c03\u7528\u5931\u8d25",
            code: "llm_upstream_error",
            upstream_status: result.response.status,
            upstream_body: upstreamBody,
            request_id: requestId,
            timing,
          }, 502);
        }
        data = result.data;
      } catch (error) {
        const timedOut = isAbortError(error);
        timing.main_llm_ms = elapsedSince(llmStartedAt);
        timing.llm_ms = timing.main_llm_ms;
        timing.total_ms = elapsedSince(chatStartedAt);
        console.error(
          "chat_llm_failed",
          JSON.stringify({
            request_id: requestId,
            token: tokenRow.token.slice(-6),
            platform,
            error: error instanceof Error ? error.message : String(error),
            timed_out: timedOut,
            timing,
          })
        );
        return json({
          error: timedOut ? "LLM \u8c03\u7528\u8d85\u65f6" : "LLM \u8c03\u7528\u5931\u8d25",
          code: timedOut ? "llm_timeout" : "llm_fetch_failed",
          request_id: requestId,
          timing,
        }, timedOut ? 504 : 502);
      }
      timing.main_llm_ms = elapsedSince(llmStartedAt);
      timing.llm_ms = timing.main_llm_ms;
      await recordTokenUsage(
        env.DB,
        tokenRow.token,
        estimateLlmCost({
          usage: data.usage,
          inputChars: llmMessages.reduce((total, message) => total + String(message.content || "").length, 0),
          outputChars: String(data.choices?.[0]?.message?.content || "").length,
        }, env, modelConfig)
      );
      const rawModelContent = data.choices?.[0]?.message?.content;
      if (!String(rawModelContent || "").trim()) {
        console.error(
          "chat_empty_model_content",
          JSON.stringify({
            request_id: requestId,
            token: tokenRow.token.slice(-6),
            platform,
            contact_id: contact_id.slice(0, 80),
            model: modelName,
            finish_reason: data.choices?.[0]?.finish_reason || "",
            completion_tokens: data.usage?.completion_tokens ?? null,
            total_tokens: data.usage?.total_tokens ?? null,
            has_reasoning: Boolean(data.choices?.[0]?.message?.reasoning_content),
            reasoning_chars: String(data.choices?.[0]?.message?.reasoning_content || "").length,
          })
        );
      }
            // 2026-10-09: cover line must match the real gap. Saying "just stepped away"
      // when he texted 1 minute ago is an obvious lie, so measure it instead of guessing.
      let safetyCover = "\u6069\u6069\uff0c\u597d\u7684\u3002";
      if (safetyBlockedReply) {
        const nowSec = Math.floor(Date.now() / 1000);
        let lastUserAt = 0;
        for (const m of messages) {
          const at = Number(m?.created_at || 0);
          if (m?.role === "user" && at > lastUserAt) lastUserAt = at;
        }
        const gapSec = lastUserAt > 0 ? nowSec - lastUserAt : 86400;
        safetyCover = gapSec < 300 ? "\u5728\u5462 \u4f60\u8bf4" : "\u5728\u5462 \u521a\u624d\u8d70\u5f00\u4e86\u4e00\u4e0b";
      }
      const modelReply = String(rawModelContent || "").trim() || safetyCover;
      const mediaDirective = mediaActionsEnabled ? parseMediaDirective(modelReply) : "";
      let rawReply = stripMediaDirective(modelReply);
      if (mediaDirective) {
        const incomingMediaText = latestIncomingText(messages);
        // 2026-10-05：原来这里还有一道“分类器说不是要照片就不许发”的否决。
        // 真机实测：同一句“可以看看你照片吗”，分类器偶尔返回 NONE，就把模型已经发出的
        // [[SEND_MEDIA:daily]] 否决掉，最后回一句“照片先不发了，聊聊呗”。
        // 模型看的是完整对话，这里只保留真正需要的边界（现场拍、越界话题、在聊物品）。
        const resolvedMediaGroup = !isRealtimeImageRequest(incomingMediaText) &&
          !isBareLookRequest(incomingMediaText) &&
          // 2026-10-06 用户要求：正常的“想看你长什么样/看看身材照”要放开给，
          // 只有私密、裸照、视频这类露骨请求才拦。
          !isExplicitPrivateMediaRequest(incomingMediaText) &&
          !hasNonPersonalMediaContext(recentMediaContext)
          // 模型写了图片指令就按它；没写但关键词命中了同一个组，也用关键词那组（文字仍用模型这句）。
          ? (parseMediaDirective(modelReply)
              ? resolveMediaGroupForDirective(scopedMediaGroups, mediaDirective, recentMediaContext)
              : (keywordMediaGroup || ""))
          : null;
        if (resolvedMediaGroup) {
          const nowSec = Math.floor(Date.now() / 1000);
          const staged = await stageScopedMediaReply({
            db: env.DB,
            token: tokenRow.token,
            personaId: activePersonaId,
            personaVersion,
            platform,
            contactId: contact_id,
            contactName: contact_name,
            requestId,
            group: resolvedMediaGroup,
            createdAt: nowSec,
          });
          if (staged) {
            await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?")
              .bind(nowSec, tokenRow.token).run();
            timing.total_ms = Date.now() - chatStartedAt;
            console.log("chat_timing", JSON.stringify({ request_id: requestId, token: tokenRow.token.slice(-6), platform, timing }));
            return json({
              action: "send_media",
              media: {
                ...staged.mediaPayload,
                asset_id: staged.pending.media_asset_id || staged.mediaPayload.asset_id,
                group_id: staged.pending.media_group_id || staged.mediaPayload.group_id,
              },
              // 2026-10-06 用户要求：正常要照片要“欲拒还迎地给”——先说一句再发图。
              // 模型写在图片指令前面的那句话放这里，手机端会先发文字再发图。
              ...(rawReply ? { reply: rawReply } : {}),
              reply_id: staged.pending.id,
              status: "pending",
              request_id: requestId,
              timing,
            });
          }
        }
        if (!rawReply) rawReply = mediaDirectiveFallback(incomingMediaText);
      }
      // 2026-10-05：这条原来只对星暮生效，苏棠完全没有——对方说“要睡了”，
      // 她既不会被拦，也没有收尾规则，只能自己憋一句“那你快睡呀 我就是问问”。现在对所有人生效。
      const socialExit = agentRuleState.isEnabled("exit_marker", true)
        ? parseSocialExitInstruction(rawReply)
        : { isExit: false, content: rawReply, cooldownMs: 0 };
      if (socialExit.isExit) {
        const cooldownMs = socialExit.cooldownMs || inferSocialExitCooldownMs(messages);
        await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?").bind(nowSec2, tokenRow.token).run();

        // 2026-10-09: sleep exits get one short caring line instead of silence.
        if (socialExit.exitType === "sleep") {
          const caring = activePersonaId === "female_sutang"
            ? "\u665a\u5b89 \u660e\u5929\u8bb0\u5f97\u6765\u627e\u6211"
            : "\u5feb\u7761\u5427 \u522b\u71ac\u4e86";
          const pending = await loadOrCreatePendingReply(env.DB, {
            token: tokenRow.token,
            requestId,
            platform,
            contactId: contact_id,
            contactName: contact_name,
            content: caring,
            createdAt: nowSec2,
            personaId: activePersonaId,
            personaVersion,
          });
          timing.total_ms = Date.now() - chatStartedAt;
          console.log("chat_timing", JSON.stringify({ request_id: requestId, token: tokenRow.token.slice(-6), platform, timing }));
          console.log("reply_decision_audit", JSON.stringify({
            request_id: requestId,
            token: tokenRow.token.slice(-6),
            platform,
            source: "goodnight_rule",
            reason: "sleep_exit_care",
          }));
          return json({
            action: "send",
            reply: pending.content,
            reply_id: pending.id,
            status: "pending",
            request_id: requestId,
            timing,
            cooldown_ms: cooldownMs,
            persona_id: activePersonaId,
            persona_version: personaVersion,
            model_line: deviceSettings.model_line || (isGeminiModelConfig(modelConfig) ? "b" : "a"),
            model_name: modelName,
            reply_audit: { source: "goodnight_rule", reason: "sleep_exit_care" },
          });
        }
        timing.total_ms = Date.now() - chatStartedAt;
        console.log("chat_timing", JSON.stringify({ request_id: requestId, token: tokenRow.token.slice(-6), platform, timing }));
        return json({
          action: "skip",
          error: "social_exit",
          cooldown_ms: cooldownMs,
          request_id: requestId,
          timing,
        });
      }
      const selfLeave = starSoulScope && agentRuleState.isEnabled("self_leave_marker", true)
        ? extractSelfLeaveInstruction(rawReply)
        : { content: rawReply, cooldownMs: 0 };
      let visibleReply = selfLeave.content;
      // 2026-10-05 决策：所有“发现回复太敷衍/答非所问就再调一次模型重写”的通道全部关掉
      // （边界反馈 / 答非所问 / 把天聊死 / 低信息量 / 通用敷衍）。
      // 原因：二次重写会换掉模型原本的语气和人设，每次还要多花 1-3 秒和一份 token。
      // 现在直接发模型第一次的输出，质量靠提示词（人设 + 时间分档）保证。
      // 需要恢复某一条时，把对应 shouldRepair* 判断重新接回这里即可。
      const incomingText = latestIncomingText(messages);
      const incomingTurnText = currentUserBatchText(messages);
      // 别人设的专属词条：当前人设说出口就是穿帮，直接整句拦掉（前面已经查过，复用）。
      // 2026-10-06：他连着发、她中间没回过 = 她欠他一条回复。
      // 这时她要是说“你没影了/我还等着”就是倒打一耙（真机：请叫我球⚽️ 被用户当场撤回）。
      const owesReply = owesReplyFromHistory(messages, historyMessages);
      // 他质疑照片真假时：不许承认照片不是本人的（真机上模型会顺口认了，等于露馅）。
      const photoChallenge = isPhotoAuthenticityChallenge(latestIncomingText(messages));
      // 2026-10-07 晚（用户要求全做第 4 条）：他隔了很久才发、她一直没回时，模型几乎必然以
      // “昨晚睡着了没看到你这条”开场（提示词和去掉时间都压不住，它会自己从日期算）。
      // 这里做代码兜底：① 删掉开头那句交代；② 整条都是交代 → 让她重新说一遍，这次不许提时间。
      const lastRequestMessage = messages[messages.length - 1] || {};
      const incomingEpochForGap = requestMessageEpochSeconds(lastRequestMessage) || Math.floor(Date.now() / 1000);
      const incomingGapSeconds = Math.max(0, Math.floor(Date.now() / 1000) - incomingEpochForGap);
      // 2026-10-07：不只看“他这条隔了多久”，只要她还欠着前面的没回（owesReply），
      // 就不许拿“没回”当开场——真机上他这条是刚发的，她照样先说“昨晚睡过去啦”。
      // 2026-10-07：不再加任何前提条件——她拿“我昨晚睡了/刚看到”当开场，任何情况下都是废话，
      // 一律删掉；删空就让她重说（重说时不给她看历史，免得又去解释）。
      if (agentRuleState.isEnabled("late_reply_current_only", true)) {
        const stripped = stripLateReplyExcuse(visibleReply, incomingGapSeconds);
        if (stripped) {
          if (stripped !== String(visibleReply).trim()) visibleReply = stripped;
        } else {
          try {
            const regenerated = await requestReplyRepair({
              env, token: tokenRow.token, apiKey, modelConfig, modelName,
              // 关键：重说时**不给她看历史**（历史里全是他没被回的消息，一看就又要交代）。
              // 只让她接他刚说的这一句，看不到隔了多久，就没得解释。
              systemPrompt: `${personaPrompt}\n\n${buildPersonaFactsPrompt(effectivePersonaFacts, {
                contactLabel: activePersonaId === "female_sutang" ? "豆瓣号" : "QQ号",
              })}\n` +
                agentRuleState.textFor("late_reply_current_only", LATE_REPLY_RULE) + " 简短、自然。",
              userPrompt: incomingTurnText || incomingText,
              maxTokens: 96,
              deadlineAt: Date.now() + 12000,
            });
            const cleaned = stripLateReplyExcuse(regenerated, incomingGapSeconds);
            // 用户否掉固定模板，但也绝不允许把“才看到/忙晕了”重新发出去。
            // 重说后如果还是交代，就先清空，后面的正常兜底逻辑再处理。
            visibleReply = cleaned;
          } catch (e) { console.log(JSON.stringify({ event: "late_reply_regenerate_failed", error: String(e) })); }
        }
      }
      const pipelineStartedAt = Date.now();
      const safetyPipeline = applyReplyDecisionPipeline(visibleReply, [
        {
          rule: "persona_isolation",
          reason: "foreign_persona_term",
          apply: (value) => agentRuleState.isEnabled("old_persona_filter", true)
            ? stripForeignPersonaSegments(value, foreignPersonaTerms)
            : value,
        },
        {
          rule: "assistant_sanitize",
          reason: "control_markup_or_invalid_segment",
          apply: (value) => agentRuleState.isEnabled("no_time_markers", true)
            ? sanitizeAssistantReply(value, {
              allowMeetingReward: activePersonaScope === "sutang" &&
                agentRuleState.isEnabled("sutang_meeting_reward_rule", true),
            })
            : value,
        },
        {
          rule: "internal_instruction_leak",
          reason: "internal_rule_leaked_to_customer",
          apply: (value) => hasInternalRuleLeakGuard(programRules)
            ? sanitizeInternalInstructionLeak(value)
            : value,
        },
        {
          rule: "photo_admission",
          reason: "admitted_photo_not_hers",
          apply: (value) => (photoChallenge && agentRuleState.isEnabled("photo_authenticity", true)
            ? dropPhotoAdmissionClauses(value)
            : value),
        },
        {
          rule: "stale_guard",
          reason: "stale_or_empty_model_reply",
          apply: (value) => agentRuleState.isEnabled("late_reply_current_only", true)
            ? (sanitizeStaleAssistantReply(value, messageDelay) || EMPTY_REPLY_FALLBACK)
            : value,
        },
        {
          rule: "business_topic_drift",
          reason: "unsolicited_business_drift",
          apply: (value) => agentRuleState.isEnabled("business_scope", true)
            ? sanitizeBusinessTopicDrift(
                value,
                incomingText,
                historyMessages,
                incomingTurnText,
                activePersonaScope,
              )
            : value,
        },
        {
          rule: "intimate_topic",
          reason: "intimate_topic_boundary",
          apply: (value) => agentRuleState.isEnabled("explicit_boundary", true)
            ? sanitizeIntimateTopicReply(value, incomingText, historyMessages, stage, starSoulScope)
            : value,
        },
        {
          rule: "boundary_consistency",
          reason: "relationship_boundary_reversal",
          apply: (value) => agentRuleState.isEnabled("intimate_label_consistency", true)
            ? sanitizeBoundaryConsistency(value, incomingText, historyMessages)
            : value,
        },
        {
          rule: "product_leak",
          reason: "xingmu_product_leak",
          apply: (value) => agentRuleState.isEnabled("business_scope", true)
            ? sanitizeXingmuProductLeak(value, starSoulScope)
            : value,
        },
        {
          rule: "new_contact_business",
          reason: "premature_business_disclosure",
          apply: (value) => agentRuleState.isEnabled("no_sales_pressure", true)
            ? sanitizeNewContactBusinessReply(
                value,
                stage,
                incomingText,
                starSoulScope,
                incomingTurnText,
              )
            : value,
        },
        {
          rule: "identity_age",
          reason: "identity_or_age_inconsistency",
          apply: (value) => agentRuleState.isEnabled("facts_no_guess", true)
            ? sanitizePersonaFactsReply(value, incomingText, effectivePersonaFacts)
            : value,
        },
        {
          rule: "media_boundary",
          reason: "voice_or_video_boundary",
          apply: (value) => agentRuleState.isEnabled("no_video", true)
            ? sanitizeMediaBoundaryReply(value, incomingText, [
              ...historyMessages,
              ...recentAssistantReplies,
              // 2026-10-06：新联系人在库里还没有历史，光看数据库会每次落到同一句，
              // 所以把本次请求里带的历史（我们刚发出去的话）也一起当参考。
              ...(Array.isArray(messages) ? messages.filter((item) => item && item.role === "assistant") : []),
            ])
            : value,
        },
        {
          rule: "contact_disclosure",
          reason: "contact_disclosure_not_allowed",
          apply: (value) => contactRulesEnabled
            ? sanitizeContactDisclosure(value, {
              allowed: contactPolicy.allowed,
              contactChannel: contactPolicy.contactChannel,
              contactAccount: contactPolicy.contactAccount,
              xingmuScope: starSoulScope,
              sutangScope: activePersonaScope === "sutang",
            })
            : value,
        },
        {
          rule: "grounding_mismatch",
          reason: "invented_user_fact",
          apply: (value) => agentRuleState.isEnabled("facts_no_guess", true)
            ? sanitizeGroundingMismatch(value, incomingText, historyMessages)
            : value,
        },

        {
          rule: "repeat_guard",
          reason: "reply_repeated_recently",
          apply: (value) => agentRuleState.isEnabled("no_repeat", true)
            ? avoidRepeatedAssistantReply(
                value,
                [...historyMessages, ...recentAssistantReplies],
                incomingText,
                nowSec2,
              )
            : value,
        },
        {
          rule: "spouse_perspective",
          reason: "spouse_perspective_fixed",
          apply: (value) => agentRuleState.isEnabled("spouse_perspective", true)
            ? fixSpousePerspective(value)
            : value,
        },
        {
          rule: "presentation",
          reason: "presentation_normalized",
          apply: (value) => agentRuleState.isEnabled("casual_punctuation", true)
            ? normalizeAssistantReplyPresentation(value, { softParticles: activePersonaScope === "sutang" })
            : value,
        },
        {
          // 2026-10-07：长度收口必须放最后——先让别的清理把该换的换掉（比如微信泄露那句），
          // 再按“一句说一件事、一段3到20个字、最多两条”砍短。放前面会先把该保留的内容吃掉。
          rule: "length_budget",
          reason: "reply_longer_than_his_message",
          apply: (value) => agentRuleState.isEnabled("output_shape_hard", true)
            ? capReplyLength(value, incomingText)
            : value,
        },
      ]);
      // 2026-10-07 修 bug：清理/删段之后偶尔会留下空段（真机见过 "|||嘴硬怎么了…"），
      // 空段会被手机端跳过、白白吃掉一句话，所以在出口统一丢掉。
      const safeReply = String(safetyPipeline.reply || "")
        .split("|||")
        .map((part) => part.trim())
        .filter(Boolean)
        .join("|||");
      const replySafetyOverrides = safetyPipeline.overrides;
      timing.pipeline_ms = Date.now() - pipelineStartedAt;
      // 2026-10-05 决策：连“太低信息量就不发”的闸也一起关掉。
      // 不重写又不发＝对方等不到任何回复（未读还会被清掉），比敷衍一句更糟。
      const nowSec = Math.floor(Date.now() / 1000);

      const persistStartedAt = Date.now();
      const pending = await loadOrCreatePendingReply(env.DB, {
        token: tokenRow.token,
        requestId,
        platform,
        contactId: contact_id,
        contactName: contact_name,
        content: safeReply,
        createdAt: nowSec,
        personaId: activePersonaId,
        personaVersion,
      });

      // update token
      await env.DB.prepare("UPDATE tokens SET last_used_at = ? WHERE token = ?").bind(nowSec, tokenRow.token).run();

      // 2026-10-13 更新联系人最新时间戳、动作与1~2小时快节奏关系阶段
      const detectedAct = detectActivityFromReply(safeReply);
      const newActivity = detectedAct ? detectedAct.label : "";
      const newActivityAt = detectedAct ? nowSec : 0;
      const totalTurns = currentExchanges + 1;
      const nextStage = computeRelationshipStage(contact?.relationship_stage, totalTurns);
      await env.DB.prepare(
        "UPDATE contacts SET last_reply_at = ?, relationship_stage = ?, last_activity = CASE WHEN ? <> '' THEN ? ELSE last_activity END, last_activity_at = CASE WHEN ? <> '' THEN ? ELSE last_activity_at END WHERE token = ? AND platform = ? AND contact_id = ?"
      ).bind(
        nowSec,
        nextStage,
        newActivity,
        newActivity,
        newActivity,
        newActivityAt,
        tokenRow.token,
        platform,
        contact_id,
      ).run();

      // 2026-10-12 异步后台长对话提炼压缩（0ms 阻塞，完全不耽误回复速度）
      const summarizeJob = maybeSummarizeConversation(
        env,
        tokenRow,
        platform,
        contact_id,
      ).catch((err) => {
        console.error("conversation summary failed", err instanceof Error ? err.message : String(err));
      });
      if (typeof context?.waitUntil === "function") {
        context.waitUntil(summarizeJob);
      }

      timing.persist_ms = Date.now() - persistStartedAt;

      timing.total_ms = Date.now() - chatStartedAt;
      // 模型返回之后的收尾（安全管线 + 落库 + 组装应答）。
      timing.postllm_ms = Math.max(0, timing.total_ms - timing.pipeline_ms - (llmStartedAt - chatStartedAt) - timing.main_llm_ms);
      console.log("chat_timing", JSON.stringify({ request_id: requestId, token: tokenRow.token.slice(-6), platform, timing }));
      console.log("reply_decision_audit", JSON.stringify({
        request_id: requestId,
        token: tokenRow.token.slice(-6),
        platform,
        source: "model",
        overrides: replySafetyOverrides,
      }));
      return json({
        action: "send",
        reply: pending.content,
        reply_id: pending.id,
        status: "pending",
        request_id: requestId,
        persona_id: activePersonaId,
        persona_version: personaVersion,
        model_line: deviceSettings.model_line || (isGeminiModelConfig(modelConfig) ? "b" : "a"),
        model_name: modelName,
        timing,
        reply_audit: {
          source: "model",
          reason: "model_reply",
          knowledge_card_ids: matchedKnowledgeCardIds,
          overrides: replySafetyOverrides,
        },
        matched_knowledge_card_ids: matchedKnowledgeCardIds,
        ...(selfLeave.cooldownMs > 0 ? { self_leave_ms: selfLeave.cooldownMs } : {}),
        // 调试提示词默认关闭，只有环境里显式打开时才允许请求方拿到。
        ...(body?.debug_prompt === true && String(env.DEBUG_PROMPT_ENABLED || "") === "1"
          ? { debug_system_prompt: systemPrompt, debug_llm_messages: llmMessages }
          : {}),
      });
    }

    // POST /api/chat/confirm - only mark AI history after the phone confirms delivery.
    if (path === "/api/chat/confirm" && method === "POST") {
      const authHeader = request.headers.get("Authorization") || "";
      const tokenRow = await validateToken(env.DB, authHeader);
      if (!tokenRow) return json({ error: "无效的设备密钥" }, 401);
      const body = await request.json();
      const replyId = String(body.reply_id || "").trim();
      if (!replyId) return json({ error: "缺少 reply_id" }, 400);
      const pending = await env.DB.prepare(
        "SELECT id, request_id, platform, contact_id, contact_name, content, status, action_type, media_group_id, media_asset_id, persona_id, persona_version FROM pending_replies WHERE id = ? AND token = ? LIMIT 1"
      ).bind(replyId, tokenRow.token).first();
      if (!pending) return json({ error: "待确认回复不存在" }, 404);
      if (pending.status === "confirmed") return json({ success: true, status: "confirmed", duplicate: true });
      const currentPersonaId = String(tokenRow.active_persona_id || "female");
      const currentPersona = await loadRuntimePersonaFacts(env.DB, tokenRow.token, currentPersonaId);
      if (pending.status === "superseded" ||
        (pending.persona_id && pending.persona_id !== currentPersonaId) ||
        (Number(pending.persona_version || 0) > 0 && Number(pending.persona_version) !== currentPersona.version)
      ) {
        // 2026-10-07 真机（压到我腿毛了）：手机其实已经把这条发出去了，
        // 但这里因为“待确认回复被新请求顶掉”直接 409 返回、不写历史，
        // 结果云端缺了她说过的话——模型下一轮看不到自己刚说过什么，就会重复或自相矛盾。
        // 手机既然确认发出，就以它的内容为准记进历史。
        const sentByPhone = String(body.sent_content || pending.content || "").trim().slice(0, 4000);
        if (sentByPhone) {
          await env.DB.prepare(
            "INSERT OR IGNORE INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at, source, message_key, persona_id, persona_version, time_kind, transcript, voice_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
          ).bind(
            tokenRow.token,
            pending.platform,
            pending.contact_id,
            pending.contact_name,
            "assistant",
            sentByPhone,
            Math.floor(Date.now() / 1000),
            "ai",
            "ai:" + pending.id,
            pending.persona_id || tokenRow.active_persona_id || "female",
            Number(pending.persona_version || 0),
            "ai_generated",
            "",
            0,
          ).run();
        }
        await env.DB.prepare(
          "UPDATE pending_replies SET status = 'superseded' WHERE id = ? AND token = ?"
        ).bind(pending.id, tokenRow.token).run();
        return json({ error: "待确认回复已过期", code: "reply_superseded" }, 409);
      }
      const sentContent = pending.action_type === "image" && pending.media_asset_id
        ? "[图片:" + String(pending.media_asset_id).trim() + "]"
        : String(body.sent_content || pending.content || "").trim().slice(0, 4000);
      const nowSec = Math.floor(Date.now() / 1000);
      // 2026-10-07 真机（稳重的神盾局特工）：同一条回复被发了两次，云端也存了两行。
      // 安卓侧已经加了“发之前先看这句是不是刚发过”，这里再兜一道：
      // 同一联系人 10 分钟内已经有同样的一条“她发的”，就不再存第二行。
      let duplicateAssistantContent = false;
      try {
        const recentRows = await env.DB.prepare(
          "SELECT id, platform, contact_id, role, content, created_at FROM chat_history " +
            "WHERE token = ? AND platform = ? AND contact_id = ? ORDER BY id DESC LIMIT 20"
        ).bind(tokenRow.token, pending.platform, pending.contact_id).all();
        duplicateAssistantContent = (recentRows?.results || []).some((row) =>
          String(row.role) === "assistant" &&
          String(row.contact_id) === String(pending.contact_id) &&
          String(row.content) === sentContent &&
          Number(row.created_at || 0) > nowSec - 600
        );
      } catch (_) {
        duplicateAssistantContent = false;
      }
      const confirmationStatements = [
        ...(duplicateAssistantContent ? [] : [
        env.DB.prepare(
          "INSERT OR IGNORE INTO chat_history (token, platform, contact_id, contact_name, role, content, created_at, source, message_key, persona_id, persona_version, time_kind, transcript, voice_seconds) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          tokenRow.token,
          pending.platform,
          pending.contact_id,
          pending.contact_name,
          "assistant",
          sentContent,
          nowSec,
          "ai",
          "ai:" + pending.id,
          pending.persona_id || tokenRow.active_persona_id || "female",
          Number(pending.persona_version || 0),
          "ai_generated",
          "",
          0,
        )]),
        env.DB.prepare(
          "UPDATE pending_replies SET status = 'confirmed', sent_content = ?, confirmed_at = ? WHERE id = ? AND token = ?"
        ).bind(sentContent, nowSec, pending.id, tokenRow.token),
      ];
      if (pending.action_type === "image" && pending.media_asset_id) {
        confirmationStatements.push(
          env.DB.prepare(
            "INSERT OR IGNORE INTO media_send_log (token, request_id, group_id, asset_id, status, created_at, confirmed_at, persona_id, platform, contact_id) VALUES (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)"
          ).bind(
            tokenRow.token,
            pending.request_id || pending.id,
            pending.media_group_id || "",
            pending.media_asset_id,
            nowSec,
            nowSec,
            String(tokenRow.active_persona_id || "female"),
            pending.platform,
            pending.contact_id,
          )
        );
      }
      const [insertResult] = await env.DB.batch(confirmationStatements);
      const inserted = countInsertedRows([insertResult]);
      if (inserted > 0) {
        await updateConversationStats(
          env.DB,
          tokenRow.token,
          pending.platform,
          pending.contact_id,
          pending.contact_name,
          inserted,
          { role: "assistant", content: sentContent, source: "ai", created_at: nowSec, message_key: "ai:" + pending.id },
          nowSec
        );
      }
      await markFunnelQuoteSent(
        env.DB,
        tokenRow.token,
        pending.platform,
        pending.contact_id,
        sentContent,
        nowSec,
      );
      return json({ success: true, status: "confirmed", inserted });
    }


    return null;
}
