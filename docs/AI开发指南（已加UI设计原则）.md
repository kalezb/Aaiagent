# AI 开发指南：社交消息 AI 托管助手

> v1.0 | 2026-09-23
> **这份文档是施工图纸，不是讨论稿。所有决策已定，不要自由发挥。**
> 如果发现本文档没覆盖的情况，停下来问，不要自己脑补方案。

---

## 0. 怎么用这份文档

按 §7 的开发顺序一步步做。每一步都有"验收标准"，过了再往下走。
不要跳步，不要提前做 §7 以外的东西。

---

## 1. 项目是什么

一台 Android 手机，同时监听 Soul / QQ / 陌陌 / 连信四个社交 App 的消息，
AI 自动读消息、生成回复、粘贴发送。用户可以随时人工接管。

**技术栈：**

| 层 | 用什么 |
|----|--------|
| App 语言 | Kotlin |
| UI | Jetpack Compose |
| 本地库 | Room |
| 网络 | OkHttp |
| 无障碍 | AccessibilityService |
| 通知监听 | NotificationListenerService |
| 后端 | Cloudflare Pages + Functions（Hono） |
| 数据库 | Cloudflare D1 |
| 配置 | Cloudflare KV |
| LLM | DeepSeek Chat（可换） |

**红线（绝对不能做）：**

- ❌ 不做 iOS
- ❌ 不做内置聊天界面（我们是托管工具，不是聊天 App）
- ❌ 不做语音/视频通话处理
- ❌ 不做自研大模型
- ❌ 不做流式返回（人不在屏幕前看打字）
- ❌ 不做 KV 热缓存 + 异步落库（量小，直接写 D1）
- ❌ 不做用户登录/注册系统（用设备钥匙即可）
- ❌ AI 不自动跨平台认人（用户手动绑定）

---

## 2. 整体架构

```
Android App (Kotlin)
  ├── NotificationListenerService  ← 听通知
  ├── AccessibilityService          ← 读屏幕、模拟操作
  ├── Room                          ← 本地缓存、去重指纹
  └── OkHttp ──HTTPS──→ Cloudflare Pages
                          ├── Hono API (/api/*)
                          ├── D1 (聊天记录、联系人、钥匙)
                          ├── KV (模型配置、人设)
                          └── Secrets (DeepSeek API Key)
```

**关键原则：**
- App 端只做"眼睛和手"：读屏幕、模拟操作、发请求
- 所有智能判断都在云端：拼 prompt、调 LLM、存历史
- App 不做任何"该不该回"的判断，只按云端返回的指令执行

---

## 3. 后端设计

### 3.1 目录结构

```
backend/
├── functions/
│   └── api/
│       ├── [[route]].ts      # Hono 入口
│       ├── chat.ts           # /api/chat
│       ├── history.ts        # /api/chat/history
│       ├── contacts.ts       # /api/contacts
│       ├── persona.ts        # /api/persona
│       ├── config.ts          # /api/config
│       ├── token.ts           # /api/token (设备钥匙管理)
│       └── status.ts          # /api/status
├── src/                      # Dashboard 前端
│   ├── index.html
│   └── app.js
├── db/
│   └── schema.sql
└── wrangler.toml
```

### 3.2 数据库 Schema（直接执行）

```sql
-- D1 数据库建表语句，直接执行

-- 设备钥匙表
CREATE TABLE tokens (
    token       TEXT PRIMARY KEY,        -- 钥匙字符串，App 装完用户输入
    name        TEXT NOT NULL DEFAULT '', -- 备注，比如"我的小米14"
    monthly_limit INTEGER NOT NULL DEFAULT 30,  -- 月度花费上限（元）
    spent       REAL NOT NULL DEFAULT 0,  -- 本月已花费
    is_active   INTEGER NOT NULL DEFAULT 1, -- 1=启用 0=停用
    created_at  INTEGER NOT NULL,
    last_used_at INTEGER
);

-- 聊天历史
CREATE TABLE chat_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT NOT NULL,            -- 哪台设备的
    platform    TEXT NOT NULL,            -- soul / qq / immomo / lianxin
    contact_id  TEXT NOT NULL,            -- 平台内联系人 ID 或昵称
    contact_name TEXT NOT NULL,           -- 显示昵称
    role        TEXT NOT NULL,            -- 'user'=对方说的  'assistant'=AI回的  'system'=摘要
    content     TEXT NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX idx_chat_session ON chat_history(token, platform, contact_id, created_at);

-- 会话摘要（每个会话一条）
CREATE TABLE session_summary (
    token       TEXT NOT NULL,
    platform    TEXT NOT NULL,
    contact_id  TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    summarized_up_to_id INTEGER NOT NULL DEFAULT 0, -- 摘要已覆盖到哪条 message id
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
    -- 跨平台绑定：同一个人在不同平台的 contact_id 用 group_id 关联
    group_id    TEXT DEFAULT '',          -- 空字符串=未绑定
    UNIQUE(token, platform, contact_id)
);

-- 人设
CREATE TABLE personas (
    id          TEXT PRIMARY KEY,         -- 'male' / 'female'
    name        TEXT NOT NULL,            -- '阿杰' / '小夏'
    system_prompt TEXT NOT NULL,
    is_active   INTEGER NOT NULL DEFAULT 0
);

-- 初始化人设数据
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
| `weather:cache` | 天气缓存（30 分钟刷新一次） | `{"temp":15,"condition":"阴天","updated_at":1234567890}` |

**注意：位置（城市/区域）不存后端。App 端自己存，每次调 API 时传过来。后端不存、不猜、不自己判断用户在哪。**

### 3.4 Secrets（环境变量，不进 KV）

| 变量名 | 内容 |
|--------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API Key |
| `DASHBOARD_PASSWORD` | Dashboard 登录密码（简单做个门） |
| `WEATHER_API_KEY` | 天气 API Key（和风天气/心知天气，免费版够用） |

### 3.5 API 接口定义

**所有接口（除 /api/status）都要验证 Token。**
请求头带 `Authorization: Bearer <token>`。
验证失败返回 `401`。

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

**location 说明：** App 端同时传家庭地址和工作地址。后端不存，直接用。对方问住哪就说 home，问工作在哪就说 work。用户在 App 里改了任何一个，下次请求自动传新的。

**后端处理：**
1. 验证 Token
2. 查白名单：这个 contact 是否在白名单？不在 → 返回 `{"action": "skip"}`
3. 查 D1 拿这个会话的历史（见 §3.6）
4. 拼 prompt：人设 + 平台风格 + 当前时间 + App 传的 location + 天气 + 摘要 + 最近 20 轮 + 新消息
5. 调 DeepSeek API
6. 把 user 消息和 assistant 回复都存 D1
7. 返回

**响应：**
```json
// 白名单内，正常回复
{
  "action": "send",
  "reply": "周末啊，我看一眼排班，应该周六下午有空"
}

