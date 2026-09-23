package com.hydrotimer.app

import java.util.Calendar

data class TransitionResult(
    val newSnapshot: TimerSnapshot,
    val effects: List<TimerEffect>
)

object TimerDomainEngine {

    fun processEvent(
        snapshot: TimerSnapshot,
        event: TimerEvent,
        config: EngineConfig,
        now: Long = event.timestamp
    ): TransitionResult {
        return when (event.type) {
            TimerEventType.START -> handleStart(snapshot, config, now)
            TimerEventType.STOP -> handleStop(snapshot, event)
            TimerEventType.TIMER_TRIGGER -> handleTimerTrigger(snapshot, event, config, now)
            TimerEventType.ACKNOWLEDGE -> handleAcknowledge(snapshot, event, config, now)
            TimerEventType.DRINK -> handleDrink(snapshot, event, config, now)
            TimerEventType.ALERT_TIMEOUT -> handleAlertTimeout(snapshot, event, config, now)
            TimerEventType.RECOVER -> handleRecover(snapshot, config, now)
        }
    }

    private fun handleStart(
        snapshot: TimerSnapshot,
        config: EngineConfig,
        now: Long
    ): TransitionResult {
        val nextGen = snapshot.timerGeneration + 1L
        val nextTriggerAt = calculateNextTriggerAt(now, config)
        val newSnapshot = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = nextGen,
            alertId = null,
            lastAlertId = snapshot.lastAlertId,
            nextTriggerAt = nextTriggerAt,
            alertStartedAt = null,
            alertDeadlineAt = null
        )

        val effects = mutableListOf<TimerEffect>()
        if (snapshot.timerGeneration > 0L) {
            effects.add(TimerEffect.CancelTimer(snapshot.timerGeneration))
            effects.add(TimerEffect.CancelAlertTimeout(snapshot.timerGeneration, snapshot.alertId))
            effects.add(TimerEffect.CancelReminder)
        }
        effects.add(TimerEffect.ScheduleTimer(nextTriggerAt, nextGen))
        effects.add(TimerEffect.PersistState(newSnapshot))

