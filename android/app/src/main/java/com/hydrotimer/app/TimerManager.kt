package com.hydrotimer.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import java.util.Calendar

class TimerManager(private val context: Context) {
    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    fun getPrefs(): SharedPreferences = prefs

    companion object {
        const val PREFS_NAME = "hydro_timer_prefs"
        const val KEY_STATE = "timer_state"
        const val KEY_TIMER_GENERATION = "timer_generation"
        const val KEY_ALERT_ID = "alert_id"
        const val KEY_LAST_ALERT_ID = "last_alert_id"
        const val KEY_IS_RUNNING = "is_running"
        const val KEY_TIMER_MODE = "timer_mode" // "interval" or "countdown"
        const val KEY_EVENT_TITLE = "current_event_title"
        const val KEY_INTERVAL_MINUTES = "interval_minutes"
        const val KEY_COUNTDOWN_MINUTES = "countdown_minutes"
        const val KEY_COUNTDOWN_SECONDS = "countdown_seconds"
        const val KEY_INTERVAL_MODE = "interval_mode" // "free" or "clock"
        const val KEY_CLOCK_INTERVAL_MINUTES = "clock_interval_minutes"
        const val KEY_ALERT_DURATION_SECONDS = "alert_duration_seconds"
        const val KEY_NEXT_TRIGGER_TIMESTAMP = "next_trigger_timestamp"
        const val KEY_ALERT_STARTED_TIMESTAMP = "alert_started_timestamp"
        const val KEY_ALERT_DEADLINE_TIMESTAMP = "alert_deadline_timestamp"
        const val KEY_TODAY_DRUNK_ML = "today_drunk_ml"
        const val KEY_DAILY_TARGET_ML = "daily_target_ml"
        const val KEY_INTAKE_PER_ALERT_ML = "intake_per_alert_ml"
        const val KEY_MISSED_COUNT = "missed_alerts_count"
        const val KEY_LAST_MISSED_TIME = "last_missed_timestamp"
        const val KEY_TODAY_MISSED_COUNT = "today_missed_count"
        const val KEY_TODAY_ACK_COUNT = "today_ack_count"
        const val KEY_LAST_RESET_DATE = "last_reset_date"
        const val KEY_ACTIVE_DAYS = "active_days"
        const val KEY_QUIET_HOURS_ENABLED = "quiet_hours_enabled"
        const val KEY_QUIET_HOURS_START = "quiet_hours_start"
        const val KEY_QUIET_HOURS_END = "quiet_hours_end"

        const val DEFAULT_INTERVAL_MINUTES = 30
        const val DEFAULT_COUNTDOWN_MINUTES = 5
        const val DEFAULT_CLOCK_INTERVAL_MINUTES = 30
        const val DEFAULT_ALERT_DURATION_SECONDS = 15
        const val DEFAULT_QUIET_HOURS_START = "23:00"
        const val DEFAULT_QUIET_HOURS_END = "07:00"

        const val EXTRA_TIMER_GENERATION = "com.hydrotimer.app.EXTRA_TIMER_GENERATION"
        const val EXTRA_ALERT_ID = "com.hydrotimer.app.EXTRA_ALERT_ID"
    }