// 不在白名单
{
  "action": "skip"
}

// 敏感词命中（后端兜底，主要靠 App 本地先拦）
{
  "action": "safe_reply",
  "reply": "这个我不太方便聊，换个话题吧"
}
```

---

#### GET /api/chat/history?platform=soul&contact_id=u_12345&limit=50

查聊天记录。Dashboard 用。

**响应：**
```json
{
  "messages": [
    {"role": "user", "content": "...", "created_at": 1234567890},
    {"role": "assistant", "content": "...", "created_at": 1234567900}
  ]
}
```

---

#### GET/POST/PUT/DELETE /api/contacts

白名单管理。

**GET：** 返回当前 Token 的所有联系人
**POST：** 添加联系人 `{platform, contact_id, contact_name}`
**PUT：** 更新 `{id, is_whitelisted, notes, group_id}`
**DELETE：** 删除

---

#### GET/PUT /api/persona

读写人设。

**GET：**
```json
{
  "active": {"id": "male", "name": "阿杰", "system_prompt": "..."},
  "all": [{"id": "male", ...}, {"id": "female", ...}]
}
```

**PUT：** `{"id": "female"}` 切换当前人设。

---

#### GET /api/config

App 启动时拉一次。**App 本地缓存，不用每次都拉。**

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

---

#### GET /api/status

健康检查。App 启动时调一次。

```json
{
  "status": "ok",
  "llm_ping": "ok",
  "platforms": {
    "soul": "active"
  }
}
```

---

#### POST /api/messages/sync

**监控模式专用。** App 把聊天记录实时同步给后端，不调 LLM、不生成回复。
不管 AI 托管开关开没开，只要监控模式开着就调这个接口。

**请求体：**
```json
{
  "platform": "soul",
  "contact_id": "u_12345",
  "contact_name": "风中追风",
  "messages": [
    {"role": "user", "content": "在吗？", "created_at": 1234567890},
    {"role": "assistant", "content": "在的", "created_at": 1234567900},
    {"role": "user", "content": "周末有空吗", "created_at": 1234568000}
  ]
}
```

**后端处理：**
- 直接把 messages 存进 chat_history 表
- 不调 LLM、不返回回复
- 返回 `{"ok": true}`

**跟 /api/chat 的区别：**
- `/api/chat`：调 LLM 生成回复，用于全自动/写入门禁模式
- `/api/messages/sync`：只存记录，用于监控模式，不花钱、不调模型

---

### 3.6 LLM 调用流程（精确版）

```
收到 /api/chat 请求
  ↓
验证 Token → 无效返回 401
  ↓
查 contacts 表：这个 contact_id 在白名单吗？
  ├─ 不在 → 返回 {action: "skip"}
  ↓ 在
查 session_summary 表：有没有摘要？
  ↓
查 chat_history 表：
  - 取最近 20 轮（40 条消息），每条带 created_at 时间戳
  - 统计已有多少条；如果总数 > 40 且 summary 为空或过时 → 需要摘要
  ↓
算时间差：
  - 最后一条 user 消息的 created_at 距现在多久（hours_ago）
  ↓
查天气：
  - 用 App 传过来的 location.city 查天气
  - 从 KV 读 weather:cache
  - 如果缓存不到 30 分钟 → 直接用
  - 如果超过 30 分钟 → 调天气 API，更新 KV 缓存
  ↓
拼 prompt（见下方详细结构）
  ↓
调 DeepSeek API（model, temperature=0.7, max_tokens=300）
  ↓
把本次 user 消息 + assistant 回复存 chat_history
  ↓
判断是否需要重算摘要：
  - 本次新消息后，超出 40 条的旧消息超过 10 条 → 异步重算 summary
  - 重算方式：把 summarized_up_to_id 之前的所有消息喂给 LLM，让它输出 200 字以内摘要
  - 注意：摘要不阻塞当前响应
  ↓
