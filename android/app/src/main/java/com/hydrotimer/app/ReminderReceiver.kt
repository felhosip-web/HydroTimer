package com.hydrotimer.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast

class ReminderReceiver : BroadcastReceiver() {
    companion object {
        const val ALARM_REQUEST_CODE = 2001
        const val TIMEOUT_REQUEST_CODE = 2002
        const val ACTION_TRIGGER_REMINDER = "com.hydrotimer.app.ACTION_TRIGGER_REMINDER"
        const val ACTION_LOG_DRINK = "com.hydrotimer.app.ACTION_LOG_DRINK"
        const val ACTION_LOG_MISSED_DRINK = "com.hydrotimer.app.ACTION_LOG_MISSED_DRINK"
        const val ACTION_ACKNOWLEDGE = "com.hydrotimer.app.ACTION_ACKNOWLEDGE"
        const val ACTION_ALERT_TIMEOUT = "com.hydrotimer.app.ACTION_ALERT_TIMEOUT"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val timerManager = TimerManager(context)
        val now = System.currentTimeMillis()

        var gen: Long? = if (intent.hasExtra(TimerManager.EXTRA_TIMER_GENERATION)) {
            val value = intent.getLongExtra(TimerManager.EXTRA_TIMER_GENERATION, -1L)
            if (value <= 0L) null else value
        } else null

        var alertId: Long? = if (intent.hasExtra(TimerManager.EXTRA_ALERT_ID)) {
            val value = intent.getLongExtra(TimerManager.EXTRA_ALERT_ID, -1L)
            if (value <= 0L) null else value
        } else null

        // Explicit, narrowly scoped compatibility fallback for active alerts when notification/watch actions lack IDs
        val snapshot = timerManager.getSnapshot()
        if (snapshot.state == TimerState.ALERT_ACTIVE) {
            if (gen == null) {
                gen = snapshot.timerGeneration
            }
            if (alertId == null) {
                alertId = snapshot.alertId
            }
        }

        when (intent.action) {
            ACTION_TRIGGER_REMINDER -> {
                timerManager.dispatch(
                    TimerEvent(TimerEventType.TIMER_TRIGGER, timerGeneration = gen, timestamp = now),
                    now
                )
            }
            ACTION_LOG_DRINK -> {
                timerManager.dispatch(
                    TimerEvent(TimerEventType.DRINK, timerGeneration = gen, alertId = alertId, timestamp = now),
                    now
                )
            }
            ACTION_LOG_MISSED_DRINK -> {
                val intake = timerManager.getIntakePerAlertMl()
                val total = timerManager.addDrunkMl(intake)
                timerManager.recordTodayAck()
                NotificationHelper.cancelAlertNotifications(context)
                Toast.makeText(context, "💧 +$intake ml rögzítve! Összesen: ${total} ml", Toast.LENGTH_SHORT).show()
            }
            ACTION_ACKNOWLEDGE -> {
                timerManager.dispatch(
                    TimerEvent(TimerEventType.ACKNOWLEDGE, timerGeneration = gen, alertId = alertId, timestamp = now),
                    now
                )
            }
            ACTION_ALERT_TIMEOUT -> {
                timerManager.dispatch(
                    TimerEvent(TimerEventType.ALERT_TIMEOUT, timerGeneration = gen, alertId = alertId, timestamp = now),
                    now
                )
            }
        }
    }
}
