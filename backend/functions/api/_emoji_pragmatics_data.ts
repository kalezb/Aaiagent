// persona-guard: ok (file) — 表情语用学与豆瓣全量表情映射系统
// 借鉴 GitHub 优秀开源项目（llm-vibe-sticker、cnsenti、EVD+）以及社交语用学研究：
// 表情是语气助推剂（Conversational Lubricant / Pragmatic Modifier），
// 具备软化语气、调侃傲娇、化解尴尬等功能，不代表对方字面的极端情绪。

export interface EmojiPragmaticInfo {
  tag: string;
  category: "teasing_or_pouting" | "positive_icebreaking" | "flirting_or_affection" | "softening_or_helpless" | "thinking_or_curious" | "action_or_support" | "daily_fun";
  name: string;
  pragmaticRole: string; // 语用功能说明（大白话）
}

/**
 * 豆瓣 164 个全量表情及常用社交表情的语用功能知识库
 */
export const DOUBAN_EMOJI_REGISTRY: Record<string, EmojiPragmaticInfo> = {
  // ── 1. 调侃 / 傲娇 / 假装生气（社交中的核心助推剂，常被误判为真生气） ──
  "[白眼]": {
    tag: "[白眼]",
    category: "teasing_or_pouting",
    name: "白眼",
    pragmaticRole: "娇嗔、假装无语或调侃开玩笑，绝非真正嫌弃或攻击，适合顺毛哄、打趣或接梗回应。",
  },
  "[发怒]": {
    tag: "[发怒]",
    category: "teasing_or_pouting",
    name: "发怒",
    pragmaticRole: "假装生气或傲娇（类似“哼打你哦”），属于社交娇嗔助推，不可严肃道歉或对立，应幽默化解。",
  },
  "[生气]": {
    tag: "[生气]",
    category: "teasing_or_pouting",
    name: "生气",
    pragmaticRole: "假装生气或撒娇式抗议，不是真发火，通常是开玩笑互动。",
  },
  "[不屑]": {
    tag: "[不屑]",
    category: "teasing_or_pouting",
    name: "不屑",
    pragmaticRole: "傲娇小表情，打趣说反话，属于调动聊天趣味的助推剂。",
  },
  "[鬼脸]": {
    tag: "[鬼脸]",
    category: "teasing_or_pouting",
    name: "鬼脸",
    pragmaticRole: "调皮搞怪、做鬼脸逗乐，表达亲近和开玩笑。",
  },
  "[吐舌头]": {
    tag: "[吐舌头]",
    category: "teasing_or_pouting",
    name: "吐舌头",
    pragmaticRole: "俏皮卖萌、打破严肃、掩饰小尴尬或开玩笑。",
  },
  "[微笑吐舌]": {
    tag: "[微笑吐舌]",
    category: "teasing_or_pouting",
    name: "微笑吐舌",
    pragmaticRole: "调皮卖萌，活跃气氛，说明对方态度很放松。",
  },
  "[假笑]": {
    tag: "[假笑]",
    category: "teasing_or_pouting",
    name: "假笑",
    pragmaticRole: "自嘲或调侃无奈（类似“礼貌而不失尴尬的微笑”），属于幽默助推。",
  },
  "[倒立微笑]": {
    tag: "[倒立微笑]",
    category: "teasing_or_pouting",
    name: "倒立微笑",
    pragmaticRole: "阴阳调侃或自嘲无语，以搞怪方式化解尴尬。",
  },
  "[黑框眼镜]": {
    tag: "[黑框眼镜]",
    category: "teasing_or_pouting",
    name: "黑框眼镜",
    pragmaticRole: "一本正经地开玩笑、装深沉或玩梗。",
  },
  "[恶魔]": {
    tag: "[恶魔]",
    category: "teasing_or_pouting",
    name: "恶魔",
    pragmaticRole: "小坏心眼、小调皮、搞恶作剧的俏皮暗示。",
  },
  "[倔强]": {
    tag: "[倔强]",
    category: "teasing_or_pouting",
    name: "倔强",
    pragmaticRole: "死鸭子嘴硬式自嘲，假装要强，十分可爱的人性化表达。",
  },
  "[鄙视]": {
    tag: "[鄙视]",
    category: "teasing_or_pouting",
    name: "鄙视",
    pragmaticRole: "朋友间的嫌弃调侃（“就这？”），属于亲近互损，非真实恶意。",
  },

  // ── 2. 友好破冰 / 社交润滑 / 接梗回应 ──
  "[哈哈]": {
    tag: "[哈哈]",
    category: "positive_icebreaking",
    name: "哈哈",
    pragmaticRole: "积极接话、觉得话题有趣，是极佳的社交润滑剂。",
  },
  "[嘻嘻]": {
    tag: "[嘻嘻]",
    category: "positive_icebreaking",
    name: "嘻嘻",
    pragmaticRole: "开心、窃喜、亲近偷笑，表示对话氛围融洽友好。",
  },
  "[龇牙笑]": {
    tag: "[龇牙笑]",
    category: "positive_icebreaking",
    name: "龇牙笑",
    pragmaticRole: "灿烂开心、热情善意、破冰示好。",
  },
  "[笑脸]": {
    tag: "[笑脸]",
    category: "positive_icebreaking",
    name: "笑脸",
    pragmaticRole: "温和微笑、表示礼貌与倾听。",
  },
  "[爆笑]": {
    tag: "[爆笑]",
    category: "positive_icebreaking",
    name: "爆笑",
    pragmaticRole: "被彻底逗乐，对你的话题高度买账。",
  },
  "[笑死了]": {
    tag: "[笑死了]",
    category: "positive_icebreaking",
    name: "笑死了",
    pragmaticRole: "强烈接梗认同，表示你说的很好笑、很有趣。",
  },
  "[喜极而泣]": {
    tag: "[喜极而泣]",
    category: "positive_icebreaking",
    name: "喜极而泣",
    pragmaticRole: "笑哭，既觉得好笑又带一点无奈自嘲，是万能社交润滑剂。",
  },
  "[微笑]": {
    tag: "[微笑]",
    category: "positive_icebreaking",
    name: "微笑",
    pragmaticRole: "礼貌回应或温和注视，年轻语境中有时带一点看透不说破的淡定。",
  },
  "[眨眼]": {
    tag: "[眨眼]",
    category: "positive_icebreaking",
    name: "眨眼",
    pragmaticRole: "心照不宣、俏皮暗示、“懂的都懂”。",
  },
  "[鼓掌]": {
    tag: "[鼓掌]",
    category: "positive_icebreaking",
    name: "鼓掌",
    pragmaticRole: "喝彩赞赏、为你高兴或肯定你的想法。",
  },
  "[膜拜]": {
    tag: "[膜拜]",
    category: "positive_icebreaking",
    name: "膜拜",
    pragmaticRole: "夸赞你厉害、“大佬带带我”，属于恭维与拉近距离。",
  },
  "[赞]": {
    tag: "[赞]",
    category: "positive_icebreaking",
    name: "赞",
    pragmaticRole: "点赞肯定，认可你的观点或日常分享。",
  },
  "[好]": {
    tag: "[好]",
    category: "positive_icebreaking",
    name: "好",
    pragmaticRole: "痛快答应、表示赞成与配合。",
  },
  "[好的]": {
    tag: "[好的]",
    category: "positive_icebreaking",
    name: "好的",
    pragmaticRole: "礼貌收到、顺从答应。",
  },
  "[胜利]": {
    tag: "[胜利]",
    category: "positive_icebreaking",
    name: "胜利",
    pragmaticRole: "开心比耶、庆祝小成就或传达元气满满。",
  },
  "[举双手]": {
    tag: "[举双手]",
    category: "positive_icebreaking",
    name: "举双手",
    pragmaticRole: "举双手赞成、完全投降或热情欢呼。",
  },

  // ── 3. 亲近试探 / 撒娇好感 / 软化距离 ──
  "[害羞笑]": {
    tag: "[害羞笑]",
    category: "flirting_or_affection",
    name: "害羞笑",
    pragmaticRole: "害羞、不好意思、被夸赞后的娇羞，暗示有好感或亲密萌芽。",
  },
  "[飞吻]": {
    tag: "[飞吻]",
    category: "flirting_or_affection",
    name: "飞吻",
    pragmaticRole: "热情表达喜欢或道谢，带一点甜美撒娇。",
  },
  "[亲亲]": {
    tag: "[亲亲]",
    category: "flirting_or_affection",
    name: "亲亲",
    pragmaticRole: "亲昵示好、拉近关系、卖萌求宠。",
  },
  "[喜欢]": {
    tag: "[喜欢]",
    category: "flirting_or_affection",
    name: "喜欢",
    pragmaticRole: "满眼爱心、表达欣赏喜爱与着迷。",
  },
  "[心]": {
    tag: "[心]",
    category: "flirting_or_affection",
    name: "心",
    pragmaticRole: "红心示爱、传递暖意或真诚感激。",
  },
  "[爱心]": {
    tag: "[爱心]",
    category: "flirting_or_affection",
    name: "爱心",
    pragmaticRole: "表达善意、喜欢或赞许。",
  },
  "[爱心猫]": {
    tag: "[爱心猫]",
    category: "flirting_or_affection",
    name: "爱心猫",
    pragmaticRole: "用猫咪形象卖萌示好、表达可爱喜欢。",
  },
  "[小天使]": {
    tag: "[小天使]",
    category: "flirting_or_affection",
    name: "小天使",
    pragmaticRole: "纯真善良形象、表示自己很乖或夸对方是天使。",
  },
  "[天使]": {
    tag: "[天使]",
    category: "flirting_or_affection",
    name: "天使",
    pragmaticRole: "乖巧纯良、善意无害。",
  },
  "[唇印]": {
    tag: "[唇印]",
    category: "flirting_or_affection",
    name: "唇印",
    pragmaticRole: "飞吻印记、热烈感谢或女性化俏皮点缀。",
  },
  "[美味]": {
    tag: "[美味]",
    category: "flirting_or_affection",
    name: "美味",
    pragmaticRole: "馋了、嘴馋、对美食或美好事物垂涎欲滴。",
  },
  "[舒服]": {
    tag: "[舒服]",
    category: "flirting_or_affection",
    name: "舒服",
    pragmaticRole: "惬意、松弛、感到安逸放松。",
  },

  // ── 4. 软化语气 / 化解尴尬 / 自嘲垫字 ──
  "[尴尬]": {
    tag: "[尴尬]",
    category: "softening_or_helpless",
    name: "尴尬",
    pragmaticRole: "主动认领尴尬，自嘲解围，给彼此找台阶。",
  },
  "[汗]": {
    tag: "[汗]",
    category: "softening_or_helpless",
    name: "汗",
    pragmaticRole: "擦汗自嘲、无语苦笑，用软化语气避免把天聊死。",
  },
  "[囧]": {
    tag: "[囧]",
    category: "softening_or_helpless",
    name: "囧",
    pragmaticRole: "感到滑稽或窘迫、幽默自黑。",
  },
  "[无奈]": {
    tag: "[无奈]",
    category: "softening_or_helpless",
    name: "无奈",
    pragmaticRole: "摊手叹气但依然在聊，表示环境或事情不如意而非针对你。",
  },
  "[不高兴]": {
    tag: "[不高兴]",
    category: "softening_or_helpless",
    name: "不高兴",
    pragmaticRole: "扁嘴求安慰、小委屈试探，希望得到关心回应。",
  },
  "[难过]": {
    tag: "[难过]",
    category: "softening_or_helpless",
    name: "难过",
    pragmaticRole: "求安慰或同情，多为小事受挫，适合顺势共情安抚。",
  },
  "[大哭]": {
    tag: "[大哭]",
    category: "softening_or_helpless",
    name: "大哭",
    pragmaticRole: "夸张式卖惨或撒娇（如“太难了呜呜呜”），绝非真绝望，应温和安抚。",
  },
  "[悲伤]": {
    tag: "[悲伤]",
    category: "softening_or_helpless",
    name: "悲伤",
    pragmaticRole: "小伤感或情绪低落，提供温和陪伴即可。",
  },
  "[失望]": {
    tag: "[失望]",
    category: "softening_or_helpless",
    name: "失望",
    pragmaticRole: "可惜、遗憾，并非谴责，常用于计划落空。",
  },
  "[糟糕]": {
    tag: "[糟糕]",
    category: "softening_or_helpless",
    name: "糟糕",
    pragmaticRole: "哎呀搞砸了、小慌乱自嘲，轻松安慰即可化解。",
  },
  "[心碎]": {
    tag: "[心碎]",
    category: "softening_or_helpless",
    name: "心碎",
    pragmaticRole: "夸张的心碎卖萌，博取同情或打趣互动。",
  },
  "[便便]": {
    tag: "[便便]",
    category: "softening_or_helpless",
    name: "便便",
    pragmaticRole: "幽默搞怪、吐槽事物很烂，毫无恶意。",
  },
  "[晕眩]": {
    tag: "[晕眩]",
    category: "softening_or_helpless",
    name: "晕眩",
    pragmaticRole: "晕了、信息量过大或被逗晕，属于夸张修辞。",
  },
  "[疲倦]": {
    tag: "[疲倦]",
    category: "softening_or_helpless",
    name: "疲倦",
    pragmaticRole: "累了、打工人疲惫日常，适合关怀一句注意休息。",
  },
  "[困乏]": {
    tag: "[困乏]",
    category: "softening_or_helpless",
    name: "困乏",
    pragmaticRole: "犯困、该睡觉了或提不起劲。",
  },
  "[做错事]": {
    tag: "[做错事]",
    category: "softening_or_helpless",
    name: "做错事",
    pragmaticRole: "双手合十道歉卖萌、我错了求放过，非常谦逊友好的态度。",
  },

  // ── 5. 好奇试探 / 思考互动 ──
  "[思考]": {
    tag: "[思考]",
    category: "thinking_or_curious",
    name: "思考",
    pragmaticRole: "认真琢磨你的话、思考怎么回答，或在打什么鬼主意。",
  },
  "[沉思]": {
    tag: "[沉思]",
    category: "thinking_or_curious",
    name: "沉思",
    pragmaticRole: "托腮思考，说明正在倾听你的观点。",
  },
  "[困惑]": {
    tag: "[困惑]",
    category: "thinking_or_curious",
    name: "困惑",
    pragmaticRole: "不太明白、希望你多解释一点，适合自然展开细节。",
  },
  "[疑惑]": {
    tag: "[疑惑]",
    category: "thinking_or_curious",
    name: "疑惑",
    pragmaticRole: "疑问求知，是深入聊天的天然入口。",
  },
  "[吃惊]": {
    tag: "[吃惊]",
    category: "thinking_or_curious",
    name: "吃惊",
    pragmaticRole: "哇塞、竟然这样，对你的分享表现出强烈的惊叹共鸣。",
  },
  "[尖叫]": {
    tag: "[尖叫]",
    category: "thinking_or_curious",
    name: "尖叫",
    pragmaticRole: "极度惊喜或受刺激，情绪饱满的助推剂。",
  },

  // ── 6. 动作 / 社交支持 ──
  "[举手]": {
    tag: "[举手]",
    category: "action_or_support",
    name: "举手",
    pragmaticRole: "发言示意、“算我一个”、“我也去”，积极参与信号。",
  },
  "[握拳]": {
    tag: "[握拳]",
    category: "action_or_support",
    name: "握拳",
    pragmaticRole: "加油、冲鸭、为你打气鼓劲。",
  },
  "[拳头]": {
    tag: "[拳头]",
    category: "action_or_support",
    name: "拳头",
    pragmaticRole: "碰拳互勉，或打闹假装揍你一下。",
  },
  "[摇手]": {
    tag: "[摇手]",
    category: "action_or_support",
    name: "摇手",
    pragmaticRole: "挥手打招呼、说拜拜，或谦虚摆手“不用客气”。",
  },
  "[跳舞]": {
    tag: "[跳舞]",
    category: "action_or_support",
    name: "跳舞",
    pragmaticRole: "得瑟、欢脱、心情像跳舞一样好。",
  },
  "[肌肉]": {
    tag: "[肌肉]",
    category: "action_or_support",
    name: "肌肉",
    pragmaticRole: "坚强有力、夸赞身材或展示力量信心。",
  },

  // ── 7. 日常生活 / 趣味事物 ──
  "[啤酒]": {
    tag: "[啤酒]",
    category: "daily_fun",
    name: "啤酒",
    pragmaticRole: "干杯碰杯、小酌放松、周末聚会氛围。",
  },
  "[咖啡]": {
    tag: "[咖啡]",
    category: "daily_fun",
    name: "咖啡",
    pragmaticRole: "续命提神、下午茶聊天、小资悠闲生活方式。",
  },
  "[蛋糕]": {
    tag: "[蛋糕]",
    category: "daily_fun",
    name: "蛋糕",
    pragmaticRole: "甜蜜分享、过生日庆祝或慰劳自己。",
  },
  "[猫]": {
    tag: "[猫]",
    category: "daily_fun",
    name: "猫",
    pragmaticRole: "萌宠分享、猫奴共鸣、可爱慵懒。",
  },
  "[狗]": {
    tag: "[狗]",
    category: "daily_fun",
    name: "狗",
    pragmaticRole: "忠诚可爱、单身狗自嘲或宠物话题。",
  },
  "[玫瑰]": {
    tag: "[玫瑰]",
    category: "daily_fun",
    name: "玫瑰",
    pragmaticRole: "浪漫示好、鲜花感谢或女性化优雅表达。",
  },
  "[月亮]": {
    tag: "[月亮]",
    category: "daily_fun",
    name: "月亮",
    pragmaticRole: "夜晚氛围、道晚安、浪漫夜空。",
  },

  // ── 8. Soul 互动表情与时段动态表情（平台专属社交助推） ──
  "[皮一下]": {
    tag: "[皮一下]",
    category: "teasing_or_pouting",
    name: "皮一下",
    pragmaticRole: "调皮开玩笑逗你，气氛轻松俏皮，适合接梗调侃或幽默反击。",
  },
  "[戳一下]": {
    tag: "[戳一下]",
    category: "positive_icebreaking",
    name: "戳一下",
    pragmaticRole: "戳了你一下打招呼、提醒回消息或逗你玩，属于轻松破冰，顺势接话或反问对方在忙什么。",
  },
  "[拍一下]": {
    tag: "[拍一下]",
    category: "positive_icebreaking",
    name: "拍一下",
    pragmaticRole: "拍了拍你打招呼、催你回消息或亲昵互动，态度友好，随和顺接即可。",
  },
  "[弹一下]": {
    tag: "[弹一下]",
    category: "positive_icebreaking",
    name: "弹一下",
    pragmaticRole: "弹了你一下想引起注意或逗你玩，气氛轻松调皮，随和接住。",
  },
  "[挠一下]": {
    tag: "[挠一下]",
    category: "teasing_or_pouting",
    name: "挠一下",
    pragmaticRole: "挠你一下调侃、逗趣或轻柔催促，像朋友间嬉闹，语气轻松应对。",
  },
  "[摸一下]": {
    tag: "[摸一下]",
    category: "flirting_or_affection",
    name: "摸一下",
    pragmaticRole: "摸摸你安慰、关心或亲昵互动，温暖随和回应。",
  },
  "[在干嘛]": {
    tag: "[在干嘛]",
    category: "positive_icebreaking",
    name: "在干嘛",
    pragmaticRole: "主动找话题破冰开启聊天，分享当前生活小状态并反问对方在做什么。",
  },
  "[YYDS]": {
    tag: "[YYDS]",
    category: "positive_icebreaking",
    name: "YYDS",
    pragmaticRole: "强烈夸赞认可你永远的神，谦逊开心地接住，不要过于严肃。",
  },
  "[加油鸭]": {
    tag: "[加油鸭]",
    category: "action_or_support",
    name: "加油鸭",
    pragmaticRole: "为你加油鼓励，表达支持与暖意，感谢对方并增进好感。",
  },
  "[奈斯奈斯]": {
    tag: "[奈斯奈斯]",
    category: "positive_icebreaking",
    name: "奈斯奈斯",
    pragmaticRole: "表示很好、赞同或满意，顺着积极话题往下聊。",
  },
  "[用力抱住]": {
    tag: "[用力抱住]",
    category: "flirting_or_affection",
    name: "用力抱住",
    pragmaticRole: "想给你一个用力的拥抱，表达安慰、亲近或想念，温暖体贴地给予情绪价值。",
  },
  "[举手dd]": {
    tag: "[举手dd]",
    category: "positive_icebreaking",
    name: "举手dd",
    pragmaticRole: "举手报到表示自己在线、主动打招呼，热情随和回应。",
  },
  "[为你打Call]": {
    tag: "[为你打Call]",
    category: "action_or_support",
    name: "为你打Call",
    pragmaticRole: "应援支持与赞赏，开心互动接话。",
  },
  "[略略略]": {
    tag: "[略略略]",
    category: "teasing_or_pouting",
    name: "略略略",
    pragmaticRole: "调皮吐槽、撒娇式挑衅或开玩笑，绝非真正恶意，幽默互怼或顺毛哄。",
  },
  "[早安]": {
    tag: "[早安]",
    category: "positive_icebreaking",
    name: "早安",
    pragmaticRole: "早晨主动发来的时段问候，属于破冰找话题，自然回复早晨生活状态，礼貌问候。",
  },
  "[早上好]": {
    tag: "[早上好]",
    category: "positive_icebreaking",
    name: "早上好",
    pragmaticRole: "早晨主动发来的时段动态问候，破冰示好，自然顺接回复早上的状态。",
  },
  "[午安]": {
    tag: "[午安]",
    category: "positive_icebreaking",
    name: "午安",
    pragmaticRole: "中午时段问候，随口聊聊午饭或午休放松，气氛随性融洽。",
  },
  "[中午好]": {
    tag: "[中午好]",
    category: "positive_icebreaking",
    name: "中午好",
    pragmaticRole: "午间时段问候，顺带聊聊午饭或休息，随和互动。",
  },
  "[晚安]": {
    tag: "[晚安]",
    category: "positive_icebreaking",
    name: "晚安",
    pragmaticRole: "晚间问候，聊聊放松惬意的晚间状态，若对方准备休息则温柔道别。",
  },
  "[晚上好]": {
    tag: "[晚上好]",
    category: "positive_icebreaking",
    name: "晚上好",
    pragmaticRole: "晚间主动问候，聊天下班放松或夜晚安排，开启轻松对话。",
  },
  "[友好互动表情]": {
    tag: "[友好互动表情]",
    category: "positive_icebreaking",
    name: "友好互动表情",
    pragmaticRole: "对方发来一个表情维持对话热度，接住轻松氛围，把话题往前推进一句。",
  },
  "[互动表情]": {
    tag: "[互动表情]",
    category: "positive_icebreaking",
    name: "互动表情",
    pragmaticRole: "对方发来互动动效打招呼示好，轻松接住话题。",
  },
};