返回 {action: "send", reply: "..."}
```

**Prompt 拼接结构（必须严格按这个来，解决时间感知和事实矛盾问题）：**

```
system:
  {active_persona.system_prompt}
  
  当前平台：{platform}，请用以下语气：{platform_style_hints[platform]}
  
  现在是 {current_datetime}（{weekday}）。
  
  你住在{location.home.city}{location.home.district}，在{location.work.city}{location.work.district}上班。
  今天{weather_condition}，气温{weather_temp}°C。
  
  回复规则（必须遵守）：
  1. "对方说"是对方发的话，"你说"是你（AI 扮演的人设）之前发的话。不要搞混角色。
  2. 注意当前时间。不要说不符合现在时间的话——晚上不要说"早上好"，下午不要说"刚起床"。
  3. 注意当前天气和气温。不要编造与实际天气矛盾的话——冷天不要说热，阴天不要说太阳大。
  4. 对方聊到天气时，以对方说的为准。对方说热就聊热，说冷就聊冷，不要纠正对方。只有对方问你"你那边冷不冷"时，才说你自己这边的天气。
  5. 对方问你住在哪 → 说家庭地址（home）。对方问你工作/上班在哪 → 说工作地址（work）。不要搞混。
  6. 不要编造与对方消息矛盾的事实。对方说冷就不要说热，对方说没太阳就不要说太阳大。
  7. 如果你很久没回对方，正常说"刚忙完""刚看到消息"之类的话。不要说对方消失了——消失的人是你。
  8. 只回复对方最新的这条消息，基于上下文自然接话。不要重复之前说过的话。
  
  [如果 hours_ago > 2]
  注意：对方最后一条消息是 {hours_ago} 小时前发的。
  你一直在忙没回复，现在刚看到消息。回复要自然，不要突然热情。

user/assistant 交替（每条带人类可读时间）：
  [如果有 summary]
  之前的聊天大概是这样：{summary}
  
  [最近 20 轮，每条消息前加时间标注]
  [早上 8:00] 对方说：在吗
  [早上 8:01] 你说：在的，刚忙完
  [晚上 8:30] 对方说：周末有空吗    ← 这是最新一条
```

**为什么这样能解决三个问题：**

| 用户反馈的问题 | 上面的设计怎么解决 |
|---------------|------------------|
| 早上发的消息晚上回，AI 说"早上好" | system 里写了"现在是晚上 8:30"，历史消息也标了时间，AI 知道过了多久 |
| 对方连发几天消息，AI 说"你怎么消失了" | system 规则第 4 条："消失的人是你，不是对方"。同时标注了"对方最后一条是 X 小时前发的" |
| 对方说冷，AI 说热 | system 规则第 3 条："不要编造与对方矛盾的事实" |

**关键数字（写死，不要改）：**
- 原文窗口：20 轮 = 40 条消息
- 摘要重算触发：新增 10 条后
- 摘要长度：≤ 200 字
- temperature：0.7
- max_tokens：300
- 长时间未回复阈值：超过 2 小时就在 system 里加提示

---

## 4. Android 端设计

### 4.1 目录结构

```
android/
├── app/
│   └── src/main/java/com/aaiagent/
│       ├── App.kt                    # Application
│       ├── MainActivity.kt           # 三个 Tab：控制台/记录/设置
│       ├── core/
│       │   ├── BridgeApp.kt          # 前台服务 + 悬浮窗
│       │   └── ServiceManager.kt     # 统一管理无障碍/通知监听
│       ├── accessibility/
│       │   ├── AiAccessibilityService.kt   # 无障碍服务主类
│       │   └── GestureMonitor.kt           # 触摸检测（仅发送窗口用）
│       ├── notification/
│       │   └── NotificationListener.kt     # 通知监听
│       ├── adapter/
│       │   ├── PlatformAdapter.kt          # 适配器接口
│       │   ├── AdapterRegistry.kt          # 注册包名 → 适配器
│       │   ├── SoulAdapter.kt
│       │   ├── QQAdapter.kt
│       │   ├── ImmomoAdapter.kt
│       │   └── LianxinAdapter.kt
│       ├── engine/
│       │   ├── MessageEngine.kt           # 主状态机
│       │   ├── ConversationContext.kt      # 会话上下文（版本号/重算控制）
│       │   ├── Deduplicator.kt            # 去重指纹
│       │   ├── PollingFallback.kt          # 30 秒轮询兜底
│       │   └── SensitiveWords.kt          # 本地敏感词
│       ├── data/
│       │   ├── RoomDB.kt
│       │   ├── entity/
│       │   │   ├── CachedConfig.kt
│       │   │   ├── SeenMessage.kt         # 去重指纹
│       │   │   └── PendingQueue.kt        # 离线队列
│       │   └── ApiClient.kt
│       ├── ui/
│       │   ├── ConsoleTab.kt
│       │   ├── HistoryTab.kt
│       │   └── SettingsTab.kt
│       └── floating/
│           └── FloatingControl.kt          # 绿色小圆点
```

### 4.2 Room 数据库表

```sql
-- CachedConfig: 缓存后端配置（人设、白名单、平台风格提示）
CREATE TABLE cached_config (
    key TEXT PRIMARY KEY,    -- 'active_persona', 'whitelist', 'platform_hints'
    value TEXT NOT NULL,     -- JSON 字符串
    updated_at INTEGER NOT NULL
);

-- SeenMessage: 去重指纹
CREATE TABLE seen_message (
    fingerprint TEXT PRIMARY KEY,  -- md5(platform + contact_id + content)
    seen_at INTEGER NOT NULL
);

-- PendingQueue: 离线时待发送的消息
CREATE TABLE pending_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    contact_id TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',  -- pending / done / failed
    created_at INTEGER NOT NULL
);
```

### 4.3 适配器接口（Kotlin，照抄）

```kotlin
/**
 * 每个平台实现这个接口。加新平台 = 实现这个接口 + 在 AdapterRegistry 注册包名。
 * 所有方法都在无障碍服务的线程里调用。
 */
interface PlatformAdapter {

    /** 这个平台的包名，比如 "cn.soulapp.android" */
    val packageName: String

    /**
     * 判断当前页面是不是该平台的聊天页
     * 查 chat_avatar / chat_follow_btn 等已知 View ID，命中 ≥2 个确认
     */
    fun isInChat(root: AccessibilityNodeInfo): Boolean

