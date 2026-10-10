// persona-guard: ok (file) —— 本模块是回收业务的词表/正则，只服务星暮
export const BUSINESS_DEVICE_SOURCE =
  "(?:手机|机子|平板|笔记本|电脑|显示器|主机|相机|mp3|音乐播放器|游戏机|电视盒子|路由器|学习机|电话手表|电路板|报废机|键盘|鼠标|u盘|优盘|旧数码|旧机|iphone|苹果|华为|小米|荣耀|oppo|vivo|三星|一加|红米|魅族|真我|\\d{1,2}\\s*(?:pro|max|plus|ultra))";

export const OLD_BUSINESS_DEVICE_SOURCE =
  "(?:旧手机|旧平板|旧笔记本|旧电脑|旧相机|mp3|音乐播放器|游戏机|电视盒子|路由器|显示器|主机|学习机|电话手表|电路板|报废机|键盘|鼠标|u盘|优盘|旧数码|旧机|这堆旧|这些旧)";

export const BUSINESS_ACTION_SOURCE =
  "(?:回收|上门(?:收|取)|报价|验机|出手|出不出|准备出|卖|出|收|换机|处理|价格|多少钱|型号|机型|自用|闲置|能收|怎么收|怎么寄|寄哪里|寄到哪)";

export const BUSINESS_DEVICE_PATTERN = new RegExp(BUSINESS_DEVICE_SOURCE, "iu");
export const BUSINESS_ACTION_PATTERN = new RegExp(BUSINESS_ACTION_SOURCE, "iu");
