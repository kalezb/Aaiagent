import { latestIncomingText } from "./_message_text";

export interface CustomerDialogueSlots {
  ageKnown: boolean;
  ageValue: string;
  ageProbedRecently: boolean;

  maritalKnown: boolean;
  maritalValue: string;
  maritalProbedRecently: boolean;

  locationKnown: boolean;
  locationValue: string;
  locationProbedRecently: boolean;

  workKnown: boolean;
  workValue: string;
  workProbedRecently: boolean;

  hisPhotoKnown: boolean;
  hisPhotoProbedRecently: boolean;
}

export const EMPTY_CUSTOMER_SLOTS: CustomerDialogueSlots = {
  ageKnown: false,
  ageValue: "",
  ageProbedRecently: false,
  maritalKnown: false,
  maritalValue: "",
  maritalProbedRecently: false,
  locationKnown: false,
  locationValue: "",
  locationProbedRecently: false,
  workKnown: false,
  workValue: "",
  workProbedRecently: false,
  hisPhotoKnown: false,
  hisPhotoProbedRecently: false,
};

const USER_AGE_PATTERN = /(?:我|本人|俺)(?:今年|现在|目前)?(\d{1,2})岁/u;
const USER_AGE_STANDALONE_PATTERN = /^(?:我)?(\d{1,2})(?:岁|了)[。！？!?]*$/u;
const USER_GENERATION_PATTERN = /(?:80后|90后|95后|00后)/u;
const USER_UNCLE_OR_YOUNGER = /(?:我(?:是|算)?(?:大叔|小鲜肉|弟弟|年轻)|(?:我)?比你大|(?:我)?比你小)/u;

const ASSISTANT_AGE_PROBE = /(?:多大(?:了|啦|呀|啊|呢)?|几几年(?:的)?|大叔还是弟弟|大叔还是小鲜肉|比我大还是比我小|你几岁)/u;

const USER_SINGLE_PATTERN = /(?:单身|单身汉|未婚|没结婚|没有结婚|没结过婚|离异|离婚|一个人住|自己住|独居|还没结婚)/u;
const USER_MARRIED_PATTERN = /(?:已婚|结婚了|有老婆|有媳妇|家里那位)/u;

const ASSISTANT_MARITAL_PROBE = /(?:结婚(?:了)?(?:没|没有|吗|嘛)|成家(?:了)?(?:没|没有|吗|嘛)|单身(?:吗|嘛)|(?:家里|老婆|媳妇|那位).{0,6}(?:查岗|管你|管不管)|一个人住(?:吗|嘛|不)?)/u;

const USER_LOCATION_PATTERN = /(?:我|本人|俺)?(?:现在)?(?:家住|住(?:在)?|定居在)(?:在)?([\u4e00-\u9fa5A-Za-z0-9]{2,16}(?:区|县|镇|街道|小区|路))/u;
const USER_DISTRICT_PATTERN = /(?:我在|住在|靠近|在)(渝北|江北|渝中|南岸|沙坪坝|九龙坡|大渡口|北碚|巴南|两江新区|大学城|观音桥|解放碑|金开|照母山|中央公园|大竹林|冉家坝|回兴)/u;
const USER_CITY_PATTERN = /(?:重庆本地|在重庆|重庆人)/u;

const ASSISTANT_LOCATION_PROBE = /(?:住(?:在)?哪(?:边|个区|里)?|在哪个区|离我远不远|你哪里的|是本地人吗|你在哪一片)/u;

const USER_WORK_PATTERN = /(?:做|搞)(?:IT|金融|工程|销售|设计|程序员|代码|技术|自媒体|生意|餐饮|建筑|外贸|电商|运营)/u;
const USER_WORK_EMPLOYED_PATTERN = /(?:在|去)(?:公司|厂里|外企|国企|事业单位|医院|学校)上班/u;
const USER_WORK_BUSINESS_PATTERN = /(?:自己开店|自由职业|做点小生意|做生意|跑业务)/u;

const ASSISTANT_WORK_PROBE = /(?:做什[么麽]工作|平时做什[么麽]|做哪一行|上班还是创业|什[么麽]职业)/u;

const ASSISTANT_PHOTO_PROBE =
  /(?:发.{0,4}(?:照片|近照|寸照|相片|自拍)|(?:看|瞧).{0,4}(?:你|你的).{0,4}(?:照片|近照|寸照|长相|样子)|(?:还没|没).{0,4}(?:见|看到|看过).{0,6}(?:照片|近照|寸照|样子|长相)|(?:照片|近照|寸照|相片|自拍).{0,6}(?:发|给|看|瞧)|发张照|爆照)/u;

