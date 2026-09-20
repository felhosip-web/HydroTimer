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
        const val KEY_IS_RUNNING = "is_running"
        const val KEY_INTERVAL_MINUTES = "interval_minutes"
        const val KEY_INTERVAL_MODE = "interval_mode" // "free" or "clock"
        const val KEY_CLOCK_INTERVAL_MINUTES = "clock_interval_minutes"
        const val KEY_ALERT_DURATION_SECONDS = "alert_duration_seconds"
        const val KEY_NEXT_TRIGGER_TIMESTAMP = "next_trigger_timestamp"
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
        const val DEFAULT_CLOCK_INTERVAL_MINUTES = 30
        const val DEFAULT_ALERT_DURATION_SECONDS = 15
        const val DEFAULT_QUIET_HOURS_START = "23:00"
        const val DEFAULT_QUIET_HOURS_END = "07:00"
    }

    fun isClockAlignedInterval(): Boolean = prefs.getString(KEY_INTERVAL_MODE, "free") == "clock"
    fun setClockAlignedInterval(enabled: Boolean) {
        prefs.edit().putString(KEY_INTERVAL_MODE, if (enabled) "clock" else "free").apply()
    }
    fun getClockIntervalMinutes(): Int = prefs.getInt(KEY_CLOCK_INTERVAL_MINUTES, DEFAULT_CLOCK_INTERVAL_MINUTES)
    fun setClockIntervalMinutes(minutes: Int) {
        prefs.edit().putInt(KEY_CLOCK_INTERVAL_MINUTES, minutes.coerceIn(30, 90)).apply()
    }

    private fun nextTriggerFromNow(): Long {
        if (!isClockAlignedInterval()) {
            return System.currentTimeMillis() + getIntervalMinutes() * 60_000L
        }
        val step = getClockIntervalMinutes().coerceIn(30, 90)
        val now = Calendar.getInstance()
        val currentMinute = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE)
        val currentSecond = now.get(Calendar.SECOND)
        val nextSlot = ((currentMinute / step) + 1) * step
        val result = Calendar.getInstance().apply {
            set(Calendar.HOUR_OF_DAY, (nextSlot / 60) % 24)
            set(Calendar.MINUTE, nextSlot % 60)
            set(Calendar.SECOND, 0)
            set(Calendar.MILLISECOND, 0)
            if (nextSlot >= 24 * 60 || timeInMillis <= System.currentTimeMillis()) add(Calendar.DAY_OF_YEAR, 1)
        }
        return result.timeInMillis
    }

    fun startTimer(intervalMinutes: Int = getIntervalMinutes()) {
        prefs.edit().putBoolean(KEY_IS_RUNNING, true).putInt(KEY_INTERVAL_MINUTES, intervalMinutes).apply()
        scheduleAt(nextTriggerFromNow())
    }

    fun stopTimer() {
        prefs.edit().putBoolean(KEY_IS_RUNNING, false).putLong(KEY_NEXT_TRIGGER_TIMESTAMP, 0L).apply()
        cancelAlarm()
        cancelAlertTimeout()
    }

    fun scheduleNextOccurrence() {
        if (!isTimerRunning()) return
        scheduleAt(nextTriggerFromNow())
    }

    private fun scheduleAt(triggerAtMillis: Long) {
        prefs.edit().putLong(KEY_NEXT_TRIGGER_TIMESTAMP, triggerAtMillis).apply()
        val intent = Intent(context, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_TRIGGER_REMINDER)
        val pi = PendingIntent.getBroadcast(context, ReminderReceiver.ALARM_REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
        else alarmManager.setExact(AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
    }

    private fun cancelAlarm() {
        val intent = Intent(context, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_TRIGGER_REMINDER)
        val pi = PendingIntent.getBroadcast(context, ReminderReceiver.ALARM_REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        alarmManager.cancel(pi)
    }

    fun scheduleAlertTimeout(seconds: Int = getAlertDurationSeconds()) {
        val at = System.currentTimeMillis() + seconds.coerceAtLeast(5) * 1000L
        val intent = Intent(context, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_ALERT_TIMEOUT)
        val pi = PendingIntent.getBroadcast(context, ReminderReceiver.TIMEOUT_REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) alarmManager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
        else alarmManager.setExact(AlarmManager.RTC_WAKEUP, at, pi)
    }

    fun cancelAlertTimeout() {
        val intent = Intent(context, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_ALERT_TIMEOUT)
        val pi = PendingIntent.getBroadcast(context, ReminderReceiver.TIMEOUT_REQUEST_CODE, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        alarmManager.cancel(pi)
    }

    fun isTimerRunning() = prefs.getBoolean(KEY_IS_RUNNING, false)
    fun getIntervalMinutes() = prefs.getInt(KEY_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES)
    fun setIntervalMinutes(minutes: Int) { prefs.edit().putInt(KEY_INTERVAL_MINUTES, minutes.coerceAtLeast(1)).apply() }
    fun getAlertDurationSeconds() = prefs.getInt(KEY_ALERT_DURATION_SECONDS, DEFAULT_ALERT_DURATION_SECONDS).coerceAtLeast(5)
    fun setAlertDurationSeconds(seconds: Int) { prefs.edit().putInt(KEY_ALERT_DURATION_SECONDS, seconds.coerceAtLeast(5)).apply() }
    fun getNextTriggerTimestamp() = prefs.getLong(KEY_NEXT_TRIGGER_TIMESTAMP, 0L)

    private fun today(): String { val c = Calendar.getInstance(); return "${c.get(Calendar.YEAR)}-${c.get(Calendar.MONTH)}-${c.get(Calendar.DAY_OF_MONTH)}" }
    fun checkDailyReset() { if (prefs.getString(KEY_LAST_RESET_DATE, "") != today()) prefs.edit().putInt(KEY_TODAY_DRUNK_ML, 0).putInt(KEY_TODAY_MISSED_COUNT, 0).putInt(KEY_TODAY_ACK_COUNT, 0).putString(KEY_LAST_RESET_DATE, today()).apply() }
    fun getTodayDrunkMl() = prefs.getInt(KEY_TODAY_DRUNK_ML, 0).also { checkDailyReset() }
    fun setTodayDrunkMl(ml: Int) { checkDailyReset(); prefs.edit().putInt(KEY_TODAY_DRUNK_ML, ml.coerceAtLeast(0)).apply() }
    fun addDrunkMl(ml: Int) = (getTodayDrunkMl() + ml).also { setTodayDrunkMl(it) }
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
    fun isInQuietHours(): Boolean {
        if (!isQuietHoursEnabled()) return false
        return try {
            val c = Calendar.getInstance(); val now = c.get(Calendar.HOUR_OF_DAY) * 60 + c.get(Calendar.MINUTE)
            val s = getQuietHoursStart().split(":").let { it[0].toInt() * 60 + it[1].toInt() }
            val e = getQuietHoursEnd().split(":").let { it[0].toInt() * 60 + it[1].toInt() }
            if (s < e) now in s until e else now >= s || now < e
        } catch (_: Exception) { false }
    }
}
