# 补充页：QQ 消息类型识别 + 语音转文字实测

> 基于 USB 实测 | 2026-09-24
> 所有 View ID 都是从你手机上抓的真实数据



***

## 一、QQ 消息类型识别（实测版）

### 怎么判断对方发的是什么类型



| 类型           | 怎么判断（看消息容器里有没有这些 View ID）                                  | 怎么处理                  |
| ------------ | ---------------------------------------------------------- | --------------------- |
| **文字消息**     | 有 `mj0`（消息文本 TextView）                                     | 直接读文字，调 LLM           |
| **语音消息**     | 没有 mj0，但有 `wqe`（时长文字，显示 "0:27"） + `wqr`/`wqd`/`wqj`（语音条容器） | 长按语音条 → 点 "转文字" → 读结果 |
| **电话未接通**    | 有 `mkr`（显示 "未接听，点击回拨"）                                     | 跳过，不回复                |
| **时间分隔**     | 有 `f24`（显示 "凌晨 0:45" 等）                                    | 跳过，不回复                |
| **图片 / 表情包** | 没有 mj0，也没有 wqe/mkr → 就是图片或表情                               | 先回 "你打字告诉我呗"          |

### 判断逻辑（代码思路）



```
fun detectMessageType(messageNode: AccessibilityNodeInfo): MessageType {
    // 1. 有 mj0 → 文字
    if (findById(messageNode, "com.tencent.mobileqq:id/mj0") != null) {
        return MessageType.TEXT
    }
    
    // 2. 有 mkr → 电话未接通
    if (findById(messageNode, "com.tencent.mobileqq:id/mkr") != null) {
        return MessageType.CALL_MISSED
    }
    
    // 3. 有 wqe（时长文字）→ 语音
    if (findById(messageNode, "com.tencent.mobileqq:id/wqe") != null) {
        return MessageType.VOICE
    }
    
    // 4. 有 f24 → 时间分隔
    if (findById(messageNode, "com.tencent.mobileqq:id/f24") != null) {
        return MessageType.SYSTEM
    }
    
    // 5. 都不是 → 图片或表情
    return MessageType.IMAGE_OR_STICKER
}
```



***

## 二、语音消息的完整结构

### 语音消息的 View ID 列表



| 元素         | View ID                        | 说明                  |
| ---------- | ------------------------------ | ------------------- |
| 消息容器       | `com.tencent.mobileqq:id/root` | 每条消息一个              |
| 头像         | `com.tencent.mobileqq:id/vd0`  | 左边 = 对方，右边 = 我      |
| 语音条容器      | `com.tencent.mobileqq:id/wqr`  | LinearLayout        |
| 语音条布局      | `com.tencent.mobileqq:id/wqd`  | RelativeLayout      |
| 语音条内部      | `com.tencent.mobileqq:id/wqj`  | RelativeLayout      |
| 语音图标 1     | `com.tencent.mobileqq:id/wqi`  | ImageView（语音波形）     |
| **时长文字**   | `com.tencent.mobileqq:id/wqe`  | TextView（显示 "0:27"） |
| 语音图标 2     | `com.tencent.mobileqq:id/wqg`  | ImageView           |
| 右边小按钮      | `com.tencent.mobileqq:id/wqn`  | ImageView           |
| 右边另一个 View | `com.tencent.mobileqq:id/wqb`  | View                |

**关键：判断语音消息，只需要看有没有&#x20;**`wqe`**（时长文字）就够了。**



***

## 三、语音转文字完整流程（实测跑通）

### 步骤 1：识别语音消息



* 没有 mj0（文字气泡）

* 有 wqe（时长文字，显示 "0:27"）

* 有 wqr/wqd/wqj（语音条容器）

### 步骤 2：长按语音消息



```
// 找到语音消息的位置（wqe 的中心点）
val voiceNode = findById(root, "com.tencent.mobileqq:id/wqe")
val bounds = Rect()
voiceNode.getBoundsInScreen(bounds)
val centerX = bounds.centerX()
val centerY = bounds.centerY()

// 长按 2 秒
gestureDetector.longPress(centerX, centerY, durationMs = 2000)
delay(1000)  // 等菜单弹出来
```

### 步骤 3：点 "转文字" 按钮