/**
 * 提取对话中的槽位状态（DST - Dialogue State Tracking）
 */
export function extractCustomerDialogueSlots(options: {
  customerProfile?: any;
  contact?: any;
  messages?: any[];
  historyMessages?: any[];
  hisPhotoOnFile?: boolean;
}): CustomerDialogueSlots {
  const profile = options.customerProfile || {};
  const contact = options.contact || {};
  const messages = Array.isArray(options.messages) ? options.messages : [];
  const history = Array.isArray(options.historyMessages) ? options.historyMessages : [];

  const slots: CustomerDialogueSlots = { ...EMPTY_CUSTOMER_SLOTS };

  // 1. 照片槽位判断
  if (options.hisPhotoOnFile || (Number(contact.his_photo_at) > 0)) {
    slots.hisPhotoKnown = true;
  }

  // 2. 年龄槽位判断
  const profileAge = String(profile.basic?.age || "").trim();
  if (profileAge) {
    slots.ageKnown = true;
    slots.ageValue = profileAge.endsWith("岁") ? profileAge : `${profileAge}岁`;
  }

  // 3. 婚姻感情槽位判断
  const profileMarital = String(profile.family?.marital_status || "").trim();
  const contactMarital = String(contact.marital_status || "").trim();
  if (contact.marital_checked === 1 || profileMarital || contactMarital) {
    slots.maritalKnown = true;
    slots.maritalValue = profileMarital || contactMarital || (contact.marital_checked === 1 ? "已确认" : "");
  }

  // 4. 地址槽位判断
  const profileResidence = String(profile.location?.residence || "").trim();
  const profileCity = String(profile.location?.city || "").trim();
  if (profileResidence || profileCity) {
    slots.locationKnown = true;
    slots.locationValue = profileResidence || profileCity;
  }

  // 5. 工作槽位判断
  const profileWork = String(profile.work?.role || profile.work?.company || profile.work?.industry || "").trim();
  if (profileWork) {
    slots.workKnown = true;
    slots.workValue = profileWork;
  }

  // 遍历历史消息与本轮消息做纯代码补充识别（防止异步落库延迟）
  const allMessages = [...history, ...messages];
  const userTexts: string[] = [];
  const assistantTexts: string[] = [];

  for (const msg of allMessages) {
    if (!msg) continue;
    const isUser = msg.role === "user" || msg.sender === "user" || msg.sender === "peer";
    const text = String(msg.content || "").trim();
    if (isUser) {
      userTexts.push(text);
      if (
        msg.type === "image" ||
        msg.media_type === "image" ||
        text.includes("[图片]") ||
        text.includes("he_sent_photo")
      ) {
        slots.hisPhotoKnown = true;
      }
    } else {
      assistantTexts.push(text);
    }
  }

  // 从用户文本中纯代码扫描
  for (const text of userTexts) {
    if (!slots.ageKnown) {
      const ageMatch = text.match(USER_AGE_PATTERN) || text.match(USER_AGE_STANDALONE_PATTERN);
      if (ageMatch && ageMatch[1]) {
        slots.ageKnown = true;
        slots.ageValue = `${ageMatch[1]}岁`;
      } else if (USER_GENERATION_PATTERN.test(text)) {
        slots.ageKnown = true;
        slots.ageValue = text.match(USER_GENERATION_PATTERN)![0];
      } else if (USER_UNCLE_OR_YOUNGER.test(text)) {
        slots.ageKnown = true;
        slots.ageValue = "已说明长幼辈分";
      }
    }

    if (!slots.maritalKnown) {
      if (USER_SINGLE_PATTERN.test(text)) {
        slots.maritalKnown = true;
        slots.maritalValue = "单身/独居";
      } else if (USER_MARRIED_PATTERN.test(text)) {
        slots.maritalKnown = true;
        slots.maritalValue = "已婚";
      }
    }

    if (!slots.locationKnown) {
      const locMatch = text.match(USER_LOCATION_PATTERN);
      const distMatch = text.match(USER_DISTRICT_PATTERN);
      if (locMatch && locMatch[1]) {
        slots.locationKnown = true;
        slots.locationValue = locMatch[1].replace(/^(?:在|住在)/u, "").trim();
      } else if (distMatch && distMatch[1]) {
        slots.locationKnown = true;
        slots.locationValue = distMatch[1].replace(/^(?:在|住在)/u, "").trim();
      } else if (USER_CITY_PATTERN.test(text)) {
        slots.locationKnown = true;
        slots.locationValue = "重庆本地";
      }
    }

    if (!slots.workKnown) {
      if (USER_WORK_PATTERN.test(text)) {
        slots.workKnown = true;
        slots.workValue = text.match(USER_WORK_PATTERN)![0];
      } else if (USER_WORK_EMPLOYED_PATTERN.test(text)) {
        slots.workKnown = true;
        slots.workValue = "上班族";
      } else if (USER_WORK_BUSINESS_PATTERN.test(text)) {
        slots.workKnown = true;
        slots.workValue = "做生意/自由职业";
      }
    }
  }

  // 检查最近 10 轮 assistant 是否已经主动探询过该槽位（避免重复询问）
  const recentAssistantTexts = assistantTexts.slice(-10);
  for (const reply of recentAssistantTexts) {
    if (ASSISTANT_AGE_PROBE.test(reply)) slots.ageProbedRecently = true;
    if (ASSISTANT_MARITAL_PROBE.test(reply)) slots.maritalProbedRecently = true;
    if (ASSISTANT_LOCATION_PROBE.test(reply)) slots.locationProbedRecently = true;
    if (ASSISTANT_WORK_PROBE.test(reply)) slots.workProbedRecently = true;
    if (ASSISTANT_PHOTO_PROBE.test(reply)) slots.hisPhotoProbedRecently = true;
  }

  return slots;
}

