package com.aaiagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyBlueDeep
import com.aaiagent.ui.theme.SkyLineStrong
import com.aaiagent.ui.theme.SkySurface
import com.aaiagent.ui.theme.SkyText
import com.aaiagent.ui.theme.SkyTextMuted

@Composable
internal fun PersonaSelector(
    personas: List<PersonaItem>,
    activePersona: PersonaItem?,
    modifier: Modifier,
    onSelect: (String) -> Unit
) {
    var expanded by remember { mutableStateOf(false) }
    val personaName = activePersona?.let(PersonaPresentation::name) ?: "未选择"
    val avatar = activePersona?.let(PersonaPresentation::avatarLabel) ?: "客"
    val role = activePersona?.let(PersonaPresentation::roleDetail) ?: "等待同步"

    Box(modifier) {
        Surface(
            modifier = Modifier
                .fillMaxWidth()
                .clickable { expanded = true },
            shape = RoundedCornerShape(16.dp),
            color = SkySurface,
            border = BorderStroke(1.dp, SkyLineStrong)
        ) {
            Row(
                Modifier.padding(horizontal = 12.dp, vertical = 11.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Box(
                    Modifier
                        .width(4.dp)
                        .height(54.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(SkyBlue)
                )
                Spacer(Modifier.width(9.dp))
                Surface(
                    modifier = Modifier.size(46.dp),
                    shape = RoundedCornerShape(14.dp),
                    color = SkyBlue
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Text(
                            text = avatar,
                            color = Color.White,
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Black
                        )
                    }
                }
                Spacer(Modifier.width(10.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "当前客服",
                        color = SkyBlueDeep,
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Black
                    )
                    Text(
                        text = personaName,
                        color = SkyText,
                        fontSize = 17.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                    Text(
                        text = "${activePersona?.let(PersonaPresentation::genderLabel) ?: "客服"} · $role",
                        color = SkyTextMuted,
                        fontSize = 12.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Icon(
                    Icons.Default.ExpandMore,
                    contentDescription = null,
                    tint = SkyBlue,
                    modifier = Modifier.size(18.dp)
                )
            }
        }

        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
            modifier = Modifier.heightIn(min = 44.dp)
        ) {
            if (personas.isEmpty()) {
                DropdownMenuItem(
                    text = { Text("暂无人设，请检查后端连接", fontSize = 13.sp) },
                    onClick = { expanded = false }
                )
            } else {
                personas.forEach { persona ->
                    DropdownMenuItem(
                        text = {
                            Column {
                                Text(
                                    text = PersonaPresentation.displayName(persona),
                                    color = SkyText,
                                    fontSize = 15.sp,
                                    fontWeight = FontWeight.Bold
                                )
                                Text(
                                    text = PersonaPresentation.roleDetail(persona),
                                    color = SkyTextMuted,
                                    fontSize = 12.sp
                                )
                            }
                        },
                        onClick = {
                            onSelect(persona.id)
                            expanded = false
                        }
                    )
                }
            }
        }
    }
}
