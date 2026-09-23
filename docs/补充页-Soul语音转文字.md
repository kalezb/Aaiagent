# 补充页 - Soul 语音转文字开发指南

## 一、语音消息识别

### 1.1 识别特征
```kotlin
// 语音消息 View ID
val voiceBubbleId = "cn.soulapp.android:id/voice_bubble"
val voiceLengthId = "cn.soulapp.android:id/tv_length"

// 判断方法
fun isVoiceMessage(node: AccessibilityNodeInfo): Boolean {
    // 有 voice_bubble 节点，且 content-desc 是 "语音消息"
    val voiceBubble = findNodeById(node, voiceBubbleId)
    return voiceBubble != null && voiceBubble.contentDescription == "语音消息"
}
```

### 1.2 获取语音时长
```kotlin
fun getVoiceDuration(node: AccessibilityNodeInfo): String? {
    // tv_length 节点里的文字，比如 "2''"、"3''"
    val lengthNode = findNodeById(node, voiceLengthId)
    return lengthNode?.text?.toString()
}
```

---

## 二、语音转文字完整流程

### 2.1 流程概述
```
1. 找到语音消息节点
2. 长按语音消息 2 秒
3. 截图，用视觉模型找"转文字"按钮位置
4. 点"转文字"按钮
5. 等 2-3 秒
6. 再截图，读转出来的文字
```

### 2.2 详细步骤

#### 步骤 1：找到语音消息节点
```kotlin
fun findVoiceMessages(root: AccessibilityNodeInfo): List<AccessibilityNodeInfo> {
    val voiceMessages = mutableListOf<AccessibilityNodeInfo>()
    
    // 遍历所有消息项
    val messageItems = findNodesById(root, "cn.soulapp.android:id/item_root")
    
    for (item in messageItems) {
        // 判断是不是语音消息
        if (isVoiceMessage(item)) {
            voiceMessages.add(item)
        }
    }
    
    return voiceMessages
}
```

#### 步骤 2：长按语音消息
```kotlin
fun longPressVoiceMessage(voiceNode: AccessibilityNodeInfo) {
    // 获取语音消息的坐标
    val bounds = Rect()
    voiceNode.getBoundsInScreen(bounds)
    
    // 长按 2 秒
    val centerX = bounds.centerX()
    val centerY = bounds.centerY()
    performLongClick(centerX, centerY, 2000)
}
```

#### 步骤 3：截图 + 视觉模型找"转文字"按钮
```kotlin
suspend fun findTranscribeButtonByVision(): Point? {
    // 1. 截图
    val screenshot = takeScreenshot()
    
    // 2. 用视觉模型找"转文字"三个字的位置
    val prompt = """
        在这张截图里，找"转文字"这三个字的位置。
        它应该在一个黑色的圆角菜单里，上面一排有5个按钮：回复、听筒播放、转文字、删除、反馈。
        返回"转文字"按钮的中心坐标（x, y），用像素表示。
        如果找不到，返回 null。
    """
    
    val result = visionModel.analyze(screenshot, prompt)
    
    // 3. 解析结果
    return parseCoordinates(result)
}
```

#### 步骤 4：点"转文字"按钮
```kotlin
fun tapTranscribeButton(point: Point) {
    performTap(point.x, point.y)
}
```

#### 步骤 5：等转写完成
```kotlin
suspend fun waitForTranscribeComplete() {
    // 等 2-3 秒
    delay(2500)
}
```

#### 步骤 6：读转出来的文字
```kotlin
suspend fun getTranscribedText(voiceNode: AccessibilityNodeInfo): String? {
    // 转出来的文字在语音消息下面，是灰色气泡
    // 我们需要重新抓UI树，找到语音消息下面的文字节点
    
    // 重新抓UI树
    val newRoot = getCurrentRootNode()
    
    // 找语音消息
    val voiceMessages = findVoiceMessages(newRoot)
    
    // 找到我们刚转的那条语音
    // （用语音时长或者位置来匹配）
    val targetVoice = voiceMessages.find { it == voiceNode } ?: return null
    
    // 找语音消息下面的文字节点
    // （转出来的文字是灰色气泡，在语音消息下面）
    val transcribedText = findTranscribedTextBelowVoice(targetVoice)
    
    return transcribedText
}
```

---

## 三、多条语音批量转文字

