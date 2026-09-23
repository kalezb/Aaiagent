# AI 开发指南：社交消息 AI 托管助手（完整版）

> 合并版 | 2026-09-24
> **这是施工图纸，不是讨论稿。所有决策已定，不要自由发挥。**
> 如果发现本文档没覆盖的情况，停下来问，不要自己脑补方案。

---

## 0. 怎么用这份文档

**先把全文读一遍**，理解整体架构和所有约定，再按第 10 章的开发顺序一步步做。
每一步都有"验收标准"，过了再往下走。
不要跳步，不要提前做第 10 章 Step 1-3 以外的东西。
如果发现本文档没覆盖的情况，**停下来问**，不要自己脑补方案。

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

data class ChatMessage(
    val sender: String,      // "me" 或 "them"
    val content: String,    // 消息文字
    val type: MessageType    // TEXT / IMAGE / VOICE / STICKER / SYSTEM
)
data class ConversationInfo(val contactId: String, val contactName: String, val preview: String)
enum class SendResult { SUCCESS, BANNED, TIMEOUT }
enum class MessageType { TEXT, IMAGE, VOICE, STICKER, SYSTEM }

// readMessages 只返回对方发的消息（sender == "them"），自己发的不要返回
```

### 4.4 消息处理引擎（主状态机）

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

    // 触发方式：
    // 1. 消息列表里扫到未读会话 → 点进去 → 读消息 → 调 LLM
    // 2. 通知监听到新消息 → 也走这个流程
    // 两种触发最终都走 processConversation

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

    // processConversation 完整流程（对应第 5 章托管循环）：
    // 1. 确保在消息列表页（不在就 navigateToMessageList）
    // 2. 扫未读 → 找到就点进去（clickFirstUnreadConversation）
    // 3. 等 1 秒 → 确认进了聊天页
    // 4. 读消息（readMessages）→ 只取对方发的
    // 5. 敏感词检查 → 命中就回安全话术
    // 6. 调 /api/chat 拿 AI 回复
    // 7. LLM 返回后对比版本号：变了就作废旧回复重算（最多3次）
    // 8. 拆句发送（1-2秒间隔，每句前检查触摸）
    // 9. 发完退回消息列表（navigateToMessageList）
    // 10. 等 1-2 秒 → 继续扫下一个未读
}
```

### 4.5 消息合并策略

**不傻等去抖，用"快速启动 + 过期作废"：**

- 收到第一条 → 500ms 短窗口 → 开始调 LLM
- LLM 调用中来了新消息 → llmRequestId++ → 旧回复作废
- LLM 返回对比版本号：变了就重新读消息重算
- 重算≥3次 或 从首条消息起>8秒 → 强制发送

### 4.6 拆句发送（伪装真人打字）

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
  2. 等 1-2 秒随机
  3. "你周末有空吗？"        → 发送
  4. 等 1-2 秒随机
  5. "我想约你出来吃饭。"    → 发送
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

## 5. 托管流程与错误处理

### 5.1 完整托管循环流程

```
开启托管 → 跳到消息列表页
  ↓
从列表顶部开始找有未读红标的会话
  ↓
当前屏幕没找到？→ 往下滑一屏 → 继续找（最多滑3屏）
  ↓
找到了 → 点进会话
  ↓
读对方最后几条消息 → 调 AI 生成回复
  ↓
拆句发送（1-2秒间隔，每句前检查触摸）
  ↓
回复完 → 退回消息列表
  ↓
等 1-2 秒 → 继续找下一个未读
  ↓
找不到了 → 停在列表页等通知
```

### 5.2 滑动找未读的规则

1. **从顶部开始**，不要从中间开始
2. **往下滑**（不是往上），因为未读消息排在最前面
3. **最多滑 3 屏**，滑到底了还没找到就停
4. 找到一个未读就点进去，不要把所有未读都找完再一个一个进

### 5.3 回复完一个后的规则

1. 发完最后一句 → 退回消息列表
2. 等 **1-2 秒随机** → 让界面缓一下
3. 继续从当前位置往下找下一个未读

### 5.4 违规弹窗的两种处理（关键）

**情况一：内容违规被拦（能救）**

弹窗特征：
- 说"你发送的内容包含违规信息"
- 或"发送失败，请检查内容"
- 或类似"你的消息包含敏感词"

处理：
1. 关掉弹窗
2. 把刚才被拦的文字 + "这句话发不出去，请换个更安全的说法重写一遍" 作为额外输入，重新调 /api/chat
3. 拿到新回复 → 重新发送
4. **连续 2 次都被拦** → 停工，通知用户