    /**
     * 判断当前页面是不是该平台的消息列表
     * 查 item_content_root 节点，或启发式检测会话项
     */
    fun isInMessageList(root: AccessibilityNodeInfo): Boolean

    /**
     * 从聊天页 UI 树提取全部消息
     * @return 消息列表，每条 {sender: "them"/"me", content: String}
     */
    fun readMessages(root: AccessibilityNodeInfo): List<ChatMessage>

    /**
     * 把回复粘贴到输入框 + 点发送
     * @return 操作结果：SUCCESS / BANNED / TIMEOUT
     */
    suspend fun fillAndSend(
        service: AccessibilityService,
        root: AccessibilityNodeInfo,
        text: String
    ): SendResult

    /**
     * 从消息列表点第一个未读会话
     * @param shouldClick false = 只扫描不点（调试用）
     * @return 点到的会话信息；没有未读返回 null
     */
    suspend fun clickFirstUnreadConversation(
        root: AccessibilityNodeInfo,
        shouldClick: Boolean = true
    ): ConversationInfo?

    /**
     * 从聊天页返回消息列表（点返回键或返回箭头）
     */
    suspend fun navigateToMessageList(service: AccessibilityService, root: AccessibilityNodeInfo)

    /**
     * 把本 App 拉到前台，等主界面加载完
     * 注意：Android 标准做法是 startActivity + waitForIdle
     */
    suspend fun bringToForeground(service: AccessibilityService)
}

data class ChatMessage(val sender: String, val content: String)  // sender: "them" / "me"
data class ConversationInfo(val contactId: String, val contactName: String, val preview: String)
enum class SendResult { SUCCESS, BANNED, TIMEOUT }
```

### 4.4 SoulAdapter 参考实现要点

```
isInChat:
  - 查找 Resource ID = "cn.soulapp.android:id/chat_avatar" 和 "chat_follow_btn"
  - 两个都存在 → true

isInMessageList:
  - 查找 Resource ID = "cn.soulapp.android:id/item_content_root"
  - 找到 ≥1 个 → true

readMessages:
  - 从 root 用 DirectionHelper.crawlWithDirection 方向爬取
  - 过滤：纯时间文本（如"12:30"）、系统提示（如"你已添加了对方"）
  - 判断左右侧：自己的消息通常在右侧，对方在左侧（查 layout_marginEnd 或 gravity）
  - 返回 List<ChatMessage>

fillAndSend:
  1. 找输入框：Resource ID = "et_sendmessage"
  2. 执行 paste（或者直接用 ACTION_SET_TEXT）
  3. 等待发送按钮出现：Resource ID = "btn_send"
  4. 点击发送按钮
  5. 检查：如果出现"发送失败""你已被禁言"等文本 → 返回 BANNED
  6. 如果 3 秒内按钮没出现 → 返回 TIMEOUT

clickFirstUnreadConversation:
  1. 在消息列表里递归遍历 ViewGroup
  2. 找纯数字的未读标记节点（通常是一个 TextView，内容是数字）
  3. 对每个未读项，读取昵称和预览文本
  4. 先用本地缓存的白名单过滤：不在白名单的跳过
  5. 对第一个白名单内的未读项，记录其 MD5 指纹（contactId + preview）做去重
  6. shouldClick=true 时 performAction(CLICK)
  7. 返回 ConversationInfo

navigateToMessageList:
  1. 优先找返回箭头 Resource ID
  2. 找不到就 service.performGlobalAction(GLOBAL_ACTION_BACK)

bringToForeground:
  1. 用 Intent 把 Soul 主 Activity 拉起来
  2. 等待 1-2 秒让列表加载完
```

### 4.5 消息处理引擎（主状态机，伪代码）

**这是整个 App 的核心。严格按这个状态机写，不要自由发挥。**

```kotlin
sealed class EngineState {
    object Idle : EngineState()                    // 空闲，在消息列表等新消息
    object ScanningConversations : EngineState()  // 扫描未读会话
    object ReadingMessages : EngineState()        // 读消息中
    object WaitingLLM : EngineState()              // 等云端回复
    object AboutToSend : EngineState()             // 发送前 100ms 检查
    object Sending : EngineState()                 // 正在粘贴发送
    object UserInChatRoom : EngineState()          // 用户手动点进聊天页，AI 旁观
    object Paused : EngineState()                  // 用户手动暂停
    object Error : EngineState()                   // 出错/被封号
}

// 全局，单 worker 串行。只盯当前选定的一个平台（单平台模式）。
object MessageEngine {
    var state: EngineState = Idle
    var currentPlatform: String = ""   // 用户选定的平台，比如 "soul"
    private val contexts = mutableMapOf<String, ConversationContext>()

    /**
     * 页面变化监听：无障碍服务每次检测到当前页面变了，就调这个。
     * 关键作用：区分"AI 自己点进聊天页" vs "用户手动点进聊天页"。
     */
    fun onPageChanged(isInChatRoom: Boolean) {
        if (isInChatRoom) {
            // 现在在聊天页。
            // 如果 state 是 Idle，说明是用户手动点进来的 → 进入旁观模式。
            // 如果 state 是 Scanning/Reading/Waiting，说明是 AI 自己点的，不用管。
            if (state == Idle) {
                state = UserInChatRoom
                log("用户手动点进聊天页，AI 旁观")
            }
        } else {
            // 回到消息列表了。
            if (state == UserInChatRoom) {
                state = Idle
                log("用户退出聊天页，AI 恢复巡逻")
            }
        }
    }

    // UI 检测到新消息冒出来（或通知唤醒）时调用
    var monitorMode: Boolean = false   // 监控模式：只同步聊天记录，不调 LLM、不发送

