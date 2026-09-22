# AI 开发指南：社交消息 AI 托管助手

> v2.0 | 2026-09-23
> **这是施工图纸，不是讨论稿。所有决策已定，不要自由发挥。**
> 如果发现本文档没覆盖的情况，停下来问，不要自己脑补方案。

---

## 0. 怎么用这份文档

按 §8 的开发顺序一步步做。每一步都有"验收标准"，过了再往下走。
不要跳步，不要提前做 §8 以外的东西。

---

## 1. 项目是什么

一台 Android 手机，监听一个社交 App（Soul/QQ/陌陌/连信）的消息，
AI 自动读消息、生成回复、粘贴发送。用户可以随时人工接管。

**技术栈：**

| 层 | 用什么 |
|----|--------|
| App 语言 | Kotlin |
| UI | Jetpack Compose |
| 本地库 | Room |
| 网络 | OkHttp + Gson |
| 无障碍 | AccessibilityService |
| 通知监听 | NotificationListenerService |
| 后端 | Cloudflare Pages + Functions（Hono） |
| 数据库 | Cloudflare D1 |
| 配置 | Cloudflare KV |
| LLM | DeepSeek Chat |
| 天气 | 和风天气（免费版） |

**红线（绝对不能做）：**

- 不做 iOS
- 不做内置聊天界面（是托管工具，不是聊天 App）
- 不做语音/视频通话处理
- 不做自研大模型
- 不做流式返回
- 不做 KV 热缓存 + 异步落库
- 不做用户登录/注册系统（用设备钥匙即可）
- AI 不自动跨平台认人（用户手动绑定）
- 不做四平台同时监控（单平台模式，选定一个盯一个）

---

## 2. 整体架构

```
Android App (Kotlin)
  ├── NotificationListenerService  ← 听通知（备胎，用户切走时用）
  ├── AccessibilityService          ← 读屏幕、模拟操作、监听 UI 变化
  ├── Room                          ← 本地缓存、去重指纹、位置配置
  └── OkHttp ──HTTPS──→ Cloudflare Pages
                          ├── Hono API (/api/*)
                          ├── D1 (聊天记录、联系人、钥匙、人设)
                          ├── KV (模型配置、天气缓存)
                          └── Secrets (DeepSeek Key、天气 Key)
```

**关键原则：**
- App 端只做"眼睛和手"：读屏幕、模拟操作、发请求
- 所有智能判断都在云端：拼 prompt、调 LLM、存历史
- **单平台模式**：用户选定一个平台后，AI 只盯这一个，不跳来跳去
- 位置（家庭/工作地址）由 App 端管理，每次请求传过去，后端不存不猜

---

## 3. 后端设计

### 3.1 目录结构

```
backend/
├── functions/
│   └── api/
│       ├── [[route]].ts      # Hono 入口
│       ├── chat.ts           # /api/chat（调 LLM 生成回复）
│       ├── messages.ts        # /api/messages/sync（监控模式同步记录）
│       ├── history.ts        # /api/chat/history（查询/删除记录）
│       ├── contacts.ts       # /api/contacts（白名单管理）
│       ├── persona.ts        # /api/persona（人设切换）
│       ├── config.ts         # /api/config（模型配置）
│       ├── token.ts          # /api/token（设备钥匙管理）
│       └── status.ts         # /api/status（健康检查）
├── src/                      # Dashboard 前端
│   ├── index.html
│   └── app.js
├── db/
│   └── schema.sql
└── wrangler.toml
```

### 3.2 数据库 Schema（直接执行）

```sql
-- 设备钥匙表
CREATE TABLE tokens (
    token       TEXT PRIMARY KEY,
    name        TEXT NOT NULL DEFAULT '',
    monthly_limit INTEGER NOT NULL DEFAULT 30,
    spent       REAL NOT NULL DEFAULT 0,
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    last_used_at INTEGER
);

-- 聊天历史
CREATE TABLE chat_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX idx_chat_session ON chat_history(token, platform, contact_id, created_at);

-- 会话摘要
CREATE TABLE session_summary (
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    summarized_up_to_id INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (token, platform, contact_id)
);

-- 联系人（白名单）
CREATE TABLE contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    is_whitelisted INTEGER NOT NULL DEFAULT 0,
    notes       TEXT DEFAULT '',
    group_id    TEXT DEFAULT '',
    UNIQUE(token, platform, contact_id)
);

-- 人设
CREATE TABLE personas (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    system_prompt TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 0
);

INSERT INTO personas (id, name, system_prompt, is_active) VALUES
('male', '阿杰', '你是阿杰，30岁，餐馆老板。接地气、会聊天、偶尔自嘲。说话带点方言味，不装。', 1),
('female', '小夏', '你是小夏，28岁，公司白领。温柔但不做作，有主见，偶尔有点小幽默。', 0);
```