**情况二：账号真被封了（救不了）**

弹窗特征：
- 说"你的账号已被封禁"
- 或"你已被禁言"
- 或"账号存在风险"

处理：
1. 关掉弹窗
2. 立即停工
3. 通知用户"账号被封了，需要人工处理"
4. 不再继续自动回复

**判断弹窗类型的方法：**
```
when {
    popupText.contains("违规") || popupText.contains("敏感") -> {
        // 情况一：内容违规，重写再发
        retryCount++
        if (retryCount >= 2) { stopAutomation("连续2次内容违规") }
        else { rewriteAndRetry() }
    }
    popupText.contains("封禁") || popupText.contains("禁言") -> {
        // 情况二：账号被封，停工
        stopAutomation("账号被封")
    }
    else -> {
        // 不认识的弹窗，关掉继续
        closePopup()
    }
}
```

### 5.5 其他异常处理

| 异常 | 处理 |
|------|------|
| 点会话没反应 | 等1秒再点一次，最多2次，还不行就跳过这个会话 |
| 进了聊天页但没有消息 | 等2秒再读，还没有就退回列表 |
| 输入框找不到 | 截图看当前在哪页，退回来重进 |
| 发送按钮不出现 | 等1秒再找，还没有就截图给AI看 |
| 网络超时 | 等3秒重试一次，还不行就跳过 |
| 电话来了 | 检测到来电就暂停，挂了继续 |

---

## 6. QQ 适配器（实测版）

### 6.1 基本信息

- **包名**：`com.tencent.mobileqq`
- **当前 QQ 版本**：实测版（用户手机上的版本）

### 6.2 页面识别规则

**消息列表页：** 查 `com.tencent.mobileqq:id/o8n`（RecyclerView 会话列表）存在 → MESSAGE_LIST

**聊天页：** 同时满足：
- 有 `com.tencent.mobileqq:id/input`（输入框 EditText）
- 有 `com.tencent.mobileqq:id/send_btn`（发送按钮 Button）
→ CHAT_ROOM

**其他页面：** 有底部 tab（`com.tencent.mobileqq:id/kbi`）但没有 o8n 和 input → 按底部"消息"tab 跳回消息列表

### 6.3 页面导航

| 当前页面 | 怎么做 |
|----------|--------|
| 消息列表 | 不用动 |
| 聊天页 | 点 `com.tencent.mobileqq:id/ivTitleBtnLeft`（content-desc="返回消息"） |
| 联系人/动态/频道 | 点底部 tab 中 text="消息" 的那个（ID：`com.tencent.mobileqq:id/kbi`） |
| 不认识 | 按返回键，最多退 3 次 |

### 6.4 消息列表里要找的东西

| 元素 | View ID | 怎么用 |
|------|---------|--------|
| 会话列表容器 | `com.tencent.mobileqq:id/o8n` | RecyclerView，遍历它的子项 |
| 单个会话项 | `com.tencent.mobileqq:id/o8c` | clickable=true，每个会话一行 |
| 对方昵称 | `com.tencent.mobileqq:id/title` | 会话项里的标题 TextView |
| 消息预览 | 会话项里的 TextView（无固定 ID） | 读 text 内容 |
| 未读数字 | `com.tencent.mobileqq:id/khc` | content-desc 是纯数字（如"2"） |
| 会话头像 | `com.tencent.mobileqq:id/a2o` | 会话项左边的头像 |

**判断未读：** 查会话项里有没有 `com.tencent.mobileqq:id/khc`，有就是有未读。

### 6.5 聊天页里要找的东西

**顶部导航栏：**

| 元素 | View ID | content-desc |
|------|---------|-------------|
| 返回按钮 | `com.tencent.mobileqq:id/ivTitleBtnLeft` | "返回消息" |
| 对方昵称 | `com.tencent.mobileqq:id/20r` | （text 直接是昵称） |
| 在线状态 | `com.tencent.mobileqq:id/j64` | （text="在线"/"离线"） |
| 聊天设置 | `com.tencent.mobileqq:id/004` | "聊天设置" |

**消息气泡：**

| 元素 | View ID | 说明 |
|------|---------|------|
| 消息容器 | `com.tencent.mobileqq:id/root` | 每条消息一个 |
| 消息文本 | `com.tencent.mobileqq:id/mj0` | TextView，所有消息文本都用这个 ID |
| 头像容器 | `com.tencent.mobileqq:id/vd0` | 每条消息的头像 |
| 时间分隔 | `com.tencent.mobileqq:id/f24` | TextView（如"凌晨0:45"） |