    fun onNewMessage(contactId: String, rawText: String) {
        // 用户正在聊天页里跟人聊，不插手
        if (state == UserInChatRoom || state == Paused) return

        // 监控模式：只存记录，不调 LLM、不发送
        if (monitorMode) {
            CoroutineScope(Dispatchers.IO).launch {
                val messages = readLatestMessages(contactId)
                apiClient.syncMessages(currentPlatform, contactId, messages)
            }
            return
        }

        val key = "$currentPlatform:$contactId"
        val ctx = contexts.getOrPut(key) { ConversationContext(currentPlatform, contactId) }
        synchronized(ctx) {
            ctx.llmRequestId++
            ctx.pendingCount++
            if (ctx.firstMessageAt == 0L) ctx.firstMessageAt = System.currentTimeMillis()
        }

        // 去重
        val fp = md5(currentPlatform + contactId + rawText)
        if (deduplicator.isSeenRecent(fp, withinMs = 5*60_000)) return
        deduplicator.markSeen(fp)

        // 短窗口后开始处理
        CoroutineScope(Dispatchers.IO).launch {
            delay(500)
            processConversation(ctx)
        }
    }

    private suspend fun processConversation(ctx: ConversationContext) {
        if (state == UserInChatRoom || state == Paused) return

        val adapter = AdapterRegistry.get(currentPlatform) ?: return
        var timeoutJob = launch { delay(150_000); throw TimeoutCancellationException() }
        try {
            // 1. 在消息列表，点未读会话（白名单过滤在 clickFirstUnreadConversation 内部做）
            state = ScanningConversations
            val root = service.rootInActiveWindow ?: return
            val conv = adapter.clickFirstUnreadConversation(root, shouldClick = true)
                ?: run { resetCtx(ctx); return }
            delay(800)

            // 2. 读消息
            state = ReadingMessages
            val chatRoot = service.rootInActiveWindow ?: return
            val messages = adapter.readMessages(chatRoot)
            val newMessages = messages.filter { it.sender == "them" }
            if (newMessages.isEmpty()) { resetCtx(ctx); return }

            // 3. 本地敏感词检查
            val latest = newMessages.last().content
            if (SensitiveWords.isHit(latest)) {
                sendReply(adapter, chatRoot, "这个我不太方便聊，换个话题吧")
                notifyUser("敏感词，已回安全话术")
                resetCtx(ctx)
                adapter.navigateToMessageList(service, chatRoot)
                return
            }

            // 4. 调云端
            state = WaitingLLM
            val myRequestId = ctx.llmRequestId
            val resp = apiClient.chat(currentPlatform, conv.contactId, conv.contactName, messages)
            when (resp.action) {
                "skip" -> {
                    resetCtx(ctx)
                    adapter.navigateToMessageList(service, chatRoot)
                    return
                }
                "safe_reply", "send" -> {
                    synchronized(ctx) {
                        if (ctx.llmRequestId != myRequestId) {
                            val elapsed = System.currentTimeMillis() - ctx.firstMessageAt
                            if (ctx.restartCount >= 3 || elapsed > 8_000) {
                                resetCtx(ctx)
                                sendReply(adapter, chatRoot, resp.reply)
                                adapter.navigateToMessageList(service, chatRoot)
                            } else {
                                ctx.restartCount++
                                processConversation(ctx)
                                return
                            }
                        } else {
                            resetCtx(ctx)
                            sendReply(adapter, chatRoot, resp.reply)
                            adapter.navigateToMessageList(service, chatRoot)
                        }
                    }
                }
            }
            state = Idle
        } catch (e: TimeoutCancellationException) {
            state = Error
            log("超时放弃")
        } catch (e: Exception) {
            state = Error
            log("出错: ${e.message}")
        } finally {
            timeoutJob.cancel()
        }
    }

    private fun resetCtx(ctx: ConversationContext) {
        ctx.restartCount = 0
        ctx.pendingCount = 0
        ctx.firstMessageAt = 0
        state = Idle
    }

    private suspend fun sendReply(
        adapter: PlatformAdapter,
        root: AccessibilityNodeInfo,
        text: String
    ) {
        state = AboutToSend
        delay(100)
        if (GestureMonitor.isUserTouchingRecently(100)) {
            clearInput(root)
            notifyUser("你在用手机，本次发送已取消")
            return
        }
        state = Sending
        when (adapter.fillAndSend(service, root, text)) {
            SendResult.SUCCESS -> {}
            SendResult.BANNED -> {
                closeBanPopup(service)
                pausePlatform(currentPlatform)
                notifyUser("平台封号/禁言，已暂停")
            }
            SendResult.TIMEOUT -> log("发送超时")
        }
    }
}

class ConversationContext(
    val platform: String,
    val contactId: String
) {
    var llmRequestId: Int = 0
    var pendingCount: Int = 0
    var restartCount: Int = 0
    var firstMessageAt: Long = 0
}
```

**页面变化检测逻辑（解决"点进去就罢工"）：**

无障碍服务每次检测到当前页面变了，调 `onPageChanged(isInChatRoom)`：

| 页面变化 | 当前 state | 动作 |
|----------|-----------|------|
| 列表 → 聊天页 | Idle | 是用户手动点的 → 进入 UserInChatRoom（旁观） |
| 列表 → 聊天页 | Scanning/Reading/Waiting | 是 AI 自己点的 → 继续干活 |
| 聊天页 → 列表 | UserInChatRoom | 用户聊完了 → 恢复 Idle |
| 聊天页 → 列表 | Sending/AboutToSend | 正常退回 → 恢复 Idle |

### 4.6 消息合并策略（不用 Debouncer，用版本号作废）

**不要做死等 1.5 秒的去抖。** 采用"快速启动 + 过期作废"：

```
对方发"在吗？"
  ↓
