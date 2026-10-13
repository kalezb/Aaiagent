package com.aaiagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.AlertDialog
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.runtime.Composable
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.Alignment
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.text.style.TextOverflow
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyLine
import com.aaiagent.ui.theme.SkyGreen
import com.aaiagent.ui.theme.SkyDanger
import com.aaiagent.ui.theme.SkyTextMuted
import com.aaiagent.ui.theme.SkyText

/**
 * 这几个 UI 组件原本写在 DashboardScreen.kt 里，职责单纯，只负责展示白名单/黑名单以及管理弹窗。
 * 为了把“大总管”代码拆得更清晰，我们把它们抽到这个新文件里。
 */

@Composable
fun ContactStrategyCard(
    whitelistCount: Int,
    blacklistCount: Int,
    onOpenWhitelist: () -> Unit,
    onOpenBlacklist: () -> Unit
) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp),
        shape = RoundedCornerShape(18.dp),
        color = SkySurfaceRaised,
        border = BorderStroke(1.dp, SkyLine)
    ) {
        Row(
            Modifier.padding(14.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            ContactListButton(
                title = "白名单",
                count = whitelistCount,
                color = SkyGreen,
                modifier = Modifier.weight(1f),
                onClick = onOpenWhitelist
            )
            ContactListButton(
                title = "黑名单",
                count = blacklistCount,
                color = SkyDanger,
                modifier = Modifier.weight(1f),
                onClick = onOpenBlacklist
            )
        }
    }
}

@Composable
private fun ContactListButton(
    title: String,
    count: Int,
    color: Color,
    modifier: Modifier,
    onClick: () -> Unit
) {
    Surface(
        modifier = modifier.clickable(onClick = onClick),
        shape = RoundedCornerShape(13.dp),
        color = color.copy(alpha = 0.08f),
        border = BorderStroke(1.dp, color.copy(alpha = 0.45f))
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 13.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(Modifier.weight(1f)) {
                Text(
                    text = title,
                    color = color,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(Modifier.height(3.dp))
                Text(
                    text = "$count 位联系人",
                    color = SkyTextMuted,
                    fontSize = 12.sp
                )
            }
            Icon(
                Icons.Default.ChevronRight,
                contentDescription = null,
                tint = color,
                modifier = Modifier.size(17.dp)
            )
        }
    }
}

@Composable
fun ContactManagementDialog(
    title: String,
    emptyText: String,
    contacts: List<String>,
    accent: Color,
    onDismiss: () -> Unit,
    onChange: (List<String>) -> Unit
) {
    var newContact by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    // 这里用了一个自定义的 StyledTextField，保持原来的外观
                    StyledTextField(
                        value = newContact,
                        onValueChange = { newContact = it },
                        placeholder = "输入联系人或关键词",
                        modifier = Modifier.weight(1f)
                    )
                    Spacer(Modifier.width(8.dp))
                    TextButton(
                        onClick = {
                            val normalized = newContact.trim()
                            if (normalized.isNotEmpty() && normalized !in contacts) {
                                onChange(contacts + normalized)
                            }
                            newContact = ""
                        }
                    ) {
                        Text("添加", color = accent, fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(Modifier.height(10.dp))
                if (contacts.isEmpty()) {
                    Text(emptyText, color = SkyTextMuted, fontSize = 13.sp)
                } else {
                    Column(
                        Modifier
                            .heightIn(max = 280.dp)
                            .verticalScroll(rememberScrollState())
                    ) {
                        contacts.forEach { contact ->
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = contact,
                                    modifier = Modifier.weight(1f),
                                    color = SkyText,
                                    fontSize = 13.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                TextButton(onClick = { onChange(contacts - contact) }) {
                                    Text("删除", color = SkyDanger, fontSize = 12.sp)
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("完成", color = SkyBlue, fontWeight = FontWeight.Bold)
            }
        }
    )
}
