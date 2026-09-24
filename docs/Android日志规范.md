# Android 关键路径日志规范

## 适用场景
给任何 Android App（无障碍服务、消息处理、自动化流程）添加调试日志，方便通过 `adb logcat` 远程诊断。

## 统一规范

- **Tag 前缀**：统一用一个前缀，如 `AIA`，过滤命令 `adb logcat -s AIA:* -v time`
- **每条日志带函数缩写**：如 `pc:`（processConversation）、`send:`（sendSplitReply）、`sa:`（SoulAdapter）
- **带关键变量值**：消息条数、联系人名、回复长度、API action 等

## 关键埋点位置

### 1. 函数入口
```kotlin
android.util.Log.d("TAG", "func: ENTER platform=X mode=Y contact=Z")
```
**目的**：确认函数是否被调用，调用参数是什么。

### 2. 数据读取后
```kotlin
android.util.Log.d("TAG", "func: read N msgs, last=" + (lastMsg?.take(50) ?: "none"))
```
**目的**：确认数据是否成功读到，内容是什么。

### 3. API/网络调用前
```kotlin
android.util.Log.d("TAG", "func: calling API for contact=X msgs=N token=" + token.take(8))
```
**目的**：确认请求参数，排查后端连接问题。

### 4. API/网络调用后
```kotlin
android.util.Log.d("TAG", "func: API reply len=N action=X")
```
**目的**：确认 API 返回了什么，是否 skip、error、正常。

### 5. UI 操作前（点击、填字、滑动）
```kotlin
android.util.Log.d("TAG", "func: tapping at (X, Y) name='contactName'")
android.util.Log.d("TAG", "func: filling text len=N")
```
**目的**：确认自动化操作是否触发，目标是什么。

### 6. UI 操作后（结果检查）
```kotlin
android.util.Log.d("TAG", "func: text set result=" + result)
android.util.Log.d("TAG", "func: send button found at (X, Y)")
```
**目的**：确认操作是否成功。

### 7. 异常/错误
```kotlin
android.util.Log.w("TAG", "func: title mismatch! expected=X got=Y")
android.util.Log.e("TAG", "func: crashed", exception)
```
**目的**：记录异常情况和崩溃堆栈。

### 8. 函数出口（关键分支）
```kotlin
android.util.Log.d("TAG", "func: EXIT reason=success/done/skip/error")
```
**目的**：确认函数正常退出还是提前返回。

## 诊断方法

```
# 清空旧日志
adb logcat -c

# 只看自己 Tag
adb logcat -s AIA:* -v time

# 找最后一条日志，看卡在哪两个埋点之间
# 例如：看到 "pc: ENTER" 但没看到 "pc: read X msgs"
#         → 卡在消息读取环节
```

## 示例：完整流程日志

```
22:31:56 pc: ENTER platform=soul mode=FULL_AUTO
22:31:57 pc: read 3 msgs, last=你好呀在干嘛
22:31:58 pc: calling LLM for contact=小明 msgs=3
22:32:00 pc: LLM reply len=12 action=reply
22:32:01 send: sending sentence idx=0 len=12
22:32:01 sa: text set result=true
22:32:02 sa: send button found, clicking
22:32:03 pc: EXIT reason=success
```

如果某条日志缺失，问题就在缺失的那两步之间。
