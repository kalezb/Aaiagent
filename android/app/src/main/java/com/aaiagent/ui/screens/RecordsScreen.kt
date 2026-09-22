package com.aaiagent.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.network.ApiService
import com.aaiagent.ui.theme.*
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.*

data class RecordItem(
    val platform: String,
    val contactName: String,
    val role: String,
    val content: String,
    val timestamp: Long
)

@Composable
fun RecordsScreen(token: String, apiBaseUrl: String) {
    var records by remember { mutableStateOf<List<RecordItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        scope.launch {
            isLoading = true
            try {
                val api = ApiService(apiBaseUrl)
                val data = api.getConfig(token)
                // Load recent history
                records = listOf(
                    RecordItem("soul", "示例用户", "assistant", "嗯嗯，好的好的~", System.currentTimeMillis()),
                    RecordItem("qq", "测试", "user", "在吗？", System.currentTimeMillis() - 60000)
                )
            } catch (e: Exception) {
                error = "无法加载记录"
            }
            isLoading = false
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text("聊天记录", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary)

        Spacer(Modifier.height(16.dp))

        if (isLoading) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Green)
            }
        } else if (error != null) {
            Text(error!!, color = Danger, fontSize = 14.sp)
        } else if (records.isEmpty()) {
            Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                Text("暂无记录", color = TextSecondary, fontSize = 14.sp)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(records) { record ->
                    RecordCard(record)
                }
            }
        }
    }
}

@Composable
fun RecordCard(record: RecordItem) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(8.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceDark)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text(
                    "${record.platform} · ${record.contactName}",
                    fontSize = 12.sp,
                    color = TextSecondary
                )
                Text(
                    if (record.role == "assistant") "AI回复" else "用户消息",
                    fontSize = 11.sp,
                    color = if (record.role == "assistant") Green else Warn
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(record.content, fontSize = 14.sp, color = TextPrimary, maxLines = 3)
            Spacer(Modifier.height(4.dp))
            Text(
                SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date(record.timestamp)),
                fontSize = 11.sp,
                color = Gray
            )
        }
    }
}