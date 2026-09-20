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
        const val ACTION_ACKNOWLEDGE = "com.hydrotimer.app.ACTION_ACKNOWLEDGE"
        const val ACTION_ALERT_TIMEOUT = "com.hydrotimer.app.ACTION_ALERT_TIMEOUT"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val timerManager = TimerManager(context)
        when (intent.action) {
            ACTION_TRIGGER_REMINDER -> {
                if (!timerManager.isTimerRunning()) return
                val today = java.util.Calendar.getInstance().get(java.util.Calendar.DAY_OF_WEEK)
                if (!timerManager.isDayActive(today) || timerManager.isInQuietHours()) {
                    timerManager.scheduleNextOccurrence()
                    return
                }
                NotificationHelper.showWaterReminder(context)
                timerManager.scheduleAlertTimeout(timerManager.getAlertDurationSeconds())
            }
            ACTION_LOG_DRINK -> {
                timerManager.cancelAlertTimeout()
                NotificationHelper.cancelAlertNotifications(context)
                val intake = timerManager.getIntakePerAlertMl()
                val total = timerManager.addDrunkMl(intake)
                timerManager.recordTodayAck()
                Toast.makeText(context, "💧 +$intake ml rögzítve! Összesen: ${total} ml", Toast.LENGTH_SHORT).show()
                timerManager.scheduleNextOccurrence()
            }
            ACTION_ACKNOWLEDGE -> {
                timerManager.cancelAlertTimeout()
                NotificationHelper.cancelAlertNotifications(context)
                timerManager.recordTodayAck()
                Toast.makeText(context, "✓ Emlékeztető nyugtázva, következő szakasz elindult.", Toast.LENGTH_SHORT).show()
                timerManager.scheduleNextOccurrence()
            }
            ACTION_ALERT_TIMEOUT -> {
                if (!timerManager.isTimerRunning()) return
                timerManager.cancelAlertTimeout()
                NotificationHelper.cancelAlertNotifications(context)
                timerManager.recordMissedAlert()
                timerManager.recordTodayMissed()
                NotificationHelper.showMissedAlertNotification(context, timerManager.getAlertDurationSeconds())
                timerManager.scheduleNextOccurrence()
            }
        }
    }
}
