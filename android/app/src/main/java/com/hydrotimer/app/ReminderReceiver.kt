package com.hydrotimer.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

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
        val gen = if (intent.hasExtra(TimerManager.EXTRA_TIMER_GENERATION)) {
            intent.getLongExtra(TimerManager.EXTRA_TIMER_GENERATION, -1L)
        } else null
        val alertId = if (intent.hasExtra(TimerManager.EXTRA_ALERT_ID)) {
            intent.getLongExtra(TimerManager.EXTRA_ALERT_ID, -1L)
        } else null
        val now = System.currentTimeMillis()

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
