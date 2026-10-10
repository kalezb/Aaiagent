package com.aaiagent.engine

import java.util.concurrent.atomic.AtomicBoolean

/**
 * 同一时间只允许一个联系人任务占用聊天页。
 *
 * 这不是失败重试队列，而是硬互斥：任务没拿到明确结果前，其他扫描
 * 不能进入同一页面并重置状态、抢占页面锁或误判“已处理完成”。
 */
class ConversationTaskGate {
    private val active = AtomicBoolean(false)

    fun tryBegin(): Boolean = active.compareAndSet(false, true)

    fun finish() {
        active.set(false)
    }

    fun isActive(): Boolean = active.get()
}
