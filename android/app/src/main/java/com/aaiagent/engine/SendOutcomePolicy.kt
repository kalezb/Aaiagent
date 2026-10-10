package com.aaiagent.engine

import com.aaiagent.adapter.PlatformAdapter

/**
 * 发送结果怎么算。
 *
 * 2026-10-07 真机（豆包）：聊天里已经出现了“想我就直说嘛 我又不吃人”，
 * 但适配器返回的是 NOT_VERIFIED（发送动作自己没能确认成功）——
 * 引擎按失败处理：不计数、不通知对方收到、也不确认上传，
 * 于是这句话在云端永久缺失（模型下一轮就不知道她说过，会重复或自相矛盾）。
 *
 * 结论：NOT_VERIFIED 只代表“动作没自证成功”，不代表没发出去。
 * 只要聊天里确实看到了这句话，就按成功算。
 */
object SendOutcomePolicy {
    fun treatedAsSent(result: PlatformAdapter.SendResult, visibleInChat: Boolean): Boolean {
        if (result == PlatformAdapter.SendResult.SUCCESS) return true
        return result == PlatformAdapter.SendResult.NOT_VERIFIED && visibleInChat
    }
}