    fun getSnapshot(): TimerSnapshot {
        if (!prefs.contains(KEY_STATE)) {
            val legacyIsRunning = prefs.getBoolean(KEY_IS_RUNNING, false)
            val legacyNextTrigger = prefs.getLong(KEY_NEXT_TRIGGER_TIMESTAMP, 0L)
            if (legacyIsRunning) {
                val initialSnapshot = TimerSnapshot(
                    state = TimerState.WAITING,
                    timerGeneration = 1L,
                    alertId = null,
                    lastAlertId = 0L,
                    nextTriggerAt = if (legacyNextTrigger > 0L) legacyNextTrigger else System.currentTimeMillis() + getIntervalMinutes() * 60_000L,
                    alertStartedAt = null,
                    alertDeadlineAt = null
                )
                saveSnapshot(initialSnapshot)
                return initialSnapshot
            } else {
                val initialSnapshot = TimerSnapshot(
                    state = TimerState.STOPPED,
                    timerGeneration = 0L,
                    alertId = null,
                    lastAlertId = 0L,
                    nextTriggerAt = null,
                    alertStartedAt = null,
                    alertDeadlineAt = null
                )
                saveSnapshot(initialSnapshot)
                return initialSnapshot
            }
        }

        val stateStr = prefs.getString(KEY_STATE, TimerState.STOPPED.name) ?: TimerState.STOPPED.name
        val state = try { TimerState.valueOf(stateStr) } catch (_: Exception) { TimerState.STOPPED }
        val generation = prefs.getLong(KEY_TIMER_GENERATION, 0L)
        val alertId = if (prefs.contains(KEY_ALERT_ID)) prefs.getLong(KEY_ALERT_ID, 0L).let { if (it <= 0L) null else it } else null
        val lastAlertId = prefs.getLong(KEY_LAST_ALERT_ID, 0L)
        val nextTrigger = if (prefs.contains(KEY_NEXT_TRIGGER_TIMESTAMP)) prefs.getLong(KEY_NEXT_TRIGGER_TIMESTAMP, 0L).let { if (it <= 0L) null else it } else null
        val alertStarted = if (prefs.contains(KEY_ALERT_STARTED_TIMESTAMP)) prefs.getLong(KEY_ALERT_STARTED_TIMESTAMP, 0L).let { if (it <= 0L) null else it } else null
        val alertDeadline = if (prefs.contains(KEY_ALERT_DEADLINE_TIMESTAMP)) prefs.getLong(KEY_ALERT_DEADLINE_TIMESTAMP, 0L).let { if (it <= 0L) null else it } else null

        return TimerSnapshot(
            state = state,
            timerGeneration = generation,
            alertId = alertId,
            lastAlertId = lastAlertId,
            nextTriggerAt = nextTrigger,
            alertStartedAt = alertStarted,
            alertDeadlineAt = alertDeadline
        )
    }

    fun saveSnapshot(snapshot: TimerSnapshot) {
        val editor = prefs.edit()
        editor.putString(KEY_STATE, snapshot.state.name)
        editor.putLong(KEY_TIMER_GENERATION, snapshot.timerGeneration)
        if (snapshot.alertId != null) editor.putLong(KEY_ALERT_ID, snapshot.alertId) else editor.remove(KEY_ALERT_ID)
        editor.putLong(KEY_LAST_ALERT_ID, snapshot.lastAlertId)
        if (snapshot.nextTriggerAt != null) editor.putLong(KEY_NEXT_TRIGGER_TIMESTAMP, snapshot.nextTriggerAt) else editor.putLong(KEY_NEXT_TRIGGER_TIMESTAMP, 0L)
        if (snapshot.alertStartedAt != null) editor.putLong(KEY_ALERT_STARTED_TIMESTAMP, snapshot.alertStartedAt) else editor.remove(KEY_ALERT_STARTED_TIMESTAMP)
        if (snapshot.alertDeadlineAt != null) editor.putLong(KEY_ALERT_DEADLINE_TIMESTAMP, snapshot.alertDeadlineAt) else editor.remove(KEY_ALERT_DEADLINE_TIMESTAMP)

        editor.putBoolean(KEY_IS_RUNNING, snapshot.state != TimerState.STOPPED)
        editor.apply()
    }

    fun getConfig(): EngineConfig {
        return EngineConfig(
            mode = getTimerMode(),
            intervalMinutes = getIntervalMinutes(),
            countdownMinutes = getCountdownMinutes(),
            countdownSeconds = getCountdownSeconds(),
            alertDurationSeconds = getAlertDurationSeconds(),
            intervalMode = prefs.getString(KEY_INTERVAL_MODE, "free") ?: "free",
            clockIntervalMinutes = getClockIntervalMinutes(),
            autoRestart = true,
            intakePerAlertMl = getIntakePerAlertMl(),
            quietHoursEnabled = isQuietHoursEnabled(),
            quietHoursStart = getQuietHoursStart(),
            quietHoursEnd = getQuietHoursEnd(),
            activeDays = getActiveDays()
        )
    }