立刻调 LLM（只等 500ms 短窗口，看对方还发不发）
  ↓
LLM 调用中（这 2-5 秒对方可能又打字）
  ↓
对方又发"周末有空吗？"
  → llmRequestId++  ← 正在等的 LLM 结果作废
  ↓
LLM 返回了"在的，周末有空"
  → 对比版本号：变了！这个回复不要
  → restartCount=1，重新读消息、重新调 LLM
  ↓
对方又发"对了我生日"
  → llmRequestId++  ← 新的一次 LLM 结果又作废
  ↓
LLM 返回"周末有空，生日怎么过？"
  → 对比版本号：变了！再次作废
  → restartCount=2，重新来
  ↓
对方停了，3 秒没发新消息
  → LLM 返回"周末有空，生日打算怎么过？"
  → 对比版本号：没变！正常发送
  ↓
发送完成，reset 上下文
```

**防无限重算：**
- 连续重算 ≥3 次 → 不管了，先发出去当前回复
- 从第一条消息算起超过 8 秒 → 同上

### 4.7 主动轮询兜底（PollingFallback）

```kotlin
// 触发条件：通知监听连续 10 次没收到目标平台通知，且该 App 最近有活跃
// 动作：每 30 秒检查一次目标 App 的未读角标
// 恢复条件：一旦收到一次正常通知，停止轮询
class PollingFallback {
    fun shouldPoll(platform: String): Boolean {
        return missedNotificationCount[platform]!! >= 10
    }

    suspend fun poll(platform: String) {
        // 拉起 App → 看未读角标数 → 有未读就触发 onMessageReceived
        // 这里只是触发，具体流程还是走 handleOne()
    }
}
```

### 4.8 本地敏感词表

```kotlin
object SensitiveWords {
    // 命中任意一个就走安全话术，不调 LLM
    private val words = listOf(
        "钱", "转账", "汇款", "银行卡", "账号", "密码",
        "验证码", "支付宝", "微信支付", "红包", "刷单",
        "贷款", "借款", "投资", "理财", "点击链接",
        "http://", "https://", "加微信", "加v", "加群"
    )

    fun isHit(text: String): Boolean {
        return words.any { text.contains(it) }
    }
}
```

### 4.9 悬浮窗

- 屏幕右边缘中间，8dp 小圆点
- 单击：开/关托管（短震动）
- 长按：打开 App 主界面
- 拖动：沿边缘吸附
- 颜色：绿=托管中 / 灰=暂停 / 红闪=异常

### 4.9.1 UI 设计原则（必须遵守）

**触控反馈（所有按钮和开关）：**
- 点下去要有视觉变化：按钮颜色变深、或缩放 0.95、或加阴影
- 重要操作（开/关托管、发送/取消）点下去要有短震动（VibrationEffect）
- 开关切换时要有 200ms 过渡动画，不要瞬间跳变

**颜色区分开关状态（写死，不要自由发挥）：**

| 状态 | 颜色 | 用在哪 |
|------|------|--------|
| 开启/运行中 | 绿色 #22C55E | AI 托管开、已授权、连接正常 |
| 关闭/空闲 | 灰色 #9CA3AF | AI 托管关、暂停、未授权 |
| 异常/警告 | 红色 #EF4444 | 需要重新登录、封号、API Key 失效 |
| 选中 | 主色蓝色 #3B82F6 | 平台选择、工作模式选中 |
| 未选中 | 白色/浅灰 | 平台选择、工作模式未选中 |

**关键开关的颜色：**
- AI 托管大开关：开=绿色、关=灰色
- 悬浮窗：绿=运行中、灰=暂停、红闪=异常
- 权限项：已授权=绿色✓、未授权=灰色"去设置"按钮
- 工作模式：选中=蓝底白字、未选中=白底灰字

### 4.10 保活

1. 前台服务（常驻通知）
2. 悬浮窗（额外标记）
3. 开机自启（BOOT_COMPLETED 广播）

---

### 4.11 全品牌兼容性保障（小米/华为/OPPO/vivo/三星，Android 10-16）

#### 4.11.1 点击方式硬性规定（解决坐标偏移）

**所有平台适配必须遵守，违者必出 bug：**

| 规则 | 为什么 |
|------|--------|
| **禁止硬编码任何像素坐标** | 不同分辨率/密度/刘海屏会偏移 |
| **优先用 `AccessibilityNodeInfo.performAction(ACTION_CLICK)`** | 直接操作节点对象，不依赖坐标，最可靠 |
| **输入框文本用 `ACTION_SET_TEXT`** | 不用模拟粘贴（paste），不受剪贴板权限影响 |
| **必须用 dispatchGesture 时，坐标从 `boundsInScreen.centerX/Y` 算** | 不写死数字，动态计算节点中心 |
| **禁止假设屏幕尺寸** | 不用 `displayMetrics.widthPixels` 算坐标 |
| **所有等待时间用 `delay()` + 重试，不用固定 sleep** | 不同机型性能差异大，固定 sleep 会超时或太快 |

**错误示例（禁止）：**
```kotlin
// ❌ 硬编码坐标，换个手机就点歪了
gestureController.dispatchGesture(GestureDescription.Builder()
    .addPath(Path().apply { moveTo(540f, 1200f) }).build())
```

**正确示例：**
```kotlin
// ✅ 用节点对象点击
node.performAction(AccessibilityNodeInfo.ACTION_CLICK)

// ✅ 必须用坐标时，从节点 bounds 算
val rect = Rect()
node.getBoundsInScreen(rect)
val cx = rect.centerX()
val cy = rect.centerY()
gestureController.dispatchGesture(GestureDescription.Builder()
    .addPath(Path().apply { moveTo(cx.toFloat(), cy.toFloat()) }).build())
