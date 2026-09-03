package com.hydrotimer.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            val timerManager = TimerManager(context)
            if (timerManager.isTimerRunning()) {
                // Restore scheduled alarms after phone restarts
                timerManager.scheduleNextOccurrence()
            }
        }
    }
}
