package com.hydrotimer.app

data class TimerSnapshot(
    val state: TimerState = TimerState.STOPPED,
    val timerGeneration: Long = 0L,
    val alertId: Long? = null,
    val lastAlertId: Long = 0L,
    val nextTriggerAt: Long? = null,
    val alertStartedAt: Long? = null,
    val alertDeadlineAt: Long? = null,
    val alertScheduledAt: Long? = null,
    val isTestAlert: Boolean = false,
    val intakeMl: Int? = null,
    val dailyGoalMl: Int? = null
)
