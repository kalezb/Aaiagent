# Soul 转发动态卡片 UI 结构

抓取环境：

- Soul 聊天页
- 屏幕分辨率：1080 x 2252
- 卡片示例：《另一面的我》转发动态

## 节点结构

```text
item_root
└── layout_content
    ├── timestamp (可选，仅在时间分组节点出现)
    ├── chat_avatar
    │   └── avatar
    └── container
        └── newUIRootContainer
            └── cardRoot
                ├── image
                ├── shadow
                ├── avatar
                ├── nickName
                └── bottomArea
                    └── content
        └── momentQuickReplyEmojiView
            ├── ivMomentQuickReplyEmoji
            ├── tvMomentQuickReplyEmoji
            ├── ivMomentQuickReplyEmoji
            ├── tvMomentQuickReplyEmoji
            ├── ivMomentQuickReplyEmoji
            └── tvMomentQuickReplyEmoji
```

该示例中的字段：

```text
cardRoot
newUIRootContainer
image
nickName = 另一面的我
content = 今天穿了双新买的高跟鞋，走路时感觉自己气场都变强了...
momentQuickReplyEmojiView
tvMomentQuickReplyEmoji = 捂脸哭
tvMomentQuickReplyEmoji = 吃瓜
tvMomentQuickReplyEmoji = 狗子
```

## 识别规则

- `cardRoot` 是转发动态卡片的核心标识。
- `nickName` 是卡片作者昵称。
- `content` 是动态正文。
- `image` 是动态图片，不代表聊天图片消息。
- `momentQuickReplyEmojiView` 及其子节点是 Soul 自动生成的快捷回复表情，不代表对方发送了表情消息。
- 卡片之后的普通聊天文字仍位于另一个 `item_root` 的 `content_text` 中。
- 卡片之后由对方单独发送的表情仍位于独立 `item_root` 的 `la_light_interaction` 等节点中。

## Agent 映射

Android 适配器输出：

```text
type = moment_card
content = [转发瞬间] 另一面的我：今天穿了双新买的高跟鞋，走路时感觉自己气场都变强了...
```

系统生成的快捷回复表情不写入聊天消息列表，也不作为媒体目标触发内部表情处理。