### 3.3 KV 配置项

| Key | 内容 | 示例 |
|-----|------|------|
| `llm:model` | 模型名 | `deepseek-chat` |
| `llm:base_url` | API 地址 | `https://api.deepseek.com/v1` |
| `llm:temperature` | 温度 | `0.7` |
| `llm:max_tokens` | 最大回复长度 | `300` |
| `weather:cache` | 天气缓存 | `{"temp":15,"condition":"阴天","updated_at":1234567890}` |

**注意：位置（家庭/工作地址）不存后端。App 端自己存，每次调 API 时传过来。**

### 3.4 Secrets（环境变量，不进 KV）

| 变量名 | 内容 |
|--------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `DASHBOARD_PASSWORD` | Dashboard 登录密码 |
| `WEATHER_API_KEY` | 和风天气 API Key |

### 3.5 API 接口定义

**所有接口（除 /api/status）都验证 Token。请求头 `Authorization: Bearer <token>`。**

---

#### POST /api/chat

App 发现新消息，调这个接口拿 AI 回复。

**请求体：**
```json
{
  "platform": "soul",
  "contact_id": "u_12345",
  "contact_name": "风中追风",
  "location": {
    "home": { "city": "重庆", "district": "两江新区" },
    "work": { "city": "重庆", "district": "渝中区" }
  },
  "messages": [
    {"role": "user", "content": "在吗？"},
    {"role": "assistant", "content": "在的，刚忙完"},
    {"role": "user", "content": "周末有空不"}
  ]
}
```

**location 说明：** App 端同时传家庭地址和工作地址。后端不存，直接用。对方问住哪说 home，问工作说 work。

**响应：**
```json
{ "action": "send", "reply": "周末啊，我看一眼排班，应该周六下午有空" }
{ "action": "skip" }
{ "action": "safe_reply", "reply": "这个我不太方便聊，换个话题吧" }
```

---

#### POST /api/messages/sync

**监控模式专用。** 只存记录，不调 LLM、不生成回复。不管 AI 托管开关开没开，只要监控模式开着就调这个接口。

**请求体：**
```json
{
  "platform": "soul",
  "contact_id": "u_12345",
  "contact_name": "风中追风",
  "messages": [
    {"role": "user", "content": "在吗？", "created_at": 1234567890},
    {"role": "assistant", "content": "在的", "created_at": 1234567900}
  ]
}
```

**后端处理：** 直接存 chat_history 表，不调 LLM，返回 `{"ok": true}`。

---

#### GET /api/chat/history?platform=soul&contact_id=u_12345&limit=50

查聊天记录。Dashboard 用。

#### GET/POST/PUT/DELETE /api/contacts

白名单管理。

#### GET/PUT /api/persona

读写人设。GET 返回当前 active + 全部列表。PUT `{"id":"female"}` 切换。

#### GET /api/config

App 启动时拉一次，本地缓存。
```json
{
  "active_persona_id": "male",
  "platform_style_hints": {
    "soul": "偏文艺、走心",
    "qq": "偏年轻、活泼",
    "immomo": "直接、不绕弯",
    "lianxin": "自然、日常"
  }
}
```

#### GET /api/status

```json
{ "status": "ok", "llm_ping": "ok", "platforms": {"soul": "active"} }
```

### 3.6 LLM 调用流程（精确版）

