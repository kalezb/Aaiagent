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
import com.aaiagent.ui.theme.*
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

data class RecordItem(
    val platform: String,
    val contactName: String,
    val role: String,
    val content: String,
    val timestamp: Long
)

data class HistoryResponse(
    val history: List<HistoryEntry>?
)

data class HistoryEntry(
    val id: Long = 0,
    val platform: String = "",
    @SerializedName("contact_name") val contactName: String = "",
    val role: String = "",
    val content: String = "",
    @SerializedName("created_at") val createdAt: Long = 0
)

@Composable
fun RecordsScreen(token: String, apiBaseUrl: String) {
    var records by remember { mutableStateOf<List<RecordItem>>(emptyList()) }
    var isLoading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(token, apiBaseUrl) {
        isLoading = true
        error = null
        try {
            val client = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(15, TimeUnit.SECONDS)
                .build()

            val url = "$apiBaseUrl/api/chat/history?token=$token&limit=100"
            val req = Request.Builder().url(url).get().build()
            val resp = withContext(Dispatchers.IO) { client.newCall(req).execute() }
            val body = withContext(Dispatchers.IO) { resp.body?.string() ?: "{}" }

            val data = Gson().fromJson(body, HistoryResponse::class.java)
            records = (data.history ?: emptyList()).map { entry ->
                RecordItem(
                    platform = entry.platform,
                    contactName = entry.contactName,
                    role = entry.role,
                    content = entry.content,
                    timestamp = entry.createdAt * 1000
                )
            }
        } catch (e: Exception) {
            error = "??????: ${e.message}"
        }
        isLoading = false
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Text("??????", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = TextPrimary)

        Spacer(Modifier.height(16.dp))

        if (isLoading) {
            Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = Green)
            }
        } else if (error != null) {
            Text(error!!, color = Danger, fontSize = 14.sp)
        } else if (records.isEmpty()) {
            Box(Modifier.fillMaxWidth().padding(40.dp), contentAlignment = Alignment.Center) {
                Text("??????", color = TextSecondary, fontSize = 14.sp)
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
                    "${platformDisplayName(record.platform)} ? ${record.contactName}",
                    fontSize = 12.sp,
                    color = TextSecondary
                )
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = if (record.role == "assistant") Green.copy(alpha = 0.15f) else Warn.copy(alpha = 0.15f)
                ) {
                    Text(
                        if (record.role == "assistant") "AI" else "???",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                        fontSize = 11.sp,
                        color = if (record.role == "assistant") Green else Warn
                    )
                }
            }
            Spacer(Modifier.height(6.dp))
            Text(record.content, fontSize = 14.sp, color = TextPrimary, maxLines = 4)
            Spacer(Modifier.height(4.dp))
            Text(
                SimpleDateFormat("MM-dd HH:mm", Locale.getDefault()).format(Date(record.timestamp)),
                fontSize = 11.sp,
                color = Gray
            )
        }
    }
}
