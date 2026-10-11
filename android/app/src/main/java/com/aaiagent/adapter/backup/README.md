# 平台适配器代码备份

## 陌陌 (ImmomoAdapter)
- 备份时间：2026-10-12
- 备份原因：根据用户要求，将平台席位中的“陌陌”替换为“豆瓣 (Douban)”。为保留原有的陌陌开发成果与抓取的真实 View ID，将 `ImmomoAdapter.kt` 完整备份在此。
- 恢复方法：如后续需要恢复或支持陌陌，将 `ImmomoAdapter.kt.bak` 重命名为 `ImmomoAdapter.kt` 并放回 `com/aaiagent/adapter/` 目录，并在 `AdapterRegistry.kt` 与清单文件中重新注册即可。
