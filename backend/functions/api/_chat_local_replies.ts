import {
  avoidRepeatedAssistantReply,
  latestIncomingText,
  localAgeReply,
  localExcludedRecycleReply,
  localVoiceReply,
} from "./_reply_policy";
import { createImmediateReplyDecision } from "./_reply_decision";
import { respondWithImmediateReply } from "./_chat_delivery";

export async function respondWithLocalChatReply({
  env,
  tokenRow,
  requestId,
  platform,
  contactId,
  contactName,
  messages,
  agentRuleState,
  recentAssistantReplies,
  starSoulScope,
  nowSec,
  effectiveAge,
  effectivePersonaFacts,
  personaPrompt,
  activePersonaId,
  personaVersion,
  activePersonaScope,
  contractFields,
}: {
  env: any;
  tokenRow: any;
  requestId: string;
  platform: string;
  contactId: string;
  contactName: string;
  messages: any[];
  agentRuleState: any;
  recentAssistantReplies: any[];
  starSoulScope: boolean;
  nowSec: number;
  effectiveAge: number;
  effectivePersonaFacts: any;
  personaPrompt: string;
  activePersonaId: string;
  personaVersion: number;
  activePersonaScope: string;
  contractFields: Record<string, unknown>;
}): Promise<Response | null> {
  const incomingText = latestIncomingText(messages);
  const localVoice = agentRuleState.isEnabled("voice_call_boundary", true)
    ? localVoiceReply(messages, recentAssistantReplies)
    : "";
  if (localVoice) {
    return respondWithImmediateReply({
      env,
      tokenRow,
      requestId,
      platform,
      contactId,
      contactName,
      contractFields,
      personaId: activePersonaId,
      personaVersion,
      personaScope: activePersonaScope,
      incomingText,
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
    incomingText,
    nowSec,
    "这些不收，只收带屏幕、带电池、带电路的旧数码。",
  );
  if (localReply) {
    return respondWithImmediateReply({
      env,
      tokenRow,
      requestId,
      platform,
      contactId,
      contactName,
      contractFields,
      personaId: activePersonaId,
      personaVersion,
      personaScope: activePersonaScope,
      incomingText,
      decision: createImmediateReplyDecision(
        "local_recycle",
        "excluded_recycle_item",
        localReply,
      ),
    });
  }

  const localAge = (
    agentRuleState.isEnabled("fixed_age", true) ||
    agentRuleState.isEnabled("children_facts", true)
  )
    ? localAgeReply(
      messages,
      personaPrompt,
      recentAssistantReplies,
      nowSec,
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
      contactId,
      contactName,
      contractFields,
      personaId: activePersonaId,
      personaVersion,
      personaScope: activePersonaScope,
      incomingText,
      decision: createImmediateReplyDecision(
        "local_age",
        "self_age_question",
        localAge,
      ),
    });
  }
  return null;
}
