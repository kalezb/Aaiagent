package com.aaiagent.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.aaiagent.engine.observability.AutomationTrace
import com.aaiagent.network.ApiService
import com.aaiagent.ui.theme.SkyBlue
import com.aaiagent.ui.theme.SkyBlueDeep
import com.aaiagent.ui.theme.SkyBlueSoft
import com.aaiagent.ui.theme.SkyLine
import com.aaiagent.ui.theme.SkySurfaceRaised
import com.aaiagent.ui.theme.SkyText
import com.aaiagent.ui.theme.SkyTextSecondary
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun IncidentFeedbackCard(
    apiBase: String,
    token: String,
) {
    val scope = rememberCoroutineScope()
    var status by remember {
        mutableStateOf("问题反馈会打包最近一段运行过程；页面采样请切到目标平台后长按悬浮窗")
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
                text = "刚才有问题",
                color = SkyText,
                fontSize = 17.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.height(5.dp))
            Text(
                text = status,
                color = SkyTextSecondary,
                fontSize = 13.sp,
                lineHeight = 19.sp
            )
            Spacer(Modifier.height(13.dp))
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        val exported = AutomationTrace.markUserFeedback("手机端手动反馈")
                        if (exported == null) {
                            status = "暂时没有可导出的运行记录"
                            return@clickable
                        }
                        status = "已保存：${exported.name}，正在上传..."
                        if (token.isBlank()) {
                            status = "已保存：${exported.name}；设备密钥为空，稍后可重试"
                            return@clickable
                        }
                        scope.launch {
                            val uploaded = withContext(Dispatchers.IO) {
                                ApiService(apiBase).uploadAutomationIncident(token, exported)
                            }
                            status = if (uploaded) {
                                "已上传，AI可以读取完整时间线"
                            } else {
                                "已保存在手机；上传失败，可再次点击重试"
                            }
                        }
                    },
                shape = RoundedCornerShape(13.dp),
                color = SkyBlueSoft,
                border = BorderStroke(1.dp, SkyBlue.copy(alpha = 0.35f))
            ) {
                Box(
                    Modifier.padding(vertical = 12.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "记录这次问题",
                        color = SkyBlueDeep,
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }
    }
}