/**
 * 守门员：判断某张知识库卡片是否在主动探询已知槽位。
 * 若卡片在探询已知槽位，物理切断，绝对不送入提示词！
 */
export function isDrawerProbingKnownSlot(content: string, slots: CustomerDialogueSlots): boolean {
  const text = String(content || "");
  if (!text) return false;

  // 1. 年龄已知或刚问过 -> 跳过任何探询年龄的卡片
  if (slots.ageKnown || slots.ageProbedRecently) {
    if (ASSISTANT_AGE_PROBE.test(text)) return true;
  }

  // 2. 婚姻已知或刚问过 -> 跳过查岗、婚姻、独居探询卡片
  if (slots.maritalKnown || slots.maritalProbedRecently) {
    if (ASSISTANT_MARITAL_PROBE.test(text)) return true;
  }

  // 3. 位置已知或刚问过 -> 跳过住址探询卡片
  if (slots.locationKnown || slots.locationProbedRecently) {
    if (ASSISTANT_LOCATION_PROBE.test(text)) return true;
  }

  // 4. 工作已知或刚问过 -> 跳过工作探询卡片
  if (slots.workKnown || slots.workProbedRecently) {
    if (ASSISTANT_WORK_PROBE.test(text)) return true;
  }

  // 5. 照片已有或刚问过 -> 跳过索要照片卡片
  if (slots.hisPhotoKnown || slots.hisPhotoProbedRecently) {
    if (ASSISTANT_PHOTO_PROBE.test(text)) return true;
  }

  return false;
}

/**
 * 构建提示词中的硬约束：“已确认的男方档案・绝对禁止重复发问”
 */
export function buildCustomerSlotsConstraintPrompt(slots: CustomerDialogueSlots): string {
  const constraints: string[] = [];

  if (slots.ageKnown) {
    constraints.push(`- 年龄已明确【${slots.ageValue}】：绝对禁止再问“多大、几岁、大叔还是弟弟、比我大还是比我小”！`);
  } else if (slots.ageProbedRecently) {
    constraints.push(`- 年龄前面已问过：禁止再次追问，聊其他生活话题。`);
  }

  if (slots.maritalKnown) {
    constraints.push(`- 婚姻状况已明确【${slots.maritalValue}】：绝对禁止再问“结婚没、家里查岗不、老婆管不管、一个人住吗”！`);
  } else if (slots.maritalProbedRecently) {
    constraints.push(`- 婚姻感情前面已探过：禁止再反复查问。`);
  }

  if (slots.locationKnown) {
    constraints.push(`- 居住位置已明确【${slots.locationValue}】：绝对禁止再问“住哪边、在哪个区、离我远不远、是本地人吗”！`);
  } else if (slots.locationProbedRecently) {
    constraints.push(`- 居住位置前面已问过：禁止再次追问住址。`);
  }

  if (slots.workKnown) {
    constraints.push(`- 工作职业已明确【${slots.workValue}】：绝对禁止再问“做啥工作、平时忙什么、上班还是做生意”！`);
  } else if (slots.workProbedRecently) {
    constraints.push(`- 工作职业前面已问过：禁止再次追问职业。`);
  }

  if (slots.hisPhotoKnown) {
    constraints.push(`- 男方照片已明确已看过：绝对禁止再向男方索要照片（如“发张照片看看、长啥样”）！`);
  } else if (slots.hisPhotoProbedRecently) {
    constraints.push(`- 男方照片前面刚要过：禁止连续催要照片。`);
  }

  if (constraints.length === 0) return "";

  return `【已确认的男方档案・绝对禁止重复发问（物理红线）】\n${constraints.join("\n")}`;
}