**注意：QQ 的长按菜单是自绘浮层，uiautomator 抓不到 UI 树，只能用坐标点击。**

"转文字" 按钮位置（相对屏幕比例）：



* x = 屏幕宽度 \* 0.25（上面一排第二个）

* y = 屏幕高度 \* 0.69（菜单在屏幕中间偏下）



```
val screenWidth = resources.displayMetrics.widthPixels  // 1080
val screenHeight = resources.displayMetrics.heightPixels  // 2400

val transcribeX = screenWidth * 0.25f  // 270
val transcribeY = screenHeight * 0.69f  // 1656

gestureDetector.tap(transcribeX, transcribeY)
```

### 步骤 4：等转文字结果



```
delay(2000)  // 等 2 秒让它转完
```

### 步骤 5：读转出来的文字

转出来的文字 View ID 是 `wql`（TextView），就在语音消息的同一个 `root` 容器里，在语音条（`wqr`）的下面。

**结构：**



```
root（消息容器）
├── vd0（头像）
└── opv（消息内容）
    ├── wqd（语音条容器）
    │   └── wqr（语音条）
    │       ├── wqj（语音图标）
    │       └── wqe（时长文字"2"）
    └── wqo（FrameLayout）← 转文字结果容器
        └── wqk（LinearLayout）
            └── wql（TextView）← 转出来的文字在这里！
```

**判断是否已经转过文字：**

在语音消息的 `root` 容器里找 `wql`，如果找到，说明已经转过了，直接读 `wql.text` 就行。



```
fun readTranscribedTextBelow(voiceRootNode: AccessibilityNodeInfo): String? {
    // 在语音消息的 root 容器里找 wql
    val wqlNode = findByIdInNode(voiceRootNode, "com.tencent.mobileqq:id/wql")
    return wqlNode?.text?.toString()
}
```

**推荐方案：** 直接找 `wql`，100% 准确。

**兜底方案：** 如果找不到 `wql`，就截图 + 视觉模型识别。

### 完整代码框架



```
suspend fun transcribeVoiceMessage(voiceNode: AccessibilityNodeInfo): String? {
    // 1. 长按语音消息
    val bounds = Rect()
    voiceNode.getBoundsInScreen(bounds)
    val centerX = bounds.centerX()
    val centerY = bounds.centerY()
    gestureDetector.longPress(centerX, centerY, durationMs = 2000)
    delay(1000)

    // 2. 点"转文字"按钮（固定坐标比例）
    val screenWidth = resources.displayMetrics.widthPixels
    val screenHeight = resources.displayMetrics.heightPixels
    val transcribeX = screenWidth * 0.25f
    val transcribeY = screenHeight * 0.69f
    gestureDetector.tap(transcribeX, transcribeY)
    delay(2000)

    // 3. 读转出来的文字
    // TODO: 找到转出来文字的 View ID 后，在这里读
    val transcribedText = readTranscribedTextBelow(voiceNode)
    
    return transcribedText
}
```



***

## 四、怎么区分对方发的还是我发的

### 方法 1：看头像位置（最简单）



| 头像位置            | 说明   |
| --------------- | ---- |
| 头像在左边（x1 < 500） | 对方发的 |
| 头像在右边（x1 > 500） | 我发的  |

### 方法 2：看消息气泡位置



| 气泡位置  | 说明   |
| ----- | ---- |
| 气泡在左边 | 对方发的 |
| 气泡在右边 | 我发的  |

**推荐用方法 1（头像位置），最可靠。**



***

## 五、其他消息类型

### 电话未接通



* View ID：`mkr`

* 文字："未接听，点击回拨"

* 处理：跳过，不回复

### 时间分隔



* View ID：`f24`

* 文字："凌晨 0:45" 等

* 处理：跳过，不回复



***

## 六、验收标准



1. ✓ 能区分文字 / 语音 / 电话 / 时间分隔

2. ✓ 语音消息能识别出来（有 wqe = 语音）

3. ✓ 能区分对方发的还是我发的

4. ✓ 长按语音能弹菜单

5. ✓ 点 "转文字" 按钮（坐标比例 0.25, 0.69）能转文字

6. 待补：转出来的文字的 View ID 是什么