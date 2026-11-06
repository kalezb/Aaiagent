const { buildLeanConversationPrompt } = require('../functions/api/_lean_conversation_prompt');
const { buildPersonaFactsPrompt } = require('../functions/api/_persona_facts');
const { loadPersonaPlaybookCards } = require('../functions/api/_persona_playbook');

async function measure() {
  const incoming = "你结婚了吗，老公在不在身边";
  const messages = [
    { role: "user", content: "睡不着了" },
    { role: "assistant", content: "醒这么早，我也睡不着" },
    { role: "user", content: incoming }
  ];

  const facts = {
    current_city: "重庆",
    current_district: "两江新区",
    contact_qq: "sutang2026"
  };

  const leanPrompt = buildLeanConversationPrompt({
    personaId: "female_sutang",
    systemPrompt: "你是苏棠，29岁，已婚，伴侣常年在外面跑业务，和婆婆、3岁女儿住在重庆两江新区，在家带娃、操持家务。",
    facts,
    incoming,
    messages,
    historyMessages: messages,
    platform: "soul",
    currentDatetime: "2026-10-19 09:40:00",
    weekday: "星期一",
    homeLocation: { city: "重庆", district: "两江新区" }
  });

  const charCount = leanPrompt.length;
  // Approximate tokens: Chinese ~ 1.5 - 1.8 chars/token, or in DeepSeek / OpenAI tokenizer ~ 0.6 - 0.8 tokens per Chinese character.
  // In English / punctuation ~ 3-4 chars/token.
  console.log("=== Lean Prompt (Default in production) ===");
  console.log("Characters:", charCount);
  console.log("Estimated Prompt Tokens (DeepSeek/Gemini):", Math.round(charCount * 0.75));

  // Measure history turns scaling
  for (const turns of [2, 6, 12, 20]) {
    const hist = [];
    for (let i = 0; i < turns; i++) {
      hist.push({ role: "user", content: "你在干嘛呢吃了没啊" });
      hist.push({ role: "assistant", content: "在家带娃呢，刚忙活完" });
    }
    const p = buildLeanConversationPrompt({
      personaId: "female_sutang",
      systemPrompt: "你是苏棠，29岁，已婚，伴侣常年在外面跑业务，和婆婆、3岁女儿住在重庆两江新区，在家带娃、操持家务。",
      facts,
      incoming,
      messages: hist,
      historyMessages: hist,
      platform: "soul",
      currentDatetime: "2026-10-19 09:40:00",
      weekday: "星期一",
      homeLocation: { city: "重庆", district: "两江新区" }
    });
    console.log(`With ${turns} history exchanges: ${p.length} chars (~${Math.round(p.length * 0.75)} tokens)`);
  }
}

measure().catch(console.error);
