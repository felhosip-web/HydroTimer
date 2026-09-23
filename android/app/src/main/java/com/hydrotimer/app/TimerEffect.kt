package com.hydrotimer.app

sealed class TimerEffect {
    data class ScheduleTimer(val triggerAtMillis: Long, val timerGeneration: Long) : TimerEffect()
    data class ScheduleAlertTimeout(val deadlineAtMillis: Long, val timerGeneration: Long, val alertId: Long) : TimerEffect()
    data class CancelTimer(val timerGeneration: Long) : TimerEffect()
    data class CancelAlertTimeout(val timerGeneration: Long, val alertId: Long?) : TimerEffect()
    data class ShowReminder(val title: String?, val body: String?, val timerGeneration: Long, val alertId: Long) : TimerEffect()
    object CancelReminder : TimerEffect()
    data class ShowMissedNotification(val alertDurationSeconds: Int) : TimerEffect()
    data class RecordDrink(val amountMl: Int) : TimerEffect()
    object RecordAck : TimerEffect()
    object RecordMissed : TimerEffect()
    data class PersistState(val snapshot: TimerSnapshot) : TimerEffect()
}