        return TransitionResult(newSnapshot, effects)
    }

    private fun handleStop(
        snapshot: TimerSnapshot,
        event: TimerEvent
    ): TransitionResult {
        if (event.timerGeneration != null && event.timerGeneration != snapshot.timerGeneration) {
            return TransitionResult(snapshot, emptyList())
        }

        val newSnapshot = snapshot.copy(
            state = TimerState.STOPPED,
            alertId = null,
            nextTriggerAt = null,
            alertStartedAt = null,
            alertDeadlineAt = null
        )

        val effects = listOf(
            TimerEffect.CancelTimer(snapshot.timerGeneration),
            TimerEffect.CancelAlertTimeout(snapshot.timerGeneration, snapshot.alertId),
            TimerEffect.CancelReminder,
            TimerEffect.PersistState(newSnapshot)
        )

        return TransitionResult(newSnapshot, effects)
    }

    private fun handleTimerTrigger(
        snapshot: TimerSnapshot,
        event: TimerEvent,
        config: EngineConfig,
        now: Long
    ): TransitionResult {
        if (snapshot.state != TimerState.WAITING) {
            return TransitionResult(snapshot, emptyList())
        }
        if (event.timerGeneration != null && event.timerGeneration != snapshot.timerGeneration) {
            return TransitionResult(snapshot, emptyList())
        }

        val inQuiet = config.quietHoursEnabled && isInQuietHoursAt(now, config.quietHoursStart, config.quietHoursEnd)
        val dayActive = isDayActiveAt(now, config.activeDays)

        if (inQuiet || !dayActive) {
            val nextTriggerAt = calculateNextTriggerAt(now, config)
            val newSnapshot = snapshot.copy(nextTriggerAt = nextTriggerAt)
            val effects = listOf(
                TimerEffect.ScheduleTimer(nextTriggerAt, snapshot.timerGeneration),
                TimerEffect.PersistState(newSnapshot)
            )
            return TransitionResult(newSnapshot, effects)
        }

        val nextAlertId = Math.max(1000L, snapshot.lastAlertId) + 1L
        val alertDurationMs = Math.max(5, config.alertDurationSeconds) * 1000L
        val alertStartedAt = now
        val alertDeadlineAt = now + alertDurationMs

        val newSnapshot = snapshot.copy(
            state = TimerState.ALERT_ACTIVE,
            alertId = nextAlertId,
            lastAlertId = nextAlertId,
            alertStartedAt = alertStartedAt,
            alertDeadlineAt = alertDeadlineAt,
            nextTriggerAt = null
        )

        val effects = listOf(
            TimerEffect.ShowReminder(title = null, body = null, timerGeneration = snapshot.timerGeneration, alertId = nextAlertId),
            TimerEffect.ScheduleAlertTimeout(deadlineAtMillis = alertDeadlineAt, timerGeneration = snapshot.timerGeneration, alertId = nextAlertId),
            TimerEffect.PersistState(newSnapshot)
        )

        return TransitionResult(newSnapshot, effects)
    }

    private fun handleAcknowledge(
        snapshot: TimerSnapshot,
        event: TimerEvent,
        config: EngineConfig,
        now: Long
    ): TransitionResult {
        if (snapshot.state != TimerState.ALERT_ACTIVE) {
            return TransitionResult(snapshot, emptyList())
        }
        if (event.timerGeneration != null && event.timerGeneration != snapshot.timerGeneration) {
            return TransitionResult(snapshot, emptyList())
        }
        if (snapshot.alertId == null || (event.alertId != null && event.alertId != snapshot.alertId)) {
            return TransitionResult(snapshot, emptyList())
        }

        val activeAlertId = snapshot.alertId
        val isCountdown = config.mode == "countdown"

        if (isCountdown) {
            val newSnapshot = snapshot.copy(
                state = TimerState.STOPPED,
                alertId = null,
                nextTriggerAt = null,
                alertStartedAt = null,
                alertDeadlineAt = null
            )
            val effects = listOf(
                TimerEffect.CancelAlertTimeout(snapshot.timerGeneration, activeAlertId),
                TimerEffect.CancelReminder,
                TimerEffect.RecordAck,
                TimerEffect.PersistState(newSnapshot)
            )
            return TransitionResult(newSnapshot, effects)
        } else {
            val nextTriggerAt = calculateNextTriggerAt(now, config)
            val newSnapshot = snapshot.copy(
                state = TimerState.WAITING,
                alertId = null,
                nextTriggerAt = nextTriggerAt,
                alertStartedAt = null,
                alertDeadlineAt = null
            )
            val effects = listOf(
                TimerEffect.CancelAlertTimeout(snapshot.timerGeneration, activeAlertId),
                TimerEffect.CancelReminder,
                TimerEffect.RecordAck,
                TimerEffect.ScheduleTimer(nextTriggerAt, snapshot.timerGeneration),
                TimerEffect.PersistState(newSnapshot)
            )
            return TransitionResult(newSnapshot, effects)
        }
    }

    private fun handleDrink(
        snapshot: TimerSnapshot,
        event: TimerEvent,
        config: EngineConfig,
        now: Long
    ): TransitionResult {
        if (snapshot.state != TimerState.ALERT_ACTIVE) {
            return TransitionResult(snapshot, emptyList())
        }
        if (event.timerGeneration != null && event.timerGeneration != snapshot.timerGeneration) {
            return TransitionResult(snapshot, emptyList())
        }
        if (snapshot.alertId == null || (event.alertId != null && event.alertId != snapshot.alertId)) {
            return TransitionResult(snapshot, emptyList())
        }

        val activeAlertId = snapshot.alertId
        val intake = Math.max(0, config.intakePerAlertMl)
        val isCountdown = config.mode == "countdown"

        if (isCountdown) {
            val newSnapshot = snapshot.copy(
                state = TimerState.STOPPED,
                alertId = null,
                nextTriggerAt = null,
                alertStartedAt = null,
                alertDeadlineAt = null
            )
            val effects = listOf(
                TimerEffect.CancelAlertTimeout(snapshot.timerGeneration, activeAlertId),
                TimerEffect.CancelReminder,
                TimerEffect.RecordDrink(intake),
                TimerEffect.RecordAck,
                TimerEffect.PersistState(newSnapshot)
            )
            return TransitionResult(newSnapshot, effects)
        } else {
            val nextTriggerAt = calculateNextTriggerAt(now, config)
            val newSnapshot = snapshot.copy(
                state = TimerState.WAITING,
                alertId = null,
                nextTriggerAt = nextTriggerAt,
                alertStartedAt = null,
                alertDeadlineAt = null
            )
            val effects = listOf(
                TimerEffect.CancelAlertTimeout(snapshot.timerGeneration, activeAlertId),
                TimerEffect.CancelReminder,
                TimerEffect.RecordDrink(intake),
                TimerEffect.RecordAck,
                TimerEffect.ScheduleTimer(nextTriggerAt, snapshot.timerGeneration),
                TimerEffect.PersistState(newSnapshot)
            )
            return TransitionResult(newSnapshot, effects)
        }
    }

    private fun handleAlertTimeout(
        snapshot: TimerSnapshot,
        event: TimerEvent,
        config: EngineConfig,
        now: Long
    ): TransitionResult {
        if (snapshot.state != TimerState.ALERT_ACTIVE) {
            return TransitionResult(snapshot, emptyList())
        }
        if (event.timerGeneration != null && event.timerGeneration != snapshot.timerGeneration) {
            return TransitionResult(snapshot, emptyList())
        }
        if (snapshot.alertId == null || (event.alertId != null && event.alertId != snapshot.alertId)) {
            return TransitionResult(snapshot, emptyList())
        }

        val activeAlertId = snapshot.alertId
        val durationSec = Math.max(5, config.alertDurationSeconds)
        val isCountdown = config.mode == "countdown"

        if (isCountdown) {
            val newSnapshot = snapshot.copy(
                state = TimerState.STOPPED,
                alertId = null,
                nextTriggerAt = null,
                alertStartedAt = null,
                alertDeadlineAt = null
            )
            val effects = listOf(
                TimerEffect.CancelAlertTimeout(snapshot.timerGeneration, activeAlertId),
                TimerEffect.CancelReminder,
                TimerEffect.RecordMissed,
                TimerEffect.ShowMissedNotification(durationSec),
                TimerEffect.PersistState(newSnapshot)
            )
            return TransitionResult(newSnapshot, effects)
        } else {
            val nextTriggerAt = calculateNextTriggerAt(now, config)
            val newSnapshot = snapshot.copy(
                state = TimerState.WAITING,
                alertId = null,
                nextTriggerAt = nextTriggerAt,
                alertStartedAt = null,
                alertDeadlineAt = null
            )
            val effects = listOf(
                TimerEffect.CancelAlertTimeout(snapshot.timerGeneration, activeAlertId),
                TimerEffect.CancelReminder,
                TimerEffect.RecordMissed,
                TimerEffect.ShowMissedNotification(durationSec),
                TimerEffect.ScheduleTimer(nextTriggerAt, snapshot.timerGeneration),
                TimerEffect.PersistState(newSnapshot)
            )
            return TransitionResult(newSnapshot, effects)
        }
    }

    private fun handleRecover(
        snapshot: TimerSnapshot,
        config: EngineConfig,
        now: Long
    ): TransitionResult {
        return when (snapshot.state) {
            TimerState.STOPPED -> {
                val effects = listOf(
                    TimerEffect.CancelTimer(snapshot.timerGeneration),
                    TimerEffect.CancelAlertTimeout(snapshot.timerGeneration, snapshot.alertId),
                    TimerEffect.PersistState(snapshot)
                )
                TransitionResult(snapshot, effects)
            }
            TimerState.WAITING -> {
                val targetAt = snapshot.nextTriggerAt ?: now
                if (now >= targetAt) {
                    val triggerEvent = TimerEvent(
                        type = TimerEventType.TIMER_TRIGGER,
                        timerGeneration = snapshot.timerGeneration,
                        timestamp = now
                    )
                    processEvent(snapshot, triggerEvent, config, now)
                } else {
                    val effects = listOf(
                        TimerEffect.ScheduleTimer(targetAt, snapshot.timerGeneration),
                        TimerEffect.PersistState(snapshot)
                    )
                    TransitionResult(snapshot, effects)
                }
            }
            TimerState.ALERT_ACTIVE -> {
                val deadlineAt = snapshot.alertDeadlineAt ?: now
                if (now >= deadlineAt) {
                    val timeoutEvent = TimerEvent(
                        type = TimerEventType.ALERT_TIMEOUT,
                        timerGeneration = snapshot.timerGeneration,
                        alertId = snapshot.alertId,
                        timestamp = now
                    )
                    processEvent(snapshot, timeoutEvent, config, now)
                } else {
                    val activeAlertId = snapshot.alertId ?: Math.max(1001L, snapshot.lastAlertId)
                    val effects = listOf(
                        TimerEffect.ShowReminder(title = null, body = null, timerGeneration = snapshot.timerGeneration, alertId = activeAlertId),
                        TimerEffect.ScheduleAlertTimeout(deadlineAtMillis = deadlineAt, timerGeneration = snapshot.timerGeneration, alertId = activeAlertId),
                        TimerEffect.PersistState(snapshot)
                    )
                    TransitionResult(snapshot, effects)
                }
            }
        }
    }

    fun calculateNextTriggerAt(now: Long, config: EngineConfig): Long {
        if (config.mode == "countdown") {
            val totalMs = (config.countdownMinutes * 60 + config.countdownSeconds) * 1000L
            return now + Math.max(1000L, totalMs)
        }

        var candidate: Long
        if (config.intervalMode != "clock") {
            candidate = now + Math.max(1, config.intervalMinutes) * 60_000L
        } else {
            val step = config.clockIntervalMinutes.coerceIn(30, 90)
            val cal = Calendar.getInstance().apply { timeInMillis = now }
            val currentMinute = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
            val nextSlot = ((currentMinute / step) + 1) * step
            val res = Calendar.getInstance().apply {
                timeInMillis = now
                set(Calendar.HOUR_OF_DAY, (nextSlot / 60) % 24)
                set(Calendar.MINUTE, nextSlot % 60)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
                if (nextSlot >= 24 * 60 || timeInMillis <= now) {
                    add(Calendar.DAY_OF_YEAR, 1)
                }
            }
            candidate = res.timeInMillis
        }

        return adjustForQuietHoursAndActiveDays(candidate, config)
    }

    fun adjustForQuietHoursAndActiveDays(candidateTrigger: Long, config: EngineConfig): Long {
        var time = candidateTrigger
        var iterations = 0
        while (iterations < 14 * 24) {
            val cal = Calendar.getInstance().apply { timeInMillis = time }
            val dayOfWeek = cal.get(Calendar.DAY_OF_WEEK) // 1=Sun..7=Sat
            val dayIndex = dayOfWeek - 1
            val isDayActive = config.activeDays.getOrElse(dayIndex) { true }

            if (!isDayActive) {
                cal.add(Calendar.DAY_OF_YEAR, 1)
                cal.set(Calendar.HOUR_OF_DAY, 0)
                cal.set(Calendar.MINUTE, 0)
                cal.set(Calendar.SECOND, 0)
                cal.set(Calendar.MILLISECOND, 0)
                time = cal.timeInMillis
                iterations++
                continue
            }

            if (config.quietHoursEnabled && isInQuietHoursAt(time, config.quietHoursStart, config.quietHoursEnd)) {
                val endParsed = parseTimeOfDay(config.quietHoursEnd)
                if (endParsed != null) {
                    val (qEndH, qEndM) = endParsed
                    cal.set(Calendar.HOUR_OF_DAY, qEndH)
                    cal.set(Calendar.MINUTE, qEndM)
                    cal.set(Calendar.SECOND, 0)
                    cal.set(Calendar.MILLISECOND, 0)
                    if (cal.timeInMillis <= time) {
                        cal.add(Calendar.DAY_OF_YEAR, 1)
                    }
                    time = cal.timeInMillis
                    iterations++
                    continue
                }
            }

            break
        }
        return time
    }

    fun isInQuietHoursAt(timeMillis: Long, startStr: String, endStr: String): Boolean {
        val cal = Calendar.getInstance().apply { timeInMillis = timeMillis }
        val nowMins = cal.get(Calendar.HOUR_OF_DAY) * 60 + cal.get(Calendar.MINUTE)
        val s = parseTimeOfDay(startStr)?.let { it.first * 60 + it.second } ?: (23 * 60)
        val e = parseTimeOfDay(endStr)?.let { it.first * 60 + it.second } ?: (7 * 60)
        return if (s < e) {
            nowMins in s until e
        } else {
            nowMins >= s || nowMins < e
        }
    }

    fun isDayActiveAt(timeMillis: Long, activeDays: BooleanArray): Boolean {
        val cal = Calendar.getInstance().apply { timeInMillis = timeMillis }
        val dayOfWeek = cal.get(Calendar.DAY_OF_WEEK) // 1=Sun..7=Sat
        val dayIndex = dayOfWeek - 1
        return activeDays.getOrElse(dayIndex) { true }
    }

    private fun parseTimeOfDay(timeStr: String): Pair<Int, Int>? {
        val parts = timeStr.trim().split(":")
        if (parts.size == 2) {
            val h = parts[0].toIntOrNull()
            val m = parts[1].toIntOrNull()
            if (h != null && m != null && h in 0..23 && m in 0..59) {
                return Pair(h, m)
            }
        }
        return null
    }
}