```
收到 /api/chat 请求
  ↓
验证 Token → 无效返回 401
  ↓
查 contacts 表：不在白名单 → 返回 {action: "skip"}
  ↓
查 session_summary 表
  ↓
查 chat_history 表：最近 20 轮（40 条），每条带 created_at
  ↓
算时间差：最后一条 user 消息距现在多久（hours_ago）
  ↓
查天气：
  - 用 App 传的 location.home.city 查天气
  - KV 缓存不到 30 分钟直接用
  - 超过 30 分钟调和风天气 API 更新缓存
  ↓
拼 prompt（见下方结构）
  ↓
调 DeepSeek API（temperature=0.7, max_tokens=300）
  ↓
存 chat_history
  ↓
判断是否重算摘要（新增 10 条后异步重算，不阻塞）
  ↓
返回 {action: "send", reply}
```

**Prompt 拼接结构（必须严格按这个来）：**

```
system:
  {active_persona.system_prompt}
  
  当前平台：{platform}，请用以下语气：{platform_style_hints[platform]}
  
  现在是 {current_datetime}（{weekday}）。
  你住在{location.home.city}{location.home.district}，在{location.work.city}{location.work.district}上班。
  今天{weather_condition}，气温{weather_temp}°C。
  
  回复规则（必须遵守）：
  1. "对方说"是对方发的话，"你说"是你（AI 扮演的人设）之前发的话。不要搞混角色。
  2. 注意当前时间。晚上不说"早上好"，下午不说"刚起床"。
  3. 注意当前天气。冷天不说热，阴天不说太阳大。
  4. 对方聊天气时以对方说的为准。只有对方问"你那边冷不冷"时才说自己这边。
  5. 对方问住在哪 → 说家庭地址（home）。对方问工作在哪 → 说工作地址（work）。
  6. 不要编造与对方消息矛盾的事实。
  7. 如果你很久没回对方，正常说"刚忙完""刚看到消息"。不要说对方消失了——消失的人是你。
  8. 只回复对方最新的这条消息，基于上下文自然接话。

  [如果 hours_ago > 2]
  注意：对方最后一条消息是 {hours_ago} 小时前发的。你一直在忙没回复，现在刚看到。

user/assistant（每条带时间标注）：
  [如果有 summary] 之前的聊天大概是这样：{summary}
  [早上 8:00] 对方说：在吗
  [早上 8:01] 你说：在的
  [晚上 8:30] 对方说：周末有空吗
```

---

## 4. Android 端设计

### 4.1 目录结构

```
android/
├── app/src/main/java/com/aaiagent/
│   ├── App.kt
│   ├── MainActivity.kt
│   ├── core/
│   │   ├── BridgeApp.kt
│   │   └── ServiceManager.kt
│   ├── accessibility/
│   │   ├── AiAccessibilityService.kt
│   │   └── GestureMonitor.kt
│   ├── notification/
│   │   └── NotificationListener.kt
│   ├── adapter/
│   │   ├── PlatformAdapter.kt
│   │   ├── AdapterRegistry.kt
│   │   ├── SoulAdapter.kt
│   │   ├── QQAdapter.kt
│   │   ├── ImmomoAdapter.kt
│   │   └── LianxinAdapter.kt
│   ├── engine/
│   │   ├── MessageEngine.kt
│   │   ├── ConversationContext.kt
│   │   ├── Deduplicator.kt
│   │   ├── PollingFallback.kt
│   │   └── SensitiveWords.kt
│   ├── data/
│   │   ├── RoomDB.kt
│   │   ├── entity/
│   │   ├── repository/
│   │   └── ApiClient.kt
│   ├── ui/
│   │   ├── ConsoleTab.kt
│   │   ├── HistoryTab.kt
│   │   └── SettingsTab.kt
│   └── floating/
│       └── FloatingControl.kt
```

### 4.2 Room 数据库表

```sql
CREATE TABLE cached_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE seen_message (
    fingerprint TEXT PRIMARY KEY,
    seen_at INTEGER NOT NULL
);

CREATE TABLE user_location (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    home_city TEXT NOT NULL DEFAULT '',
    home_district TEXT NOT NULL DEFAULT '',
    work_city TEXT NOT NULL DEFAULT '',
    work_district TEXT NOT NULL DEFAULT ''
);
```

### 4.3 适配器接口（Kotlin，照抄）

```kotlin
interface PlatformAdapter {
    val packageName: String
    fun isInChat(root: AccessibilityNodeInfo): Boolean
    fun isInMessageList(root: AccessibilityNodeInfo): Boolean
    fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage>
    suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String
    ): SendResult
    suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean = true
    ): ConversationInfo?
    suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo)
    suspend fun bringToForeground(service: AccessibilityService)
}

data class ChatMessage(val sender: String, val content: String)
data class ConversationInfo(val contactId: String, val contactName: String, val preview: String)
enum class SendResult { SUCCESS, BANNED, TIMEOUT }
```

