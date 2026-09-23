package com.hydrotimer.app

data class EngineConfig(
    val mode: String = "interval", // "interval" or "countdown"
    val intervalMinutes: Int = 30,
    val countdownMinutes: Int = 5,
    val countdownSeconds: Int = 0,
    val alertDurationSeconds: Int = 15,
    val intervalMode: String = "free", // "free" or "clock"
    val clockIntervalMinutes: Int = 30,
    val autoRestart: Boolean = true,
    val intakePerAlertMl: Int = 250,
    val quietHoursEnabled: Boolean = true,
    val quietHoursStart: String = "23:00",
    val quietHoursEnd: String = "07:00",
    val activeDays: BooleanArray = booleanArrayOf(true, true, true, true, true, true, true)
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as EngineConfig
        if (mode != other.mode) return false
        if (intervalMinutes != other.intervalMinutes) return false
        if (countdownMinutes != other.countdownMinutes) return false
        if (countdownSeconds != other.countdownSeconds) return false
        if (alertDurationSeconds != other.alertDurationSeconds) return false
        if (intervalMode != other.intervalMode) return false
        if (clockIntervalMinutes != other.clockIntervalMinutes) return false
        if (autoRestart != other.autoRestart) return false
        if (intakePerAlertMl != other.intakePerAlertMl) return false
        if (quietHoursEnabled != other.quietHoursEnabled) return false
        if (quietHoursStart != other.quietHoursStart) return false
        if (quietHoursEnd != other.quietHoursEnd) return false
        if (!activeDays.contentEquals(other.activeDays)) return false
        return true
    }

    override fun hashCode(): Int {
        var result = mode.hashCode()
        result = 31 * result + intervalMinutes
        result = 31 * result + countdownMinutes
        result = 31 * result + countdownSeconds
        result = 31 * result + alertDurationSeconds
        result = 31 * result + intervalMode.hashCode()
        result = 31 * result + clockIntervalMinutes
        result = 31 * result + autoRestart.hashCode()
        result = 31 * result + intakePerAlertMl
        result = 31 * result + quietHoursEnabled.hashCode()
        result = 31 * result + quietHoursStart.hashCode()
        result = 31 * result + quietHoursEnd.hashCode()
        result = 31 * result + activeDays.contentHashCode()
        return result
    }
}
