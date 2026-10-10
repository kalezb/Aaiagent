package com.aaiagent

import com.aaiagent.xposed.InjectArmPolicy
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * "配音什么时候挂到录音上"的规则。
 *
 * 这条规则错一次的代价是：**语音正常发出去，但里面没有声音** ——
 * 在真机上极难查（2026-10-06 就为它耗了很久），所以用测试钉死。
 */
class InjectArmPolicyTest {

    @Test
    fun `pcm that arrives mid recording is armed right away`() {
        // 这是那次事故的正解：录音已经开始、配音这时才到 → 必须补挂，不能放弃。
        assertEquals(true, InjectArmPolicy.shouldArmOnLoad(sessionActive = true, alreadyArmed = false))
    }

    @Test
    fun `pcm that arrives while nothing is recording is not armed`() {
        // 没在录音就别挂 —— 挂上去会污染下一次录音的起点。
        assertEquals(false, InjectArmPolicy.shouldArmOnLoad(sessionActive = false, alreadyArmed = false))
    }

    @Test
    fun `an already armed session is never armed twice`() {
        // 重复挂会把游标重置，同一段配音从头再播一遍。
        assertEquals(false, InjectArmPolicy.shouldArmOnLoad(sessionActive = true, alreadyArmed = true))
        assertEquals(false, InjectArmPolicy.shouldArmOnLoad(sessionActive = false, alreadyArmed = true))
    }

    @Test
    fun `starting to record without the pcm yet means wait, not give up`() {
        // 事故就是这里判成"放弃"导致的：整段录音全静音。
        assertEquals(true, InjectArmPolicy.shouldWaitForPcm(sessionActive = true, hasPcm = false))
    }

    @Test
    fun `nothing to wait for when the pcm is already here`() {
        assertEquals(false, InjectArmPolicy.shouldWaitForPcm(sessionActive = true, hasPcm = true))
    }

    @Test
    fun `an inactive session never waits`() {
        assertEquals(false, InjectArmPolicy.shouldWaitForPcm(sessionActive = false, hasPcm = false))
        assertEquals(false, InjectArmPolicy.shouldWaitForPcm(sessionActive = false, hasPcm = true))
    }
}
