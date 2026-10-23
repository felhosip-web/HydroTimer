package com.hydrotimer.app

enum class HydrationEventStatus {
    PENDING,
    DRANK,
    NOT_DRANK,
    REJECTED
}

data class HydrationEvent(
    val id: String,
    val timerGeneration: Long,
    val alertId: Long,
    val scheduledAt: Long,
    val createdAt: Long,
    val status: HydrationEventStatus = HydrationEventStatus.PENDING,
    val updatedAt: Long,
    val revision: Long = 1L,
    val intakeMl: Int? = null,
    val dailyGoalMl: Int? = null
) {
    companion object {
        fun generateId(timerGeneration: Long, alertId: Long): String {
            return "${timerGeneration}_${alertId}"
        }

        fun createPending(
            timerGeneration: Long,
            alertId: Long,
            scheduledAt: Long,
            createdAt: Long = System.currentTimeMillis(),
            intakeMl: Int? = null,
            dailyGoalMl: Int? = null
        ): HydrationEvent {
            return HydrationEvent(
                id = generateId(timerGeneration, alertId),
                timerGeneration = timerGeneration,
                alertId = alertId,
                scheduledAt = scheduledAt,
                createdAt = createdAt,
                status = HydrationEventStatus.PENDING,
                updatedAt = createdAt,
                revision = 1L,
                intakeMl = intakeMl,
                dailyGoalMl = dailyGoalMl
            )
        }
    }
}
