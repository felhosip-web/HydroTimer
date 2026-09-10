package com.hydrotimer.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build

class TimerManager(private val context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    companion object {
        const val PREFS_NAME = "hydro_timer_prefs"
        const val KEY_IS_RUNNING = "is_running"
        const val KEY_INTERVAL_MINUTES = "interval_minutes"
        const val KEY_ALERT_DURATION_SECONDS = "alert_duration_seconds"
        const val KEY_NEXT_TRIGGER_TIMESTAMP = "next_trigger_timestamp"
        const val KEY_TODAY_DRUNK_ML = "today_drunk_ml"
        const val KEY_DAILY_TARGET_ML = "daily_target_ml"
        const val KEY_INTAKE_PER_ALERT_ML = "intake_per_alert_ml"
        const val KEY_MISSED_COUNT = "missed_alerts_count"
        const val KEY_LAST_MISSED_TIME = "last_missed_timestamp"
        const val KEY_ACTIVE_DAYS = "active_days"
        const val KEY_QUIET_HOURS_ENABLED = "quiet_hours_enabled"
        const val KEY_QUIET_HOURS_START = "quiet_hours_start"
        const val KEY_QUIET_HOURS_END = "quiet_hours_end"
        const val DEFAULT_INTERVAL_MINUTES = 30
        const val DEFAULT_ALERT_DURATION_SECONDS = 15
        const val DEFAULT_QUIET_HOURS_START = "23:00"
        const val DEFAULT_QUIET_HOURS_END = "07:00"
    }

    fun startTimer(intervalMinutes: Int = getIntervalMinutes()) {
        val triggerAtMillis = System.currentTimeMillis() + (intervalMinutes * 60 * 1000L)

        prefs.edit()
            .putBoolean(KEY_IS_RUNNING, true)
            .putInt(KEY_INTERVAL_MINUTES, intervalMinutes)
            .putLong(KEY_NEXT_TRIGGER_TIMESTAMP, triggerAtMillis)
            .apply()

        scheduleAlarm(triggerAtMillis)
    }

    fun stopTimer() {
        prefs.edit()
            .putBoolean(KEY_IS_RUNNING, false)
            .putLong(KEY_NEXT_TRIGGER_TIMESTAMP, 0L)
            .apply()

        cancelAlarm()
        cancelAlertTimeout()
    }

    fun scheduleNextOccurrence() {
        if (!isTimerRunning()) return
        val intervalMinutes = prefs.getInt(KEY_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES)
        val triggerAtMillis = System.currentTimeMillis() + (intervalMinutes * 60 * 1000L)

        prefs.edit()
            .putLong(KEY_NEXT_TRIGGER_TIMESTAMP, triggerAtMillis)
            .apply()

        scheduleAlarm(triggerAtMillis)
    }

    private fun scheduleAlarm(triggerAtMillis: Long) {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_TRIGGER_REMINDER
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                triggerAtMillis,
                pendingIntent
            )
        } else {
            alarmManager.setExact(
                AlarmManager.RTC_WAKEUP,
                triggerAtMillis,
                pendingIntent
            )
        }
    }

    private fun cancelAlarm() {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_TRIGGER_REMINDER
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarmManager.cancel(pendingIntent)
    }

    /**
     * Schedules timeout after which an unacknowledged alarm triggers missed notice & auto next period
     */
    fun scheduleAlertTimeout(seconds: Int = getAlertDurationSeconds()) {
        val timeoutAtMillis = System.currentTimeMillis() + (seconds * 1000L)
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_ALERT_TIMEOUT
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.TIMEOUT_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                timeoutAtMillis,
                pendingIntent
            )
        } else {
            alarmManager.setExact(
                AlarmManager.RTC_WAKEUP,
                timeoutAtMillis,
                pendingIntent
            )
        }
    }

    fun cancelAlertTimeout() {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_ALERT_TIMEOUT
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.TIMEOUT_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarmManager.cancel(pendingIntent)
    }

    fun isTimerRunning(): Boolean = prefs.getBoolean(KEY_IS_RUNNING, false)
    
    fun getIntervalMinutes(): Int = prefs.getInt(KEY_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES)
    fun setIntervalMinutes(minutes: Int) {
        prefs.edit().putInt(KEY_INTERVAL_MINUTES, minutes).apply()
    }

    fun getAlertDurationSeconds(): Int = prefs.getInt(KEY_ALERT_DURATION_SECONDS, DEFAULT_ALERT_DURATION_SECONDS)
    fun setAlertDurationSeconds(seconds: Int) {
        prefs.edit().putInt(KEY_ALERT_DURATION_SECONDS, seconds).apply()
    }

    fun getNextTriggerTimestamp(): Long = prefs.getLong(KEY_NEXT_TRIGGER_TIMESTAMP, 0L)

    fun getTodayDrunkMl(): Int = prefs.getInt(KEY_TODAY_DRUNK_ML, 0)
    fun setTodayDrunkMl(ml: Int) {
        prefs.edit().putInt(KEY_TODAY_DRUNK_ML, ml).apply()
    }
    fun addDrunkMl(ml: Int): Int {
        val current = getTodayDrunkMl() + ml
        setTodayDrunkMl(current)
        return current
    }

    fun getDailyTargetMl(): Int = prefs.getInt(KEY_DAILY_TARGET_ML, 2500)
    fun setDailyTargetMl(ml: Int) {
        prefs.edit().putInt(KEY_DAILY_TARGET_ML, ml).apply()
    }

    fun getIntakePerAlertMl(): Int = prefs.getInt(KEY_INTAKE_PER_ALERT_ML, 250)
    fun setIntakePerAlertMl(ml: Int) {
        prefs.edit().putInt(KEY_INTAKE_PER_ALERT_ML, ml).apply()
    }

    fun recordMissedAlert() {
        val currentCount = prefs.getInt(KEY_MISSED_COUNT, 0) + 1
        prefs.edit()
            .putInt(KEY_MISSED_COUNT, currentCount)
            .putLong(KEY_LAST_MISSED_TIME, System.currentTimeMillis())
            .apply()
    }

    fun getMissedAlertsCount(): Int = prefs.getInt(KEY_MISSED_COUNT, 0)
    fun getLastMissedTimestamp(): Long = prefs.getLong(KEY_LAST_MISSED_TIME, 0L)
    fun clearMissedAlerts() {
        prefs.edit().putInt(KEY_MISSED_COUNT, 0).putLong(KEY_LAST_MISSED_TIME, 0L).apply()
    }

    // Quiet Hours (Csendes Időszak / Ne Zavarj) methods
    fun isQuietHoursEnabled(): Boolean = prefs.getBoolean(KEY_QUIET_HOURS_ENABLED, true)
    fun setQuietHoursEnabled(enabled: Boolean) {
        prefs.edit().putBoolean(KEY_QUIET_HOURS_ENABLED, enabled).apply()
    }

    fun getActiveDays(): BooleanArray {
        val daysStr = prefs.getString(KEY_ACTIVE_DAYS, "true,true,true,true,true,true,true") ?: "true,true,true,true,true,true,true"
        val parts = daysStr.split(",")
        return BooleanArray(7) { i -> if (i < parts.size) parts[i].toBoolean() else true }
    }

    fun setActiveDays(days: BooleanArray) {
        val daysStr = days.joinToString(",")
        prefs.edit().putString(KEY_ACTIVE_DAYS, daysStr).apply()
    }

    /**
     * calendarDayOfWeek: 1 = Sunday, 2 = Monday, ..., 7 = Saturday
     */
    fun isDayActive(calendarDayOfWeek: Int): Boolean {
        val index = calendarDayOfWeek - 1
        val days = getActiveDays()
        return if (index in days.indices) days[index] else true
    }

    fun getQuietHoursStart(): String = prefs.getString(KEY_QUIET_HOURS_START, DEFAULT_QUIET_HOURS_START) ?: DEFAULT_QUIET_HOURS_START
    fun setQuietHoursStart(time: String) {
        prefs.edit().putString(KEY_QUIET_HOURS_START, time).apply()
    }

    fun getQuietHoursEnd(): String = prefs.getString(KEY_QUIET_HOURS_END, DEFAULT_QUIET_HOURS_END) ?: DEFAULT_QUIET_HOURS_END
    fun setQuietHoursEnd(time: String) {
        prefs.edit().putString(KEY_QUIET_HOURS_END, time).apply()
    }

    fun isInQuietHours(): Boolean {
        if (!isQuietHoursEnabled()) return false
        val startStr = getQuietHoursStart()
        val endStr = getQuietHoursEnd()

        return try {
            val calendar = java.util.Calendar.getInstance()
            val nowMinutes = calendar.get(java.util.Calendar.HOUR_OF_DAY) * 60 + calendar.get(java.util.Calendar.MINUTE)

            val startParts = startStr.split(":")
            val endParts = endStr.split(":")
            val startMinutes = startParts[0].toInt() * 60 + startParts[1].toInt()
            val endMinutes = endParts[0].toInt() * 60 + endParts[1].toInt()

            if (startMinutes < endMinutes) {
                // Same-day range (e.g. 13:00 - 15:00)
                nowMinutes in startMinutes until endMinutes
            } else {
                // Overnight range (e.g. 23:00 - 07:00)
                nowMinutes >= startMinutes || nowMinutes < endMinutes
            }
        } catch (e: Exception) {
            false
        }
    }
}

