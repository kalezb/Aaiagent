# 补充页：QQ 适配器开发指南

> 基于 v2.0 的补充 | 2026-09-23
> 所有 View ID 均通过 USB 调试实测抓取，真实有效

---

## 一、QQ 基本信息

- **包名**：`com.tencent.mobileqq`
- **当前 QQ 版本**：实测版（用户手机上的版本）

---

## 二、页面识别规则（detectPage）

### 消息列表页怎么判断
查 `com.tencent.mobileqq:id/o8n`（RecyclerView 会话列表）存在 → MESSAGE_LIST

### 聊天页怎么判断
同时满足：
- 有 `com.tencent.mobileqq:id/input`（输入框 EditText）
- 有 `com.tencent.mobileqq:id/send_btn`（发送按钮 Button）
→ CHAT_ROOM

### 其他页面（联系人/动态/频道）
- 有底部 tab（`com.tencent.mobileqq:id/kbi`）但没有 o8n 和 input
→ 按底部"消息"tab 跳回消息列表

---

## 三、页面导航（navigateToMessageListFromCurrent）

| 当前页面 | 怎么做 |
|----------|--------|
| 消息列表 | 不用动 |
| 聊天页 | 点 `com.tencent.mobileqq:id/ivTitleBtnLeft`（content-desc="返回消息"） |
| 联系人/动态/频道 | 点底部 tab 中 text="消息" 的那个（ID：`com.tencent.mobileqq:id/kbi`） |
| 不认识 | 按返回键，最多退 3 次 |

---

## 四、消息列表里要找的东西

| 元素 | View ID | 怎么用 |
|------|---------|--------|
| 会话列表容器 | `com.tencent.mobileqq:id/o8n` | RecyclerView，遍历它的子项 |
| 单个会话项 | `com.tencent.mobileqq:id/o8c` | clickable=true，每个会话一行 |
| 对方昵称 | `com.tencent.mobileqq:id/title` | 会话项里的标题 TextView |
| 消息预览 | 会话项里的 TextView（无固定 ID） | 读 text 内容 |
| 未读数字 | `com.tencent.mobileqq:id/khc` | content-desc 是纯数字（如"2"） |
| 会话头像 | `com.tencent.mobileqq:id/a2o` | 会话项左边的头像 |

**注意：** 会话项的 content-desc 里直接包含了所有信息，格式是：
```
"昵称, ,有2条未读,消息预览,时间"
```
比如：`"测试语音, ,有2条未读,您生成的可用于访问GitHub API 的令牌。,凌晨0:45"`

**判断未读：** 查会话项里有没有 `com.tencent.mobileqq:id/khc`，有就是有未读。

---

## 五、聊天页里要找的东西

### 顶部导航栏

| 元素 | View ID | content-desc |
|------|---------|-------------|
| 返回按钮 | `com.tencent.mobileqq:id/ivTitleBtnLeft` | "返回消息" |
| 对方昵称 | `com.tencent.mobileqq:id/20r` | （text 直接是昵称） |
| 在线状态 | `com.tencent.mobileqq:id/j64` | （text="在线"/"离线"） |
| 聊天设置 | `com.tencent.mobileqq:id/004` | "聊天设置" |

### 消息气泡

| 元素 | View ID | 说明 |
|------|---------|------|
| 消息容器 | `com.tencent.mobileqq:id/root` | 每条消息一个 |
| 消息文本 | `com.tencent.mobileqq:id/mj0` | TextView，所有消息文本都用这个 ID |
| 头像容器 | `com.tencent.mobileqq:id/vd0` | 每条消息的头像 |
| 时间分隔 | `com.tencent.mobileqq:id/f24` | TextView（如"凌晨0:45"） |

### 底部输入区

| 元素 | View ID | 类型 |
|------|---------|------|
| 输入框 | `com.tencent.mobileqq:id/input` | EditText |
| 发送按钮 | `com.tencent.mobileqq:id/send_btn` | Button（text="发送"） |

---

## 六、怎么区分"对方发的"和"我发的"

**最可靠的方法：看头像的 content-desc**

| 头像 content-desc | 说明 |
|-------------------|------|
| `"测试语音的资料卡"`（对方昵称+资料卡） | 对方发的 |
| `"我的资料卡"` | 我发的 |

**备选方法：看头像位置**
- 头像在屏幕左边（bounds x1≈32）→ 对方
- 头像在屏幕右边（bounds x1≈940）→ 我

**推荐用第一种**，content-desc 直接告诉你是谁，不用猜位置。

---

## 七、fillAndSend 流程（QQ 版）

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

---

## 七补、消息类型识别（QQ 版）

| 类型 | 怎么判断 | 怎么处理 |
|------|---------|---------|
| 文字消息 | 有 `mj0`（消息文本ID） | 直接读文字，调 LLM |
| 图片消息 | 没有 mj0，但有图片框 | 先回"你打字告诉我呗"，以后接视觉模型 |
| 表情包 | 没有 mj0，有小表情图 | 同上 |
| 语音消息 | 没有 mj0，有语音条 | 回"我听不了语音，你打字说" |
| 系统消息 | 时间分隔 `f24` | 直接跳过 |

**关键：只读 `mj0` 这个 ID 的文字，其他的全当没看见。**

---

## 八、clickFirstUnreadConversation 流程（QQ 版）

```
1. 找消息列表 RecyclerView（id/o8n）
2. 遍历每个会话项（id/o8c）
3. 读会话项里的 title（id/title）→ 对方昵称
4. 查白名单 → 不在就跳过
5. 查会话项里有没有未读标记（id/khc）→ 有就点
6. 点之前做 MD5 指纹去重（避免重复点同一个会话）
```

---

## 九、注意事项

1. **QQ 的 View ID 是混淆过的**（如 `o8n`、`mj0`、`vd0`），QQ 更新版本后这些 ID 可能变。如果版本一致就没问题，版本变了要重新抓。

2. **消息文本都在 `com.tencent.mobileqq:id/mj0` 里**，不管是你发的还是对方发的，都是这个 ID。靠头像 content-desc 区分方向。

3. **发送按钮初始是 disabled 的**，输入文字后才变 enabled。所以填入文本后要等一下再点。

4. **QQ 底部 tab 有 4 个**：消息、频道、联系人、动态。回到消息列表就是点 text="消息" 的那个 tab（ID 都是 `com.tencent.mobileqq:id/kbi`）。
