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
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager

        when (intent.action) {
            ACTION_TRIGGER_REMINDER -> {
                // Quiet Hours check (e.g. 23:00 - 07:00 sleep mode)
                if (timerManager.isInQuietHours()) {
                    // Suppress loud sound & vibration during sleep/quiet period.
                    // Automatically schedule the next occurrence silently!
                    timerManager.scheduleNextOccurrence()
                    return
                }

                // 1. Show notification (which mirrors to Honor Watch / Bluetooth band)
                NotificationHelper.showWaterReminder(context)

                // 2. Schedule timeout for acknowledgment
                val alertDurationSeconds = timerManager.getAlertDurationSeconds()
                timerManager.scheduleAlertTimeout(alertDurationSeconds)
            }

            ACTION_LOG_DRINK -> {
                // 1. Cancel pending timeout alarm
                timerManager.cancelAlertTimeout()
                notificationManager.cancel(NotificationHelper.NOTIFICATION_ID)

                // 2. Log drink
                val intake = timerManager.getIntakePerAlertMl()
                val updatedTotal = timerManager.addDrunkMl(intake)
                Toast.makeText(context, "💧 +$intake ml rögzítve! Összesen: ${updatedTotal} ml", Toast.LENGTH_SHORT).show()

                // 3. Start next occurrence
                timerManager.scheduleNextOccurrence()
            }

            ACTION_ACKNOWLEDGE -> {
                // 1. Cancel pending timeout alarm
                timerManager.cancelAlertTimeout()
                notificationManager.cancel(NotificationHelper.NOTIFICATION_ID)

                Toast.makeText(context, "✓ Emlékeztető nyugtázva, következő szakasz elindult.", Toast.LENGTH_SHORT).show()

                // 2. Start next occurrence
                timerManager.scheduleNextOccurrence()
            }

            ACTION_ALERT_TIMEOUT -> {
                // 1. User did NOT acknowledge within the configured alertDurationSeconds
                notificationManager.cancel(NotificationHelper.NOTIFICATION_ID)

                // 2. Record missed alert
                timerManager.recordMissedAlert()

                // 3. Post missed warning notification with distinct sound
                val alertDuration = timerManager.getAlertDurationSeconds()
                NotificationHelper.showMissedAlertNotification(context, alertDuration)

                // 4. Automatically advance to next period as requested!
                timerManager.scheduleNextOccurrence()
            }
        }
    }
}