    fun dispatch(event: TimerEvent, now: Long = System.currentTimeMillis()): TransitionResult {
        val snapshot = getSnapshot()
        val config = getConfig()
        val result = TimerDomainEngine.processEvent(snapshot, event, config, now)
        executeEffects(result.effects)
        return result
    }

    fun executeEffects(effects: List<TimerEffect>) {
        for (effect in effects) {
            when (effect) {
                is TimerEffect.PersistState -> saveSnapshot(effect.snapshot)
                is TimerEffect.ScheduleTimer -> scheduleAlarmAt(effect.triggerAtMillis, effect.timerGeneration)
                is TimerEffect.ScheduleAlertTimeout -> scheduleAlertTimeoutAt(effect.deadlineAtMillis, effect.timerGeneration, effect.alertId)
                is TimerEffect.CancelTimer -> cancelAlarm()
                is TimerEffect.CancelAlertTimeout -> cancelAlertTimeout()
                is TimerEffect.ShowReminder -> NotificationHelper.showWaterReminder(context, effect.title, effect.body, effect.timerGeneration, effect.alertId)
                is TimerEffect.CancelReminder -> NotificationHelper.cancelAlertNotifications(context)
                is TimerEffect.ShowMissedNotification -> NotificationHelper.showMissedAlertNotification(context, effect.alertDurationSeconds)
                is TimerEffect.RecordDrink -> addDrunkMl(effect.amountMl)
                is TimerEffect.RecordAck -> recordTodayAck()
                is TimerEffect.RecordMissed -> {
                    recordMissedAlert()
                    recordTodayMissed()
                }
            }
        }
    }

