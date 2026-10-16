package com.hydrotimer.app

enum class TimerEventType {
    START,
    STOP,
    TIMER_TRIGGER,
    ACKNOWLEDGE,
    DRINK,
    ALERT_TIMEOUT,
    RECOVER,
    TEST_ALERT
}

data class TimerEvent(
    val type: TimerEventType,
    val timerGeneration: Long? = null,
    val alertId: Long? = null,
    val scheduledAt: Long? = null,
    val timestamp: Long
)