/**
 * 常见 Unicode 表情到语用类别的映射
 */
export const UNICODE_EMOJI_PRAGMATIC_MAP: Record<string, EmojiPragmaticInfo> = {
  "😂": { tag: "😂", category: "positive_icebreaking", name: "笑哭", pragmaticRole: "觉得很好笑并带自嘲，是万能防尴尬润滑剂。" },
  "🤣": { tag: "🤣", category: "positive_icebreaking", name: "翻滚笑", pragmaticRole: "被彻底逗乐，极度买账。" },
  "😅": { tag: "😅", category: "softening_or_helpless", name: "汗笑", pragmaticRole: "略显尴尬但不扫兴，以自嘲软化语气。" },
  "🥺": { tag: "🥺", category: "flirting_or_affection", name: "可怜委屈", pragmaticRole: "装可怜撒娇、请求关怀，并非真正受伤害。" },
  "🙄": { tag: "🙄", category: "teasing_or_pouting", name: "翻白眼", pragmaticRole: "假装无语调侃、傲娇娇嗔，不可当作恶意反感。" },
  "😒": { tag: "😒", category: "teasing_or_pouting", name: "嫌弃", pragmaticRole: "假装不屑逗乐，属于亲近互损。" },
  "😜": { tag: "😜", category: "teasing_or_pouting", name: "眨眼吐舌", pragmaticRole: "调皮做鬼脸、开玩笑逗你玩。" },
  "😡": { tag: "😡", category: "teasing_or_pouting", name: "愤怒", pragmaticRole: "假装暴怒抗议、撒娇要打人，绝不可严肃对抗。" },
  "😭": { tag: "😭", category: "softening_or_helpless", name: "大哭", pragmaticRole: "夸张诉苦撒娇（太惨了呜呜），温和安慰即可。" },
  "🌚": { tag: "🌚", category: "teasing_or_pouting", name: "黑脸月亮", pragmaticRole: "内涵调侃、心照不宣的小坏心思、懂的都懂。" },
  "🤡": { tag: "🤡", category: "softening_or_helpless", name: "小丑", pragmaticRole: "自嘲小丑、自黑搞怪，轻松顺着聊即可。" },
  "👍": { tag: "👍", category: "positive_icebreaking", name: "强", pragmaticRole: "点赞认同、友好鼓励。" },
  "🙏": { tag: "🙏", category: "action_or_support", name: "合十感激", pragmaticRole: "多谢、拜托拜托，表达真诚敬意或客气。" },
  "❤️": { tag: "❤️", category: "flirting_or_affection", name: "红心", pragmaticRole: "表达喜爱支持与暖心。" },
};