```

#### 4.11.2 各品牌保活引导清单

App 首次启动时，检测当前品牌，弹出对应引导页让用户开设置。**不要只检测 Android 版本，必须单独检测 ROM 品牌。**

**检测品牌：**
```kotlin
val brand = Build.MANUFACTURER  // xiaomi / HUAWEI / OPPO / vivo / samsung
```

**小米 / MIUI / HyperOS（最激进，必须引导）：**
| 设置项 | 路径 | 不开的后果 |
|--------|------|-----------|
| 自启动 | 设置 → 应用设置 → 授权管理 → 自启动管理 → 打开本 App | 开机不启动、被杀后不自恢复 |
| 省电策略 | 设置 → 电量和性能 → 省电优化 → 应用智能省电 → 本 App → 无限制 | 待机几小时后被杀 |
| 锁屏清理 | 最近任务 → 本 App 卡片下拉 → 加锁 | 锁屏后被清理 |
| 无障碍 | 设置 → 更多设置 → 无障碍 → 已下载服务 → 打开本 App | 核心功能不可用 |

**华为 / EMUI / HarmonyOS：**
| 设置项 | 路径 |
|--------|------|
| 启动管理 | 设置 → 应用和服务 → 应用启动管理 → 本 App → 改为手动管理 → 全开 |
| 电池不优化 | 设置 → 电池 → 更多电池设置 → 关闭"自动关闭耗电应用" |
| 锁屏清理 | 最近任务 → 本 App 卡片下拉 → 加锁 |

**OPPO / ColorOS：**
| 设置项 | 路径 |
|--------|------|
| 自启动 | 设置 → 应用管理 → 自启动管理 → 打开本 App |
| 电池不优化 | 设置 → 电池 → 应用电池管理 → 本 App → 不优化 |
| 应用速冻 | 设置 → 电池 → 应用速冻 → 关闭本 App |
| 最近任务加锁 | 最近任务 → 本 App 卡片下拉 → 加锁 |

**vivo / OriginOS / Funtouch OS：**
| 设置项 | 路径 |
|--------|------|
| 自启动 | 设置 → 应用与权限 → 自启动 → 打开本 App |
| 后台高耗电 | i管家 → 应用管理 → 后台耗电管理 → 本 App → 允许 |
| 最近任务加锁 | 最近任务 → 本 App 卡片下拉 → 加锁 |

**三星 / One UI（相对宽松）：**
| 设置项 | 路径 |
|--------|------|
| 电池不受限 | 设置 → 电池和设备维护 → 电池 → 后台使用限制 → 本 App → 不受限制 |
| 关闭自动优化 | 设置 → 电池和设备维护 → 点击"立即优化"时不要勾本 App |

#### 4.11.3 Android 版本适配注意事项（10-16）

| Android 版本 | API | 必须处理的点 |
|-------------|-----|-------------|
| 10 (29) | 后台启动限制 | 不能随便 startActivity，需要用悬浮窗或通知点击来拉起页面 |
| 11 (30) | 包可见性 | AndroidManifest 里 `<queries>` 声明要监听的包名，不然找不到 Soul/QQ 等 App |
| 12 (31) | 前台服务类型 | 必须声明 `foregroundServiceType`，不然服务起不来 |
| 13 (33) | 通知权限 | 必须动态申请 `POST_NOTIFICATIONS` 运行时权限，不然常驻通知弹不出来 |
| 14 (34) | 前台服务更严 | 启动前台服务必须指定类型，且不能从后台启动 |
| 15 (35) | 16KB 页面 | NDK 库要编译成 16KB 对齐（纯 Kotlin 无 NDK 则忽略） |
| 16 (36) | 预测式返回 | 返回手势行为变化，navigateToMessageList 要适配新返回逻辑 |

**最容易翻车的三个版本：**
- **Android 11**：不写 `<queries>` 就根本检测不到其他 App 的通知
- **Android 13**：不申请通知权限，常驻通知直接不显示
- **Android 14**：前台服务类型不对，启动即崩

#### 4.11.4 首次启动引导流程

```
首次打开 App
  ↓
检测 Build.MANUFACTURER 是什么品牌
  ↓
按品牌显示对应设置引导页（上面那张表）
  ↓
逐一步骤引导用户开：
  1. 无障碍服务
  2. 通知监听
  3. 悬浮窗权限
  4. 自启动（按品牌显示不同路径）
  5. 电池不优化（按品牌显示不同路径）
  ↓
每步都有"去设置"按钮，点了直接跳对应系统页面
  ↓
全部开完后，测试一下通知监听和无障碍是否生效
  ↓