**底部输入区：**

| 元素 | View ID | 类型 |
|------|---------|------|
| 输入框 | `com.tencent.mobileqq:id/input` | EditText |
| 发送按钮 | `com.tencent.mobileqq:id/send_btn` | Button（text="发送"） |

### 6.6 怎么区分"对方发的"和"我发的"

**最可靠的方法：看头像的 content-desc**

| 头像 content-desc | 说明 |
|-------------------|------|
| `"XXX的资料卡"`（对方昵称+资料卡） | 对方发的 |
| `"我的资料卡"` | 我发的 |

**备选方法：看头像位置**
- 头像在屏幕左边 → 对方
- 头像在屏幕右边 → 我

**推荐用第一种**，content-desc 直接告诉你是谁，不用猜位置。

### 6.7 fillAndSend 流程（QQ 版）

```
1. 找输入框 com.tencent.mobileqq:id/input
2. ACTION_SET_TEXT 填入文本
3. 等 com.tencent.mobileqq:id/send_btn 变成可点击（enabled=true）
4. 点发送按钮
5. 检测弹窗：
   ├─ 弹窗说"内容违规/敏感"→ 关掉 → 让AI重写一条 → 再发
   │   └─ 连续2次都被拦 → 停工
   ├─ 弹窗说"账号被封/禁言"→ 关掉 → 停工
   ├─ 发送按钮变回 enabled=false → 发送成功
   └─ 3秒没变化 → TIMEOUT
```

### 6.8 消息类型识别（QQ 版）

| 类型 | 怎么判断 | 怎么处理 |
|------|---------|---------|
| 文字消息 | 有 `mj0`（消息文本ID） | 直接读文字，调 LLM |
| 图片消息 | 没有 mj0，但消息项里有 ImageView（找 `ImageView` 类的节点） | 先回"你打字告诉我呗"，以后接视觉模型 |
| 表情包 | 没有 mj0，有小表情图（GIF/ImageView） | 同上 |
| 语音消息 | 没有 mj0，有语音条（找带时长文字的节点） | 长按语音 → 找"转文字" → 读结果 |
| 系统消息 | 时间分隔 `f24` | 直接跳过 |

**关键：只读 `mj0` 这个 ID 的文字，其他的全当没看见。**
**判断图片/表情/语音的方法：消息项里没有 mj0，就看它有什么其他 View（ImageView/语音条）。**

### 6.9 clickFirstUnreadConversation 流程（QQ 版）

```
1. 找消息列表 RecyclerView（id/o8n）
2. 遍历每个会话项（id/o8c）
3. 读会话项里的 title（id/title）→ 对方昵称
4. 查白名单 → 不在就跳过
5. 查会话项里有没有未读标记（id/khc）→ 有就点
6. 点之前做 MD5 指纹去重（避免重复点同一个会话）
```

### 6.10 注意事项

1. **QQ 的 View ID 是混淆过的**（如 `o8n`、`mj0`、`vd0`），QQ 更新版本后这些 ID 可能变。如果版本一致就没问题，版本变了要重新抓。
2. **消息文本都在 `com.tencent.mobileqq:id/mj0` 里**，不管是你发的还是对方发的，都是这个 ID。靠头像 content-desc 区分方向。
3. **发送按钮初始是 disabled 的**，输入文字后才变 enabled。所以填入文本后要等一下再点。
4. **QQ 底部 tab 有 4 个**：消息、频道、联系人、动态。回到消息列表就是点 text="消息" 的那个 tab（ID 都是 `com.tencent.mobileqq:id/kbi`）。

---

## 7. 陌陌适配器（实测版）

### 7.1 基本信息

- **包名**：`com.immomo.momo`
- **聊天页 Activity**：`com.immomo.momo.audiomatch.view.NAChatLuaActivity`
- **底部 tab**：首页、直播、消息、小宇宙、更多（共5个）

### 7.2 页面识别规则

**消息列表页：** 同时满足：
- 有 `com.immomo.momo:id/recyclerview`（会话列表）
- 有 `com.immomo.momo:id/chatlist_item_tv_name`（会话项昵称）
→ MESSAGE_LIST

