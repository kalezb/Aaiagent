package com.aaiagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.ui.theme.SkyBlueDeep
import com.aaiagent.ui.theme.SkyLine
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyText
import com.aaiagent.ui.theme.SkyTextMuted

@Composable
internal fun SharedPersonaFactsCard(facts: PersonaFactsUiState, activePersonaId: String) {
    val ageText = if (facts.ageMode == "birth_year") {
        facts.birthYear.takeIf { it.isNotBlank() }?.let { "${it}年出生" } ?: "未设置"
    } else {
        facts.fixedAge.takeIf { it.isNotBlank() }?.let { "${it}岁" } ?: "未设置"
    }
    val maritalText = when (facts.maritalStatus) {
        "single" -> "未婚"
        "married" -> "已婚"
        "divorced" -> "离异"
        else -> "未设置"
    }
    val childText = if (!facts.hasChildren) {
        "没有孩子"
    } else {
        facts.childrenAge.takeIf { it.isNotBlank() }?.let { "${it}岁" } ?: "有孩子，年龄未设置"
    }
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(18.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(
                "所有设备共用同一套资料，手机端只读",
                color = SkyBlueDeep,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(5.dp))
            Text(
                "需要修改年龄、地址、婚姻等信息时，请到客户看板的人设页面统一修改。",
                color = SkyTextMuted,
                fontSize = 12.sp
            )
            Spacer(Modifier.height(14.dp))
            SharedFactRow("年龄", ageText)
            SharedFactRow("婚姻", maritalText)
            SharedFactRow("孩子", childText)
            SharedFactRow("老家", facts.hometown.ifBlank { "未设置" })
            SharedFactRow(
                "现居",
                listOf(facts.currentCity, facts.currentDistrict)
                    .filter { it.isNotBlank() }
                    .joinToString(" · ")
                    .ifBlank { "未设置" }
            )
            SharedFactRow(
                "工作",
                listOf(facts.workCity, facts.workDistrict)
                    .filter { it.isNotBlank() }
                    .joinToString(" · ")
                    .ifBlank { "未设置" }
            )
            SharedFactRow(
                if (activePersonaId == "female_sutang") "豆瓣号" else "QQ号",
                facts.contactQq.ifBlank { "未设置" }
            )
        }
    }
}

@Composable
private fun SharedFactRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(label, color = SkyTextMuted, fontSize = 12.sp, modifier = Modifier.width(58.dp))
        Text(
            value,
            color = SkyText,
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f)
        )
    }
}
