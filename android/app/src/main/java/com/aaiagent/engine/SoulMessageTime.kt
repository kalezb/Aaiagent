package com.aaiagent.engine

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.YearMonth
import java.time.ZoneId

object SoulMessageTime {
    private val zoneId: ZoneId = ZoneId.of("Asia/Shanghai")
    private val clockPattern = Regex("^(\\d{1,2}):(\\d{2})$")
    private val todayPattern = Regex("^今天\\s*(\\d{1,2}):(\\d{2})$")
    private val yesterdayPattern = Regex("^昨天\\s*(\\d{1,2}):(\\d{2})$")
    private val dayBeforePattern = Regex("^前天\\s*(\\d{1,2}):(\\d{2})$")
    private val chineseDatePattern = Regex(
        "^(?:(\\d{4})年)?(\\d{1,2})月(\\d{1,2})日(?:\\s+(\\d{1,2}):(\\d{2}))?$"
    )
    private val numericDatePattern = Regex(
        "^(?:(\\d{4})[-/.])?(\\d{1,2})[-/.](\\d{1,2})(?:\\s+(\\d{1,2}):(\\d{2}))?$"
    )
    private val dayOnlyPattern = Regex("^(\\d{1,2})日(?:\\s+(\\d{1,2}):(\\d{2}))?$")

    data class Context(
        val text: String = "",
        val epochMillis: Long? = null
    )

    /**
     * Soul only renders a date separator on the first item of a time group.
     * Later bubbles in the same group must inherit that separator.
     */
    class ContextTracker(
        private val nowMillis: () -> Long = { System.currentTimeMillis() }
    ) {
        private var current = Context()

        fun observe(raw: String?): Context {
            val text = raw?.trim().orEmpty()
            if (text.isNotEmpty()) {
                current = Context(
                    text = text,
                    epochMillis = parseToEpochMillis(text, nowMillis())
                )
            }
            return current
        }
    }

    fun parseToEpochMillis(
        raw: String?,
        nowMillis: Long = System.currentTimeMillis(),
        zone: ZoneId = zoneId
    ): Long? {
        val text = raw
            ?.trim()
            ?.replace('：', ':')
            ?.replace(Regex("\\s+"), " ")
            ?.takeIf { it.isNotEmpty() }
            ?: return null

        val now = Instant.ofEpochMilli(nowMillis).atZone(zone)
        if (text == "刚刚") return nowMillis

        todayPattern.matchEntire(text)?.let { match ->
            return localDateTimeMillis(
                date = now.toLocalDate(),
                hour = match.groupValues[1],
                minute = match.groupValues[2],
                zone = zone
            )
        }
        yesterdayPattern.matchEntire(text)?.let { match ->
            return localDateTimeMillis(
                date = now.toLocalDate().minusDays(1),
                hour = match.groupValues[1],
                minute = match.groupValues[2],
                zone = zone
            )
        }
        dayBeforePattern.matchEntire(text)?.let { match ->
            return localDateTimeMillis(
                date = now.toLocalDate().minusDays(2),
                hour = match.groupValues[1],
                minute = match.groupValues[2],
                zone = zone
            )
        }

        chineseDatePattern.matchEntire(text)?.let { match ->
            return dateMatchMillis(match, now, zone)
        }
        numericDatePattern.matchEntire(text)?.let { match ->
            return dateMatchMillis(match, now, zone)
        }
        dayOnlyPattern.matchEntire(text)?.let { match ->
            val date = resolveMonthDay(
                year = now.year,
                month = now.monthValue,
                day = match.groupValues[1].toIntOrNull() ?: return null,
                now = now,
                zone = zone
            ) ?: return null
            return localDateTimeMillis(
                date = date,
                hour = match.groupValues[2].ifBlank { "12" },
                minute = match.groupValues[3].ifBlank { "00" },
                zone = zone
            )
        }
        clockPattern.matchEntire(text)?.let { match ->
            var dateTime = LocalDateTime.of(
                now.toLocalDate(),
                LocalTime.of(
                    match.groupValues[1].toIntOrNull() ?: return null,
                    match.groupValues[2].toIntOrNull() ?: return null
                )
            )
            if (dateTime.isAfter(now.toLocalDateTime().plus(Duration.ofMinutes(5)))) {
                dateTime = dateTime.minusDays(1)
            }
            return dateTime.atZone(zone).toInstant().toEpochMilli()
        }
        if (text == "昨天") return now.minusDays(1).toInstant().toEpochMilli()
        if (text == "前天") return now.minusDays(2).toInstant().toEpochMilli()
        return null
    }

    private fun dateMatchMillis(
        match: MatchResult,
        now: java.time.ZonedDateTime,
        zone: ZoneId
    ): Long? {
        val explicitYear = match.groupValues[1].toIntOrNull()
        val month = match.groupValues[2].toIntOrNull() ?: return null
        val day = match.groupValues[3].toIntOrNull() ?: return null
        val date = resolveMonthDay(
            year = explicitYear ?: now.year,
            month = month,
            day = day,
            now = now,
            zone = zone
        ) ?: return null
        return localDateTimeMillis(
            date = date,
            hour = match.groupValues[4].ifBlank { "12" },
            minute = match.groupValues[5].ifBlank { "00" },
            zone = zone
        )
    }

    private fun resolveMonthDay(
        year: Int,
        month: Int,
        day: Int,
        now: java.time.ZonedDateTime,
        zone: ZoneId
    ): LocalDate? {
        if (month !in 1..12) return null
        if (day !in 1..YearMonth.of(year, month).lengthOfMonth()) return null
        var date = LocalDate.of(year, month, day)
        val candidate = date.atStartOfDay(zone)
        if (candidate.isAfter(now.plus(Duration.ofDays(1)))) {
            date = date.minusYears(1)
        }
        return date
    }

    private fun localDateTimeMillis(
        date: LocalDate,
        hour: String,
        minute: String,
        zone: ZoneId
    ): Long? {
        val hourValue = hour.toIntOrNull() ?: return null
        val minuteValue = minute.toIntOrNull() ?: return null
        if (hourValue !in 0..23 || minuteValue !in 0..59) return null
        return LocalDateTime.of(date, LocalTime.of(hourValue, minuteValue))
            .atZone(zone)
            .toInstant()
            .toEpochMilli()
    }
}
