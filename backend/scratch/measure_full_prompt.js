const { buildPersonaPrompt } = require('../functions/api/_reply_policy');

async function measureFull() {
  const incoming = "你结婚了吗，老公在不在身边";
  const messages = [
    { role: "user", content: "睡不着了" },
    { role: "assistant", content: "醒这么早，我也睡不着" },
    { role: "user", content: incoming }
  ];

  const fullPrompt = buildPersonaPrompt({
    personaId: "female_sutang",
    effectivePersonaPrompt: "你是苏棠，29岁，已婚，伴侣常年在外面跑业务，和婆婆、3岁女儿住在重庆两江新区，在家带娃、操持家务。",
    effectivePersonaFacts: { current_city: "重庆", current_district: "两江新区", contact_qq: "sutang2026" },
    incoming,
    messages,
    historyMessages: messages,
    platform: "soul",
    currentDatetime: "2026-10-19 09:40:00",
    weekday: "星期一",
    homeLocation: { city: "重庆", district: "两江新区" }
  });

  console.log("=== Legacy Full Prompt ===");
  console.log("Characters:", fullPrompt.length);
  console.log("Estimated Tokens:", Math.round(fullPrompt.length * 0.75));
}

measureFull().catch(console.error);