### 3.1 批量转写流程
```kotlin
suspend fun transcribeAllVoiceMessages(): List<Pair<String, String>> {
    val results = mutableListOf<Pair<String, String>>()
    
    // 1. 找到所有语音消息
    val root = getCurrentRootNode()
    val voiceMessages = findVoiceMessages(root)
    
    // 2. 从下面开始，逐条转写
    for (voiceNode in voiceMessages.reversed()) {
        try {
            // 长按语音
            longPressVoiceMessage(voiceNode)
            
            // 找"转文字"按钮
            val transcribeBtn = findTranscribeButtonByVision() ?: continue
            
            // 点"转文字"按钮
            tapTranscribeButton(transcribeBtn)
            
            // 等转写完成
            waitForTranscribeComplete()
            
            // 读转出来的文字
            val transcribedText = getTranscribedText(voiceNode) ?: continue
            
            // 获取语音时长
            val duration = getVoiceDuration(voiceNode) ?: "未知时长"
            
            // 保存结果
            results.add(Pair(duration, transcribedText))
            
        } catch (e: Exception) {
            // 出错了，记录错误，继续下一条
            logError("转写语音失败: ${e.message}")
            continue
        }
    }
    
    return results
}
```

---

## 四、错误处理

### 4.1 常见错误
```kotlin
sealed class TranscribeError {
    object VoiceLongClickFailed : TranscribeError() // 语音长按失败
    object TranscribeButtonNotFound : TranscribeError() // 转文字按钮没找到
    object TranscribeClickFailed : TranscribeError() // 转文字按钮点击失败
    object TranscribeTimeout : TranscribeError() // 转写超时
    object TranscribedTextNotFound : TranscribeError() // 转出来的文字没找到
}
```

### 4.2 重试机制
```kotlin
suspend fun transcribeWithRetry(voiceNode: AccessibilityNodeInfo, maxRetry: Int = 2): String? {
    repeat(maxRetry) { attempt ->
        try {
            // 长按语音
            longPressVoiceMessage(voiceNode)
            
            // 找"转文字"按钮
            val transcribeBtn = findTranscribeButtonByVision() ?: throw TranscribeButtonNotFound
            
            // 点"转文字"按钮
            tapTranscribeButton(transcribeBtn)
            
            // 等转写完成
            waitForTranscribeComplete()
            
            // 读转出来的文字
            val transcribedText = getTranscribedText(voiceNode) ?: throw TranscribedTextNotFound
            
            return transcribedText
            
        } catch (e: Exception) {
            logError("第 ${attempt + 1} 次转写失败: ${e.message}")
            
            // 关掉菜单（点屏幕中间）
            performTap(540, 1200)
            delay(500)
        }
    }
    
    return null // 重试多次都失败了
}
```

---

## 五、注意事项

1. **菜单是自绘浮层**，uiautomator抓不到，所以必须用截图+视觉模型找"转文字"按钮
2. **从下面开始转写**，因为转写后语音消息下面会多出文字，会影响上面消息的位置
3. **每条语音之间等 1 秒**，避免操作太快
4. **如果连续失败 3 条**，就停止，记录日志，不要一直试
5. **转写完成后**，转出来的文字是灰色气泡，下面还有个"点击收起"按钮

---

## 六、完整代码示例

```kotlin
class SoulVoiceTranscriber(
    private val service: AccessibilityService,
    private val visionModel: VisionModel
) {
    
    suspend fun transcribeAllVoices(): List<VoiceMessage> {
        val results = mutableListOf<VoiceMessage>()
        
        // 1. 找到所有语音消息
        val root = service.rootInActiveWindow ?: return results
        val voiceNodes = findVoiceMessages(root)
        
        // 2. 从下面开始，逐条转写
        for (voiceNode in voiceNodes.reversed()) {
            val duration = getVoiceDuration(voiceNode) ?: "0:00"
            
            try {
                // 长按语音
                longPressVoiceMessage(voiceNode)
                delay(1000)
                
                // 找"转文字"按钮
                val btnPos = findTranscribeButtonByVision() ?: continue
                
                // 点"转文字"按钮
                performTap(btnPos.x, btnPos.y)
                delay(2500)
                
                // 读转出来的文字
                val text = getTranscribedText(voiceNode) ?: continue
                
                results.add(VoiceMessage(duration, text))
                
            } catch (e: Exception) {
                logError("转写语音失败: $duration - ${e.message}")
                // 关掉菜单
                performTap(540, 1200)
                delay(500)
            }
        }
        
        return results
    }
    
    // ... 其他方法
}

data class VoiceMessage(
    val duration: String,
    val text: String
)
```