### 4.4 SoulAdapter 参考实现

```
isInChat:
  - 查 cn.soulapp.android:id/chat_avatar 和 chat_follow_btn，命中≥2个确认

isInMessageList:
  - 查 cn.soulapp.android:id/item_content_root，找到≥1个确认

readMessages:
  - DirectionHelper.crawlWithDirection 方向爬取
  - 过滤时间文本、系统提示
  - 左右侧判断：右侧=自己，左侧=对方

fillAndSend:
  1. 找输入框 et_sendmessage
  2. ACTION_SET_TEXT 填入文本
  3. 等 btn_send 出现
  4. 点击发送
  5. 检测"发送失败""已被禁言"→ BANNED
  6. 3秒没出现 → TIMEOUT

clickFirstUnreadConversation:
  1. 递归遍历 ViewGroup
  2. 找纯数字未读标记
  3. 读昵称和预览，先筛白名单
  4. MD5 指纹去重
  5. performAction(CLICK)
```

### 4.5 消息处理引擎（主状态机）

```kotlin
sealed class EngineState {
    object Idle : EngineState()
    object ScanningConversations : EngineState()
    object ReadingMessages : EngineState()
    object WaitingLLM : EngineState()
    object AboutToSend : EngineState()
    object Sending : EngineState()
    object UserInChatRoom : EngineState()   // 用户手动点进聊天页，AI 旁观
    object Paused : EngineState()
    object Error : EngineState()
}

object MessageEngine {
    var state: EngineState = Idle
    var currentPlatform: String = ""
    var monitorMode: Boolean = false   // 监控模式：只同步记录，不调 LLM

    // 页面变化检测：区分 AI 自己点的 vs 用户点的
    fun onPageChanged(isInChatRoom: Boolean) {
        if (isInChatRoom && state == Idle) {
            state = UserInChatRoom  // 用户手动点进聊天页
        } else if (!isInChatRoom && state == UserInChatRoom) {
            state = Idle  // 用户退出聊天页，恢复
        }
    }

    fun onNewMessage(contactId: String, rawText: String) {
        if (state == UserInChatRoom || state == Paused) return

        // 监控模式：只存记录
        if (monitorMode) {
            CoroutineScope(Dispatchers.IO).launch {
                val messages = readLatestMessages(contactId)
                apiClient.syncMessages(currentPlatform, contactId, messages)
            }
            return
        }

        // 去重 + 版本号 + 短窗口启动
        val fp = md5(currentPlatform + contactId + rawText)
        if (deduplicator.isSeenRecent(fp, 5*60_000)) return
        deduplicator.markSeen(fp)

        val ctx = getOrCreateContext(currentPlatform, contactId)
        synchronized(ctx) {
            ctx.llmRequestId++
            if (ctx.firstMessageAt == 0L) ctx.firstMessageAt = now()
        }

        CoroutineScope(Dispatchers.IO).launch {
            delay(500)
            processConversation(ctx)
        }
    }

    // processConversation：
    // 1. 点未读会话 → 2. 读消息 → 3. 敏感词检查 → 4. 调 LLM
    // 5. LLM 返回后对比版本号：变了就作废旧回复重算
    // 6. 重算≥3次 或 超过8秒 → 强制发送
    // 7. 发送前100ms检查用户有没有碰屏幕
    // 8. 发完退回消息列表
}
```

### 4.6 消息合并策略

**不傻等去抖，用"快速启动 + 过期作废"：**

- 收到第一条 → 500ms 短窗口 → 开始调 LLM
- LLM 调用中来了新消息 → llmRequestId++ → 旧回复作废
- LLM 返回对比版本号：变了就重新读消息重算
- 重算≥3次 或 从首条消息起>8秒 → 强制发送

### 4.6.1 拆句发送（伪装真人打字）

**AI 生成的完整回复不要一次性发出去，拆成短句一句一句发，模拟真人聊天节奏。**