**聊天页：** 同时满足：
- 有 `com.immomo.momo:id/message_chat_recycler_view`（消息列表）
- 有 `com.immomo.momo:id/message_ed_msgeditor`（输入框）
→ CHAT_ROOM

**其他页面：** 有 `com.immomo.momo:id/maintab_bottom_container`（底部导航栏）但没有上面两个 → 点底部"消息"tab 跳回消息列表

### 7.3 页面导航

| 当前页面 | 怎么做 |
|----------|--------|
| 消息列表 | 不用动 |
| 聊天页 | 点返回键（没有专门的返回按钮ID，用系统返回） |
| 首页/直播/小宇宙/更多 | 点底部 `com.immomo.momo:id/maintab_layout_chat`（消息tab） |
| 不认识 | 按返回键，最多退3次 |

### 7.4 消息列表里要找的东西

| 元素 | View ID | 怎么用 |
|------|---------|--------|
| 会话列表容器 | `com.immomo.momo:id/recyclerview` | RecyclerView，遍历子项 |
| 单个会话项 | `com.immomo.momo:id/item_layout` | clickable=true，每个会话一行 |
| 对方昵称 | `com.immomo.momo:id/chatlist_item_tv_name` | TextView，直接读 text |
| 消息预览 | `com.immomo.momo:id/chatlist_item_tv_content` | TextView，读最后一条消息 |
| 时间 | `com.immomo.momo:id/chatlist_item_tv_timestamp` | TextView，如"凌晨0:45" |
| 未读标记 | `com.immomo.momo:id/chatlist_item_tv_status_new` | 有这个View就是有未读 |
| 会话头像 | `com.immomo.momo:id/chatlist_item_iv_face` | 左边的头像 |
| 搜索按钮 | `com.immomo.momo:id/menu_search_icon` | 右上角搜索 |

**判断未读：** 查会话项里有没有 `chatlist_item_tv_status_new`，有就是有未读。

### 7.5 聊天页里要找的东西

**顶部导航栏：**

| 元素 | View ID | 说明 |
|------|---------|------|
| 对方昵称 | `com.immomo.momo:id/chat_user_name` | 顶部中间，text 直接是昵称 |
| 对方头像 | `com.immomo.momo:id/chat_toolbar_avatar` | 顶部左边 |
| 关闭按钮 | `com.immomo.momo:id/topbar_close` | 退出聊天 |

**消息气泡：**

| 元素 | View ID | 说明 |
|------|---------|------|
| 消息列表 | `com.immomo.momo:id/message_chat_recycler_view` | RecyclerView |
| 单条消息 | `com.immomo.momo:id/message_item` | 每条消息一个 |
| 消息文本 | `com.immomo.momo:id/message_tv_layouttextview` | TextView，消息内容 |
| 消息容器 | `com.immomo.momo:id/message_layout_messagecontainer` | 气泡容器 |
| 我的消息容器 | `com.immomo.momo:id/message_layout_rightcontainer` | 有这个=我发的 |
| 头像 | `com.immomo.momo:id/message_iv_userphoto` | 每条消息的头像 |
| 时间 | `com.immomo.momo:id/message_tv_timestamp` | 时间分隔 |

**底部输入区：**

| 元素 | View ID | 类型 |
|------|---------|------|
| 输入框 | `com.immomo.momo:id/message_ed_msgeditor` | EditText |
| 输入区容器 | `com.immomo.momo:id/input_layout` | 整个输入区 |
| 发送按钮 | `com.immomo.momo:id/right_btn_root` | 输入文字后出现 |

### 7.6 怎么区分"对方发的"和"我发的"

**最可靠的方法：看有没有 rightcontainer**

| 条件 | 说明 |
|------|------|
| 消息项里有 `message_layout_rightcontainer` | 我发的 |
| 没有 `message_layout_rightcontainer` | 对方发的 |

**备选方法：看头像位置**
- 头像在左边 → 对方
- 头像在右边 → 我

### 7.7 fillAndSend 流程（陌陌版）

```
1. 找输入框 com.immomo.momo:id/message_ed_msgeditor
2. ACTION_SET_TEXT 填入文本
3. 等 com.immomo.momo:id/right_btn_root 出现（输入文字后才出现）
4. 点发送按钮
5. 检测弹窗：
   ├─ 弹窗说"内容违规/敏感"→ 关掉 → 让AI重写一条 → 再发
   │   └─ 连续2次都被拦 → 停工
   ├─ 弹窗说"账号被封/禁言"→ 关掉 → 停工
   ├─ 输入框清空 → 发送成功
   └─ 3秒没变化 → TIMEOUT
```