    private fun scheduleAlarmAt(triggerAtMillis: Long, timerGeneration: Long) {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_TRIGGER_REMINDER
            putExtra(EXTRA_TIMER_GENERATION, timerGeneration)
        }
        val pi = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
        } else {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
        }
    }

    private fun cancelAlarm() {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_TRIGGER_REMINDER
        }
        val pi = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarmManager.cancel(pi)
    }

    private fun scheduleAlertTimeoutAt(deadlineAtMillis: Long, timerGeneration: Long, alertId: Long) {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_ALERT_TIMEOUT
            putExtra(EXTRA_TIMER_GENERATION, timerGeneration)
            putExtra(EXTRA_ALERT_ID, alertId)
        }
        val pi = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.TIMEOUT_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, deadlineAtMillis, pi)
        } else {
            alarmManager.setExact(AlarmManager.RTC_WAKEUP, deadlineAtMillis, pi)
        }
    }

    fun cancelAlertTimeout() {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_ALERT_TIMEOUT
        }
        val pi = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.TIMEOUT_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarmManager.cancel(pi)
    }

    // UI Helper Actions
    fun startTimer(intervalMinutes: Int = getIntervalMinutes()) {
        setIntervalMinutes(intervalMinutes)
        dispatch(TimerEvent(TimerEventType.START, timestamp = System.currentTimeMillis()))
    }

    fun startCountdown(minutes: Int = getCountdownMinutes(), seconds: Int = getCountdownSeconds()) {
        setCountdownMinutes(minutes)
        setCountdownSeconds(seconds)
        dispatch(TimerEvent(TimerEventType.START, timestamp = System.currentTimeMillis()))
    }

    fun stopTimer() {
        val snapshot = getSnapshot()
        dispatch(TimerEvent(TimerEventType.STOP, timerGeneration = snapshot.timerGeneration, timestamp = System.currentTimeMillis()))
    }

    fun scheduleNextOccurrence() {
        val snapshot = getSnapshot()
        dispatch(TimerEvent(TimerEventType.TIMER_TRIGGER, timerGeneration = snapshot.timerGeneration, timestamp = System.currentTimeMillis()))
    }

    fun scheduleAlertTimeout(seconds: Int = getAlertDurationSeconds()) {
        val snapshot = getSnapshot()
        if (snapshot.state == TimerState.ALERT_ACTIVE && snapshot.alertId != null) {
            val deadlineAt = System.currentTimeMillis() + Math.max(5, seconds) * 1000L
            scheduleAlertTimeoutAt(deadlineAt, snapshot.timerGeneration, snapshot.alertId)
        }
    }

    fun isTimerRunning(): Boolean = getSnapshot().state != TimerState.STOPPED

    fun getTimerMode(): String = prefs.getString(KEY_TIMER_MODE, "interval") ?: "interval"
    fun setTimerMode(mode: String) { prefs.edit().putString(KEY_TIMER_MODE, mode).apply() }
    fun getCurrentEventTitle(): String = prefs.getString(KEY_EVENT_TITLE, "Vízivás") ?: "Vízivás"
    fun setCurrentEventTitle(title: String) { prefs.edit().putString(KEY_EVENT_TITLE, title).apply() }

    fun isClockAlignedInterval(): Boolean = prefs.getString(KEY_INTERVAL_MODE, "free") == "clock"
    fun setClockAlignedInterval(enabled: Boolean) { prefs.edit().putString(KEY_INTERVAL_MODE, if (enabled) "clock" else "free").apply() }
    fun getClockIntervalMinutes(): Int = prefs.getInt(KEY_CLOCK_INTERVAL_MINUTES, DEFAULT_CLOCK_INTERVAL_MINUTES)
    fun setClockIntervalMinutes(minutes: Int) { prefs.edit().putInt(KEY_CLOCK_INTERVAL_MINUTES, minutes.coerceIn(30, 90)).apply() }

    fun getIntervalMinutes() = prefs.getInt(KEY_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES)
    fun setIntervalMinutes(minutes: Int) { prefs.edit().putInt(KEY_INTERVAL_MINUTES, minutes.coerceAtLeast(1)).apply() }
    fun getCountdownMinutes() = prefs.getInt(KEY_COUNTDOWN_MINUTES, DEFAULT_COUNTDOWN_MINUTES)
    fun setCountdownMinutes(minutes: Int) { prefs.edit().putInt(KEY_COUNTDOWN_MINUTES, minutes.coerceAtLeast(0)).apply() }
    fun getCountdownSeconds() = prefs.getInt(KEY_COUNTDOWN_SECONDS, 0)
    fun setCountdownSeconds(seconds: Int) { prefs.edit().putInt(KEY_COUNTDOWN_SECONDS, seconds.coerceIn(0, 59)).apply() }

    fun getAlertDurationSeconds() = prefs.getInt(KEY_ALERT_DURATION_SECONDS, DEFAULT_ALERT_DURATION_SECONDS).coerceAtLeast(5)
    fun setAlertDurationSeconds(seconds: Int) { prefs.edit().putInt(KEY_ALERT_DURATION_SECONDS, seconds.coerceAtLeast(5)).apply() }
    fun getNextTriggerTimestamp() = getSnapshot().nextTriggerAt ?: 0L

    private fun today(): String { val c = Calendar.getInstance(); return "${c.get(Calendar.YEAR)}-${c.get(Calendar.MONTH)}-${c.get(Calendar.DAY_OF_MONTH)}" }
    fun checkDailyReset() { if (prefs.getString(KEY_LAST_RESET_DATE, "") != today()) prefs.edit().putInt(KEY_TODAY_DRUNK_ML, 0).putInt(KEY_TODAY_MISSED_COUNT, 0).putInt(KEY_TODAY_ACK_COUNT, 0).putString(KEY_LAST_RESET_DATE, today()).apply() }
    fun getTodayDrunkMl() = prefs.getInt(KEY_TODAY_DRUNK_ML, 0).also { checkDailyReset() }
    fun setTodayDrunkMl(ml: Int) { checkDailyReset(); prefs.edit().putInt(KEY_TODAY_DRUNK_ML, ml.coerceAtLeast(0)).apply() }
    fun addDrunkMl(ml: Int): Int { val updated = getTodayDrunkMl() + ml; setTodayDrunkMl(updated); return updated }
    fun getTodayMissedCount() = prefs.getInt(KEY_TODAY_MISSED_COUNT, 0).also { checkDailyReset() }
    fun recordTodayMissed() { checkDailyReset(); prefs.edit().putInt(KEY_TODAY_MISSED_COUNT, getTodayMissedCount() + 1).apply() }
    fun getTodayAckCount() = prefs.getInt(KEY_TODAY_ACK_COUNT, 0).also { checkDailyReset() }
    fun recordTodayAck() { checkDailyReset(); prefs.edit().putInt(KEY_TODAY_ACK_COUNT, getTodayAckCount() + 1).apply() }
    fun getDailyTargetMl() = prefs.getInt(KEY_DAILY_TARGET_ML, 2500)
    fun setDailyTargetMl(ml: Int) { prefs.edit().putInt(KEY_DAILY_TARGET_ML, ml).apply() }
    fun getIntakePerAlertMl() = prefs.getInt(KEY_INTAKE_PER_ALERT_ML, 250)
    fun setIntakePerAlertMl(ml: Int) { prefs.edit().putInt(KEY_INTAKE_PER_ALERT_ML, ml).apply() }
    fun recordMissedAlert() { prefs.edit().putInt(KEY_MISSED_COUNT, getMissedAlertsCount() + 1).putLong(KEY_LAST_MISSED_TIME, System.currentTimeMillis()).apply() }
    fun getMissedAlertsCount() = prefs.getInt(KEY_MISSED_COUNT, 0)
    fun getLastMissedTimestamp() = prefs.getLong(KEY_LAST_MISSED_TIME, 0L)
    fun clearMissedAlerts() { prefs.edit().putInt(KEY_MISSED_COUNT, 0).putLong(KEY_LAST_MISSED_TIME, 0L).apply() }

    fun isQuietHoursEnabled() = prefs.getBoolean(KEY_QUIET_HOURS_ENABLED, true)
    fun setQuietHoursEnabled(enabled: Boolean) { prefs.edit().putBoolean(KEY_QUIET_HOURS_ENABLED, enabled).apply() }
    fun getActiveDays(): BooleanArray = (prefs.getString(KEY_ACTIVE_DAYS, "true,true,true,true,true,true,true") ?: "true,true,true,true,true,true,true").split(",").let { p -> BooleanArray(7) { i -> p.getOrNull(i)?.toBoolean() ?: true } }
    fun setActiveDays(days: BooleanArray) { prefs.edit().putString(KEY_ACTIVE_DAYS, days.joinToString(",")).apply() }
    fun isDayActive(day: Int) = getActiveDays().getOrElse(day - 1) { true }
    fun getQuietHoursStart() = prefs.getString(KEY_QUIET_HOURS_START, DEFAULT_QUIET_HOURS_START) ?: DEFAULT_QUIET_HOURS_START
    fun setQuietHoursStart(time: String) { prefs.edit().putString(KEY_QUIET_HOURS_START, time).apply() }
    fun getQuietHoursEnd() = prefs.getString(KEY_QUIET_HOURS_END, DEFAULT_QUIET_HOURS_END) ?: DEFAULT_QUIET_HOURS_END
    fun setQuietHoursEnd(time: String) { prefs.edit().putString(KEY_QUIET_HOURS_END, time).apply() }
    fun isInQuietHours(): Boolean = TimerDomainEngine.isInQuietHoursAt(System.currentTimeMillis(), getQuietHoursStart(), getQuietHoursEnd())
}