**拆句规则：**
- 按句号、问号、感叹号、换行拆成短句
- 短回复（≤1句或≤15个字）→ 不拆，直接发
- 长回复（>3句）→ 拆成短句逐句发
- 超过5句 → 不拆，直接发整段（太长不像真人）

**发送节奏：**
- 每发一句后等 1-2 秒（随机，模拟真人打字速度）
- 每句发送前都要过 100ms 触摸检查
- 中间如果用户碰屏幕 → 停止发送，清空输入框

**示例：**
```
AI 生成："在的，刚忙完。你周末有空吗？我想约你出来吃饭。"

拆成三句：
  1. "在的，刚忙完。"        → 发送
  2. 等 3 秒
  3. "你周末有空吗？"        → 发送
  4. 等 2 秒
  5. "我想约你出来吃饭。"    → 发送
```

**sendReply 改成：**
```kotlin
private suspend fun sendReply(
    adapter: PlatformAdapter,
    root: AccessibilityNodeInfo,
    text: String
) {
    val sentences = splitSentences(text)
    for (sentence in sentences) {
        // 每句发送前检查用户有没有碰屏幕
        delay(100)
        if (GestureMonitor.isUserTouchingRecently(100)) {
            clearInput(root)
            notifyUser("你在用手机，已取消")
            return
        }
        adapter.fillAndSend(service, root, sentence)
        if (sentences.indexOf(sentence) < sentences.size - 1) {
            delay(1000 + Random.nextInt(1000))  // 1-2秒随机
        }
    }
}

private fun splitSentences(text: String): List<String> {
    // 按 。？！！\n 拆句，保留标点
    // 如果只有1句或<15字，返回整段
    // 如果>5句，返回整段
}
```

### 4.7 本地敏感词表

```kotlin
object SensitiveWords {
    private val words = listOf(
        "钱", "转账", "汇款", "银行卡", "账号", "密码",
        "验证码", "支付宝", "微信支付", "红包", "刷单",
        "贷款", "借款", "投资", "理财", "点击链接",
        "http://", "https://", "加微信", "加v", "加群"
    )
    fun isHit(text: String) = words.any { text.contains(it) }
}
```

### 4.8 悬浮窗

- 屏幕右边缘中间，8dp 小圆点
- 单击：开/关托管（短震动）
- 长按：打开 App 主界面
- 拖动：沿边缘吸附
- 颜色：绿=托管中 / 灰=暂停 / 红闪=异常

### 4.9 UI 设计原则

**触控反馈：**
- 所有按钮点下去有视觉变化（变深/缩放 0.95）
- 重要操作有短震动
- 开关切换有 200ms 过渡动画

**颜色写死：**

| 状态 | 颜色 |
|------|------|
| 开启/运行中 | 绿色 #22C55E |
| 关闭/空闲 | 灰色 #9CA3AF |
| 异常/警告 | 红色 #EF4444 |
| 选中 | 蓝色 #3B82F6 |
| 未选中 | 白色/浅灰 |

### 4.10 全品牌兼容性

**点击方式硬性规定：**
- 禁止硬编码像素坐标
- 优先用 `AccessibilityNodeInfo.performAction(ACTION_CLICK)`
- 必须用坐标时，从 `boundsInScreen.centerX/Y` 算
- 输入用 `ACTION_SET_TEXT`，不用模拟粘贴

**各品牌保活引导（按 Build.MANUFACTURER 检测）：**

| 品牌 | 必须引导用户开的设置 |
|------|---------------------|
| 小米/MIUI | 自启动 + 电池无限制 + 最近任务加锁 |
| 华为/HarmonyOS | 启动管理改手动 + 电池不优化 + 加锁 |
| OPPO/ColorOS | 自启动 + 电池不优化 + 关应用速冻 + 加锁 |
| vivo/OriginOS | 自启动 + i管家允许后台高耗电 + 加锁 |
| 三星/OneUI | 电池不受限 |

**Android 版本适配：**
- Android 11：Manifest 写 `<queries>` 声明包名
- Android 12：声明 `foregroundServiceType`
- Android 13：动态申请 `POST_NOTIFICATIONS`
- Android 14：前台服务类型必须正确

### 4.11 保活

1. 前台服务（常驻通知）
2. 悬浮窗（额外标记）
3. 开机自启（BOOT_COMPLETED）

---

## 5. 安全与风控

