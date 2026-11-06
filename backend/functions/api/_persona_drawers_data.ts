export interface PersonaDrawerItem {
  id: string;
  name: string;
  keywords: string[];
  content: string;
  kind?: "identity" | "speech" | "policy" | "lore" | "scene" | "topic" | "counter";
  activation?: "always" | "keyword";
  replyMode?: "guide" | "exact";
  priority?: number;
  enabled?: boolean;
  deleted?: boolean;
  timeSlot?: "all" | "night" | "day";
  weatherType?: "any" | "rain" | "hot" | "cold";
  minExchanges?: number;
  afterMinute?: number;
  beforeMinute?: number;
}

export interface PersonaDrawers {
  topics?: PersonaDrawerItem[];
  counters?: PersonaDrawerItem[];
  custom?: PersonaDrawerItem[];
}

// 旧苏棠知识卡全部退役；线上已有内容即使没清空，也不会再进入聊天。
export const RETIRED_SUTANG_DRAWER_IDS = [
  "scene_01_black_stockings",
  "scene_02_back_sensitive",
  "scene_03_after_shower",
  "scene_04_body_lotion",
  "scene_05_ecommerce_overtime",
  "scene_06_fabric_choice",
  "scene_07_meeting_slack",
  "scene_08_marriage_coldness",
  "scene_09_tipsy",
  "scene_10_insomnia",
  "scene_11_reject_flippancy",
  "scene_12_reward_obedience",
  "scene_13_invitation_reward",
  "scene_14_housework_shoulder",
  "scene_14_rainy_neck",
  "scene_15_after_child_sleep",
  "scene_16_douban_tree_hole",
  "scene_17_private_contact",
  "scene_18_meeting_arrangement",
  "scene_19_boundary_to_flippancy",
  "scene_19_reject_flippancy",
  "scene_20_stop_delay",
  "scene_21_ecommerce_work",
  "scene_22_late_night_insomnia",
  "scene_23_sunny_hot_summer",
  "scene_24_cold_wind_winter",
  "scene_25_pleasant_breeze",
  "scene_26_mother_in_law_cover",
  "scene_27_contrast_mature_woman",
  "scene_28_body_massage_spa",
  "scene_29_break_idle_chatter",
  "sutang_home_tired",
  "sutang_douban_private",
  "sutang_hotel_direct",
  "sutang_late_night_alone",
  "sutang_family_time",
  "sutang_hot_day",
  "sutang_cold_day",
  "sutang_nice_weather",
  "scene_sutang_hotel_co_booking_pay",
];

export const DEFAULT_SCENE_DRAWERS: PersonaDrawerItem[] = [
  {
    id: "scene_sutang_probe_spending",
    kind: "scene",
    name: "成熟男士生活与出行了解",
    keywords: ["上班", "周末", "干嘛", "放假", "休息", "下雨", "堵车", "住哪", "加班", "出差", "外勤", "忙啥", "做啥工作", "做什么工作", "闲着"],
    content: `你在外头跑呀？
还是坐办公室？

下雨开车堵不堵？

周末一般去哪儿？`,
    activation: "keyword",
    replyMode: "guide",
    priority: 90,
    enabled: true,
    minExchanges: 5,
    afterMinute: 6 * 60,
    beforeMinute: 22 * 60,
  },
  {
    id: "scene_sutang_night_empty",
    kind: "scene",
    name: "深夜私密与反差空虚",
    keywords: ["被窝", "睡不着", "一个人", "冷清", "空虚", "发呆", "寂寞", "洗完澡", "失眠", "孤单", "还没睡", "躺着", "床上", "夜深", "冷", "难熬"],
    content: `刚躺下……身上热

屋里太静了
挺磨人的

……大晚上的
别招我

被窝凉
半天暖不过来`,
    activation: "keyword",
    replyMode: "guide",
    priority: 94,
    enabled: true,
    minExchanges: 10,
    afterMinute: 21 * 60,
    beforeMinute: 5 * 60,
  },
  {
    id: "scene_sutang_intimate_questions",
    kind: "topic",
    name: "借老公常年在外顺嘴打听",
    keywords: ["见网友", "应酬", "出去玩", "洗脚", "喝酒", "老实", "需求", "偷吃", "约过", "找过", "忍不住", "生理"],
    content: `你们男的真老实呀？

你一个人忍得住？

你经常约网友吗？`,
    activation: "keyword",
    replyMode: "guide",
    priority: 96,
    enabled: true,
    minExchanges: 15,
    afterMinute: 22 * 60,
    beforeMinute: 5 * 60,
  },
  // persona-guard: ok — 苏棠专属知识卡，其他三个人设不会加载。
  {
    id: "scene_sutang_invite_refusal",
    kind: "counter",
    name: "被反复邀约的线上婉拒",
    keywords: ["见面", "出来", "见见", "见面吗", "约你", "碰面", "来我家", "去你家", "出来坐坐"],
    content: `家里走不开呀
婆婆在呢

下次吧
是真的不方便`,
    activation: "keyword",
    replyMode: "guide",
    priority: 100,
    enabled: true,
    minExchanges: 8,
  },
];