进入主界面
```

**关键：引导页不要让用户自己找设置。每个设置项都要有"去设置"按钮，用 Intent 直接跳转到对应系统页面。**

跳系统设置页的 Intent：
- 无障碍：`Settings.ACTION_ACCESSIBILITY_SETTINGS`
- 通知监听：`Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS`
- 悬浮窗：`Settings.ACTION_MANAGE_OVERLAY_PERMISSION`
- 自启动（各品牌不同，用包名 + 类名直接跳）

---

## 5. 安全与风控（汇总表）

| 场景 | 怎么做 |
|------|--------|
| API 鉴权 | 请求头 `Authorization: Bearer <token>`，后端 D1 查 token 表 |
| 防重复回复 | `md5(platform + contactId + content)`，5 分钟窗口 |
| 联系人白名单 | 后端查 contacts 表，不在白名单直接返回 skip |
| 超时保护 | 单次处理 150 秒，超时放弃 + 记日志 |
| 违规弹窗 | fillAndSend 返回 BANNED → 关弹窗 → 暂停该平台 |
| 消息加密 | D1 存的是明文，但传输全程 HTTPS；单用户场景不做应用层加密 |
| 人工接管 | 发送前 100ms 触摸检测；打断时清空输入框 |
| 消息合并 | 500ms 短窗口启动，LLM 期间新消息来就作废旧回复重算 |
| 敏感词 | App 本地词表优先，命中不走 LLM |
| 多设备冲突 | v1 不处理（单用户单设备为主），Dashboard 不做多设备协调 |

---

## 6. 开发顺序与验收标准

### Step 1: 后端骨架（预计先做）

**做什么：**
- 创建 Cloudflare Pages 项目
- 建 D1 数据库，执行 schema.sql
- 建 KV namespace
- 配置 Secrets（DEEPSEEK_API_KEY、DASHBOARD_PASSWORD）
- 写通 `/api/chat`、`/api/status`、`/api/config`
- 写通 `/api/contacts`、`/api/persona`

**验收：**
- 用 curl 能调通 `/api/chat`，传 Soul 的假消息能拿到 DeepSeek 回复
- 传不在白名单的 contact，返回 `{"action":"skip"}`
- `/api/status` 返回 `llm_ping: "ok"`

### Step 2: App 骨架

**做什么：**
- Kotlin + Compose 三个 Tab（控制台/记录/设置）
- 悬浮窗
- 前台服务 + 通知
- 无障碍服务 + 通知监听服务（先只监听不做任何操作）
- 输入 token 的设置页（存 Room）
- OkHttp 调通 `/api/chat`

**验收：**
- 悬浮窗能开关
- 收到 Soul 通知能在 logcat 里打出来
- 点"测试"按钮能调通后端拿到回复

### Step 3: Soul 端到端跑通

**做什么：**
- 实现 SoulAdapter 的 7 个方法
- 实现 MessageEngine 状态机
- 实现去重、去抖、敏感词
- 实现发送前触摸检测

**验收（最重要的一步）：**
- 给 Soul 里一个白名单联系人发条消息
- App 自动拉前台 → 读消息 → 调云端 → 粘贴发送
- 全程用户不用碰手机
- 发完自动退回消息列表等下一条
- 用户碰屏幕时，AI 在发送前停手并清空输入框
- 连续发 3 条消息，AI 只回一次（去抖生效）

### Step 4: 扩展其他平台

**做什么：**
- QQAdapter（处理 v8/v9 版本差异）
- ImmomoAdapter（UI 结构深，启发式搜索）
- LianxinAdapter（双包名兼容）
- Dashboard 前端页面

**验收：**
- 四个平台都能端到端跑通
- Dashboard 能看聊天记录、切换人设、管白名单、管钥匙

---

## 7. 提前警告：这些坑一定会遇到

1. **通知监听不稳定**：有些 App 不弹标准通知。→ 单平台模式下 UI 事件监听为主，通知为辅。
2. **半截消息**：AI 正在粘贴时用户碰屏幕。→ 发送前 100ms 检查 + 打断清空输入框。
3. **连续消息**：对方连发 3 条。→ 不傻等去抖，500ms 短窗口启动 + LLM 期间新消息来就作废旧回复重算。
4. **误回复陌生人**：点进聊天页才发现不在白名单。→ 在消息列表就先筛白名单。
5. **平台更新改 UI**：View ID 变了。→ isInChat/isInMessageList 用 ≥2 个 ID 交叉验证。
6. **被封号**：连续操作太快。→ 每个动作之间 delay 500-1500ms，模拟真人速度。
7. **App 被杀**：→ 前台服务 + 悬浮窗 + 开机自启 + 各品牌自启动引导（见 §4.11.2）。
8. **DeepSeek 限流**：多平台同时来消息。→ 单平台串行处理，不并发。
9. **历史太长 token 爆**：→ 20 轮原文 + summary 策略。
10. **用户在聊天时 AI 抢话**：→ onPageChanged 检测到用户手动进聊天页，AI 进入旁观模式。
11. **坐标偏移**：换个手机点歪了。→ 禁止硬编码坐标，一律用节点 performAction 点击（见 §4.11.1）。
12. **各品牌杀后台**：小米最狠，华为次之，三星最松。→ 首次启动按品牌引导用户开自启动和电池白名单（见 §4.11.2）。
13. **Android 11+ 找不到其他 App**：→ Manifest 里写 `<queries>` 声明包名。
14. **Android 13+ 通知不弹**：→ 动态申请 POST_NOTIFICATIONS 权限。
15. **时间感错乱**：早上的消息晚上回，AI 说"早上好"。→ system 里必须传当前时间，历史消息必须带时间戳（见 §3.6）。
16. **长期未回复后角色搞反**：AI 说"你怎么消失了"。→ system 规则明确"消失的人是你，不是对方"，并标注"对方最后一条是 X 小时前发的"。
17. **编造与对方矛盾的事实**：对方说冷 AI 说热。→ system 规则明确"不要编造与对方矛盾的事实"。

---

## 8. 默认参数（写死，不要改）

| 参数 | 值 |
|------|-----|
| 首条短窗口 | 500ms（收到第一条后等这么久看对方还发不发） |
| LLM 重算上限 | 3 次（超过就强制发送） |
| 最大等待时间 | 8 秒（从首条消息算起，超过就强制发送） |
| 去重窗口 | 5 分钟 |
| 单次超时 | 150 秒 |
| 原文窗口 | 20 轮（40 条） |
| 摘要重算触发 | 新增 10 条 |
| 摘要长度 | ≤ 200 字 |
| 发送前检查 | 100ms |
| 轮询间隔 | 30 秒 |
| 通知失效阈值 | 连续 10 次未收到 → 启用轮询 |
| temperature | 0.7 |
| max_tokens | 300 |
| 动作间 delay | 500–1500ms（随机，模拟真人） |
