package com.aaiagent

import com.aaiagent.adapter.AdapterRegistry
import com.aaiagent.adapter.DoubanAdapter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class DoubanAdapterTest {

    @Test
    fun adapterRegistryMapsDoubanPackageCorrectly() {
        assertEquals("douban", AdapterRegistry.platformForPackage("com.douban.frodo"))
        assertEquals("soul", AdapterRegistry.platformForPackage("cn.soulapp.android"))
        assertEquals("qq", AdapterRegistry.platformForPackage("com.tencent.mobileqq"))
        assertEquals("lianxin", AdapterRegistry.platformForPackage("com.lianxin.app"))
        assertNull(AdapterRegistry.platformForPackage("com.unknown.app"))
    }

    @Test
    fun doubanAdapterHasCorrectPackageName() {
        assertEquals("com.douban.frodo", DoubanAdapter.PACKAGE_NAME)
    }

    @Test
    fun identifiesOfficialAccountsToFilter() {
        assertTrue(DoubanAdapter.isOfficialAccount("豆瓣通知"))
        assertTrue(DoubanAdapter.isOfficialAccount("豆瓣市集"))
        assertTrue(DoubanAdapter.isOfficialAccount("官方通知"))
        assertFalse(DoubanAdapter.isOfficialAccount("大可不必 5800"))
        assertFalse(DoubanAdapter.isOfficialAccount("张三"))
    }

    @Test
    fun platformDisplayMapsDouban() {
        assertEquals("豆瓣", platformDisplayName("douban"))
        assertEquals("Soul", platformDisplayName("soul"))
        assertEquals("QQ", platformDisplayName("qq"))
        assertEquals("连信", platformDisplayName("lianxin"))
    }

    private fun platformDisplayName(p: String): String = when (p) {
        "soul" -> "Soul"
        "qq" -> "QQ"
        "douban" -> "豆瓣"
        "lianxin" -> "连信"
        else -> p
    }
}
