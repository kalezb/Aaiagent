package com.aaiagent.engine

/** 新核心入口这一轮的结果，决定要不要往下翻页。 */
internal enum class SoulEntryStep {
    /** 真的打开了聊天页，并且跑完了这一轮的回复流程。 */
    Opened,

    /** 这一屏没有能处理的未读：没红点，或红点的人都被后台过滤/正在冷却。 */
    NothingToDo,

    /** 这一屏有活但这一下没做成（没确认到聊天页、被平台锁、风险弹窗、你正在操作）。 */
    Waiting,
}