/**
 * 物理安全网：发出前清洗（Post-LLM Output Sanitizer）
 * 如果模型仍幻觉输出了已知槽位的探询问句，物理剪除该问句！
 */
export function sanitizeKnownSlotInquiries(reply: string, slots: CustomerDialogueSlots): string {
  let text = String(reply || "").trim();
  if (!text) return text;

  const segments = text.split("|||");
  const cleanedSegments = segments.map((segment) => {
    let seg = segment.trim();

    // 1. 年龄已知或刚问过
    if (slots.ageKnown || slots.ageProbedRecently) {
      seg = seg.replace(/(?:(?:对了|冒昧问下|好奇问下|想问下|问一下|那|那你是).{0,4})?(?:你)?(?:多大(?:了|啦|呀|啊|呢)?|几几年(?:的)?|是大叔还是弟弟|是大叔还是小鲜肉|大叔还是弟弟|大叔还是小鲜肉|比我大还是比我小|你几岁)(?:[呀啊呢么吧嘛][？?]|\s*[？?]|(?:了|啦|呀|啊|呢|么|吧|嘛))*[？?]?/gu, "");
    }

    // 2. 婚姻已知或刚问过
    if (slots.maritalKnown || slots.maritalProbedRecently) {
      seg = seg.replace(/(?:(?:大半夜(?:跟我就?聊|聊|说话)?|这么晚(?:跟我就?聊|聊)?|大晚上|平时|你平时).{0,6})?(?:(?:你)?(?:家里|老婆|媳妇|那位|另一半).{0,6}(?:查岗|管你|管不管|发现|生气)|(?:你)?(?:结婚|成家|成家了|结了|单身).{0,4}(?:没|没有|吗|嘛|吧|么)|(?:是|平时)?一个人住(?:吗|嘛|么|不)?)(?:[呀啊呢么吧嘛][？?]|\s*[？?]|(?:了|啦|呀|啊|呢|么|吧|嘛))*[？?]?/gu, "");
    }

    // 3. 位置已知或刚问过
    if (slots.locationKnown || slots.locationProbedRecently) {
      seg = seg.replace(/(?:(?:对了|想问下|问一下|那).{0,4})?(?:你)?(?:住(?:在)?哪(?:边|个区|里)?|在哪个区|离我远不远|你哪里的|是本地人吗|你在哪一片)(?:[呀啊呢么吧嘛][？?]|\s*[？?]|(?:了|啦|呀|啊|呢|么|吧|嘛))*[？?]?/gu, "");
    }

    // 4. 工作已知或刚问过
    if (slots.workKnown || slots.workProbedRecently) {
      seg = seg.replace(/(?:(?:对了|想问下|问一下|那).{0,4})?(?:你)?(?:做什[么麽]工作|平时做什[么麽]|做哪一行|上班还是创业|什[么麽]职业)(?:[呀啊呢么吧嘛][？?]|\s*[？?]|(?:了|啦|呀|啊|呢|么|吧|嘛))*[？?]?/gu, "");
    }

    // 5. 照片已有或刚问过
    if (slots.hisPhotoKnown || slots.hisPhotoProbedRecently) {
      seg = seg.replace(/(?:(?:对了|想问下|问一下|那).{0,4})?(?:发张照片(?:看看|瞧瞧)?|看看你长相|长啥样(?:呀|啊)?|发张照(?:片)?|看看你照片|给我发张照片)(?:[呀啊呢么吧嘛][？?]|\s*[？?]|(?:了|啦|呀|啊|呢|么|吧|嘛))*[？?]?/gu, "");
    }

    // 清理残余标点和空格
    return seg
      .replace(/^[，,。！？!?\s]+/u, "")
      .replace(/[，,\s]+$/u, "")
      .trim();
  }).filter((seg) => seg.length > 0);

  if (cleanedSegments.length === 0) {
    // 若整句全是重复提问被全部削掉，则给一句顺畅的大白话自然接话
    return "挺好的";
  }

  return cleanedSegments.join("|||");
}