| 场景 | 做法 |
|------|------|
| API 鉴权 | 请求头 Bearer Token，D1 查 tokens 表 |
| API Key | 放 Cloudflare Secrets，不放 KV |
| 防重复回复 | md5(platform+contactId+content)，5分钟窗口 |
| 白名单 | 后端查 contacts 表，不在白名单返回 skip |
| 超时 | 单次 150 秒 |
| 违规弹窗 | fillAndSend 返回 BANNED → 关弹窗 → 暂停平台 |
| 敏感词 | App 本地词表优先，命中不走 LLM |
| 人工接管 | 发送前 100ms 触摸检测；打断时清空输入框 |
| 用户旁观 | onPageChanged 检测用户手动进聊天页 → UserInChatRoom |
| 天气 | 和风天气 API，30分钟缓存 |

---

## 6. 开发顺序与验收标准

### Step 1: 后端骨架
- 创建 Pages 项目，执行 schema.sql
- 配置 KV、Secrets
- 写通 /api/chat、/api/status、/api/config、/api/messages/sync
- 写通 /api/contacts、/api/persona、/api/token

**验收：** curl 调 /api/chat 能拿到 DeepSeek 回复；白名单外返回 skip。

### Step 2: App 骨架
- Kotlin + Compose 三个 Tab
- 悬浮窗 + 前台服务
- 无障碍服务 + 通知监听（只监听不操作）
- 输入 Token 的设置页
- OkHttp 调通 /api/chat

**验收：** 悬浮窗能开关；收到 Soul 通知能 logcat 打出来。

### Step 3: Soul 端到端
- 实现 SoulAdapter 七个方法
- 实现 MessageEngine 状态机
- 实现去重、敏感词、发送前触摸检测
- 实现 onPageChanged 用户旁观模式
- 实现监控模式 monitorMode 分支

**验收：** 给 Soul 白名单联系人发消息 → 自动读 → 调 AI → 粘贴发送；用户手动点进聊天页 AI 旁观；退出后自动恢复。

### Step 4: 扩展
- QQ/陌陌/连信适配器
- Dashboard 前端
- 全品牌保活引导页

---

## 7. 提前警告：这些坑一定会遇到

1. 通知不稳定 → 单平台模式下 UI 事件监听为主，通知为辅
2. 半截消息 → 发送前 100ms 检查 + 打断清空输入框
3. 连续消息 → 500ms 短窗口 + 版本号作废重算
4. 误回陌生人 → 消息列表先筛白名单
5. 平台更新改 UI → ≥2 个 View ID 交叉验证
6. 被封号 → 动作间 delay 500-1500ms 模拟真人
7. App 被杀 → 前台服务 + 悬浮窗 + 开机自启 + 品牌引导
8. 坐标偏移 → 禁止硬编码坐标，一律用节点 performAction
9. 各品牌杀后台 → 按 Build.MANUFACTURER 显示对应引导
10. Android 11 找不到其他 App → Manifest 写 <queries>
11. Android 13 通知不弹 → 动态申请 POST_NOTIFICATIONS
12. 时间感错乱 → prompt 必须传当前时间 + 历史消息带时间戳
13. 长期未回复角色搞反 → system 规则明确"消失的人是你"
14. 编造矛盾事实 → system 规则"不要与对方矛盾"

---

## 8. 默认参数（写死，不要改）

| 参数 | 值 |
|------|-----|
| 首条短窗口 | 500ms |
| LLM 重算上限 | 3 次 |
| 最大等待时间 | 8 秒 |
| 去重窗口 | 5 分钟 |
| 单次超时 | 150 秒 |
| 原文窗口 | 20 轮（40 条） |
| 摘要重算触发 | 新增 10 条 |
| 摘要长度 | ≤ 200 字 |
| 发送前检查 | 100ms |
| 轮询间隔 | 30 秒 |
| 通知失效阈值 | 连续 10 次未收到 → 启用轮询 |
| 天气缓存 | 30 分钟 |
| 长时间未回复阈值 | > 2 小时加提示 |
| temperature | 0.7 |
| max_tokens | 300 |
| 动作间 delay | 500-1500ms（随机） |
| 拆句间隔 | 1-2 秒随机 |
| 拆句阈值 | ≤1句或<15字不拆；>5句不拆 |