### 7.8 消息类型识别（陌陌版）

| 类型 | 怎么判断 | 怎么处理 |
|------|---------|---------|
| 文字消息 | 有 `message_tv_layouttextview` | 直接读文字，调 LLM |
| 图片消息 | 没有文字，有 `message_content_layout` 里的 ImageView | 先回"你打字告诉我呗"，以后接视觉模型 |
| 表情包 | 没有文字，有 `message_gifview`（GIF动图） | 同上 |
| 语音消息 | 没有文字，有语音条 | 回"我听不了语音，你打字说" |
| 系统消息 | `message_tv_noticemessage` | 直接跳过 |

**关键：只读 `message_tv_layouttextview` 这个 ID 的文字，其他的全当没看见。**

### 7.9 clickFirstUnreadConversation 流程（陌陌版）

```
1. 找消息列表 RecyclerView（id/recyclerview）
2. 遍历每个会话项（id/item_layout）
3. 读会话项里的 chatlist_item_tv_name → 对方昵称
4. 查白名单 → 不在就跳过
5. 查会话项里有没有 chatlist_item_tv_status_new → 有就点
6. 点之前做 MD5 指纹去重
```

### 7.10 注意事项

1. **陌陌的聊天页是 Lua 渲染的**（NAChatLuaActivity），部分元素可能没有标准 View ID。如果 message_tv_layouttextview 找不到，就遍历 RecyclerView 找所有 TextView 读文本。
2. **发送按钮初始不显示**，输入文字后才出现。填入文本后要等一下再找 right_btn_root。
3. **陌陌底部有5个 tab**：首页、直播、消息、小宇宙、更多。回到消息列表就是点 `maintab_layout_chat`。
4. **陌陌有"语音唠嗑"引导弹窗**，第一次进聊天会弹。检测到"去聊天"按钮就点掉，不要卡在引导页。
5. **陌陌的 View ID 是有意义的**（不像 QQ 是混淆的），版本更新后大概率不变。

---

## 8. 消息类型识别与图片处理（通用原则）

> 本章是通用原则。各平台的具体 View ID 看第 6 章（QQ）和第 7 章（陌陌）。

### 8.1 五类消息识别

| 类型 | 怎么判断 | 怎么处理 |
|------|---------|---------|
| **文字消息** | 有文字气泡 | 直接读文字，调 LLM 生成回复 |
| **图片消息** | 没有文字，有图片框 | 截图 → 发给视觉模型 → AI 看图说话 |
| **表情包** | 没有文字，有小表情图 | 同图片处理（截图给视觉模型） |
| **语音消息** | 没有文字，有语音条 | 点 App 自带"转文字"按钮 → 读结果 |
| **系统消息** | 系统通知 | 直接跳过，不回复 |

### 8.2 语音消息：利用 App 自带的"转文字"功能

**不用自己做 ASR（语音转文字），直接点 App 自带的"转文字"按钮！**

```
检测到语音消息
  ↓
找到语音消息旁边的"转文字"按钮
  ↓
点一下
  ↓
等 1-2 秒，文字转出来了
  ↓
读转出来的文字，当作对方发的内容
```

**怎么找"转文字"按钮：**
- QQ：长按语音消息 → 弹菜单 → 找 text="转文字" 的菜单项 → 点击
- 陌陌：语音消息上方或旁边有个小"文"字按钮，直接点
- Soul：语音消息旁边有个"转文字"小按钮，直接点

**实现方式：**
```kotlin
fun findVoiceTranscribeButton(voiceNode: AccessibilityNodeInfo): AccessibilityNodeInfo? {
    // 方法1：先在语音消息节点旁边找"转文字"按钮（有些App直接显示）
    // 方法2：找不到就长按语音消息，等弹菜单，再找"转文字"
    // 方法3：还找不到就跳过，兜底回"我听不了语音"
}
```

**关键优势：**
- 不花钱：用 App 自带的转文字，不需要接 ASR API
- 不增加延迟：本地操作，1-2 秒搞定
- 准确度高：App 自己的转文字肯定比第三方 ASR 准

### 8.3 图片消息：截图 + 视觉模型

```
检测到图片消息
  ↓
截图当前聊天页
  ↓
把截图发给后端视觉模型
  ↓
视觉模型返回描述："这是一只橘猫趴在沙发上"
  ↓
把描述当作对方发的内容，调 LLM 生成回复
```

