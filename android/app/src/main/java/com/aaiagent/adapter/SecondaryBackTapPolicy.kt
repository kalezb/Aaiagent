package com.aaiagent.adapter

/**
 * 离开页面时用哪种方式返回。
 *
 * 历史（2026-10-05 联系人=遇见）：Soul 聊天页左上角的返回节点
 * item_left_back bounds=[28,141][112,225] 和未读角标 text_new_message bounds=[28,138][160,228]
 * 完全重叠，点节点中心 (70,183) 会落到角标/头像上，结果跑进别人的个人资料页。
 *
 * 2026-10-07（用户实测 + 真机日志）：
 *  - 实测：点左上角“未读角标”那一带 → 100% 回消息列表；点头像/主页 → 100% 进资料页。
 *  - 日志：聊天页里发消息的同一秒被判 chat=false（输入框和消息项都短暂不在树里），
 *    导航于是走“未知页”分支，按返回没用时会退回点节点 —— 那一下就有概率落到头像上。
 *  - 结论：**永远不要点左上角的节点**。系统返回键不管用时，改用“左边缘返回手势”，
 *    坐标固定从屏幕最左侧起，物理上不可能碰到头像。
 */
object SecondaryBackTapPolicy {

    /**
     * 连续按了几次系统返回还没离开当前页，才改用“左边缘返回手势”。
     * 默认第 2 次就用，比点节点安全得多。
     */
    fun shouldUseBackGesture(streak: Int, limit: Int = 1): Boolean {
        return streak > limit
    }

    fun overlaps(
        aLeft: Int, aTop: Int, aRight: Int, aBottom: Int,
        bLeft: Int, bTop: Int, bRight: Int, bBottom: Int,
    ): Boolean {
        return aLeft < bRight && bLeft < aRight && aTop < bBottom && bTop < aBottom
    }
}

/**
 * 2026-10-07：聊天页判定。抽成纯函数方便单测。
 *
 * 真机证据：在聊天页正常发消息的同一秒，输入框和消息项都可能短暂不在无障碍树里，
 * 只看这两样就会误判成“未知页”，进而触发危险的返回兜底。标题栏是聊天页专属节点，
 * 它写着对方名字时，就该按聊天页处理。
 */
object ChatPagePolicy {

    fun isChatPage(
        inputBoxVisible: Boolean,
        titleBarVisible: Boolean,
        titleVisible: Boolean,
        titleText: String,
        messageItemCount: Int,
    ): Boolean {
        if (inputBoxVisible) return true
        if (!titleBarVisible && !titleVisible) return false
        if (titleVisible && titleText.isNotBlank()) return true
        return messageItemCount > 0
    }
}
