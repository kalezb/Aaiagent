package com.aaiagent.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.EditNote
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyText
import com.aaiagent.ui.theme.SkyTextMuted

/**
 * 本机当前平台账号昵称（手填）。
 *
 * 聊天页看不到自己的名字，昵称只出现在「我的」页面；而每台设备、每个账号的昵称
 * 都不一样，自动去读还会因为改版、页面没加载完、误进别人主页而读错，所以让你手填。
 * 留空就是"不填"，后端不会注入昵称那段提示词。
 */
@Composable
internal fun SelfNicknameRow(
    value: String,
    onValueChange: (String) -> Unit
) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 13.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            QuickIcon(Icons.Default.EditNote, SkyBlue)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    text = "我的账号昵称",
                    color = SkyText,
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "只存这台手机；换账号就改一下",
                    color = SkyTextMuted,
                    fontSize = 11.sp
                )
            }
        }
        Spacer(Modifier.height(10.dp))
        StyledTextField(
            value = value,
            onValueChange = onValueChange,
            placeholder = "例如：另一面的我",
            modifier = Modifier.fillMaxWidth()
        )
    }
}