**后端加一个接口：**
```
POST /api/vision/describe
Body: { image: base64截图 }
返回: { description: "这是一只橘猫..." }
```

**成本：** 每张图一次视觉模型调用，比纯文字贵，但只在对方发图时才触发。

### 8.4 表情包：同图片处理

表情包本质就是小图片，处理方式和图片一样：截图 → 视觉模型描述 → "这是一个大笑的表情"。

### 8.5 优先级

1. **先做文字消息**（已经在做了）
2. **再做语音消息**（点"转文字"按钮，不花钱，效果好）
3. **最后做图片消息**（截图给视觉模型，有成本但不多）

**现在先做 1 和 2：**
- 文字正常处理
- 语音点"转文字"按钮读结果
- 图片/表情先回"你打字告诉我呗"

---

## 9. 安全与风控

| 场景 | 做法 |
|------|------|
| API 鉴权 | 请求头 Bearer Token，D1 查 tokens 表 |
| API Key | 放 Cloudflare Secrets，不放 KV |
| 防重复回复 | md5(platform+contactId+content)，5分钟窗口 |
| 白名单 | 后端查 contacts 表，不在白名单返回 skip |
| 超时 | 单次 150 秒 |
| 违规弹窗 | 分两种：内容违规重写再发（连续2次才停工），账号被封直接停工 |
| 敏感词 | App 本地词表优先，命中不走 LLM |
| 人工接管 | 发送前 100ms 触摸检测；打断时清空输入框 |
| 用户旁观 | onPageChanged 检测用户手动进聊天页 → UserInChatRoom |
| 天气 | 和风天气 API，30分钟缓存 |

---

## 10. 开发顺序与验收标准

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

**验收：** 悬浮窗能开关；收到通知能 logcat 打出来。

### Step 3: QQ/陌陌端到端
- 实现 QQAdapter 和 ImmomoAdapter 七个方法
- 实现 MessageEngine 状态机
- 实现去重、敏感词、发送前触摸检测
- 实现 onPageChanged 用户旁观模式
- 实现监控模式 monitorMode 分支
- 实现消息类型识别

**验收：** 给白名单联系人发消息 → 自动读 → 调 AI → 粘贴发送；用户手动点进聊天页 AI 旁观；退出后自动恢复。

### Step 4: 扩展
- Soul/连信适配器
- Dashboard 前端
- 全品牌保活引导页
- 语音转文字（点 App 自带"转文字"按钮）
- 图片识别（截图给视觉模型）

---

## 11. 提前警告：这些坑一定会遇到

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
15. 陌陌聊天页干扰元素多 → 只读 message_tv_layouttextview，其他全当没看见
16. QQ View ID 混淆 → 版本变了要重新抓

---

## 12. 默认参数（写死，不要改）

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
| 滑动找未读 | 最多滑 3 屏 |
| 返回列表后等待 | 1-2 秒随机 |
| 内容违规重试 | 连续 2 次才停工 |

---

## 13. 增强功能（P0-P2，以后慢慢加）

### P0 必做（直接影响稳定性）

| 功能 | 说明 |
|------|------|
| 发送验证 | 发完回列表看一眼，确认真发出去了，没发就重发 |
| 空闲巡逻 | 每 30 秒检查 App 还在前台不，被切走了就拉回来 |
| 返回后稳定等待 | 回到列表等 500ms 再操作 |
| 列表快照对比 | 读完算个哈希，和之前比，变了就重读 |

### P1 强烈建议（跑通后加）

| 功能 | 说明 |
|------|------|
| 光标存储 | 记录读到哪了，下次接着读，省 token |
| 输入框等待 | 等输入框加载完再填字 |
| 精确文本验证 | 填完读一下，确认没填错再发 |
| 聊天验证尝试 | 点完等 1 秒，检查是不是聊天页，不是就退回来重进 |

### P2 有空再做（稳定后加）

| 功能 | 说明 |
|------|------|
| 阅后即焚 | Soul 的阅后即焚图片，点一下打开截图 |
| 相册发送重试 | 发图失败重试 2 次 |
| 历史底部恢复 | 滑到底了退出去重进 |
| 关系邀请弹窗自动关 | Soul 弹"加好友"弹窗，自动关掉 |

---

**文档版本：** 完整版 v1.0 | 2026-09-24
**包含内容：** v2.0 + 托管流程 + QQ适配器 + 陌陌适配器 + 消息类型识别 + 语音图片处理 + 增强功能
