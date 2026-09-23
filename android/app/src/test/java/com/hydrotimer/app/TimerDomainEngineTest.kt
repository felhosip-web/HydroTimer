package com.hydrotimer.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TimerDomainEngineTest {

    private val baseConfig = EngineConfig(
        mode = "interval",
        intervalMinutes = 30,
        alertDurationSeconds = 15,
        intervalMode = "free",
        quietHoursEnabled = false,
        activeDays = booleanArrayOf(true, true, true, true, true, true, true)
    )

    private val fixedNow = 1_700_000_000_000L // Deterministic timestamp

    @Test
    fun testStartTimerFromStopped() {
        val initial = TimerSnapshot(state = TimerState.STOPPED, timerGeneration = 0L)
        val event = TimerEvent(type = TimerEventType.START, timestamp = fixedNow)

        val result = TimerDomainEngine.processEvent(initial, event, baseConfig, fixedNow)

        assertEquals(TimerState.WAITING, result.newSnapshot.state)
        assertEquals(1L, result.newSnapshot.timerGeneration)
        assertNull(result.newSnapshot.alertId)
        assertEquals(fixedNow + 30 * 60_000L, result.newSnapshot.nextTriggerAt)

        assertTrue(result.effects.any { it is TimerEffect.ScheduleTimer && it.timerGeneration == 1L })
        assertTrue(result.effects.any { it is TimerEffect.PersistState })
    }

    @Test
    fun testStopTimerFromWaiting() {
        val waiting = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 5L,
            nextTriggerAt = fixedNow + 1000L
        )
        val event = TimerEvent(type = TimerEventType.STOP, timerGeneration = 5L, timestamp = fixedNow)

        val result = TimerDomainEngine.processEvent(waiting, event, baseConfig, fixedNow)

        assertEquals(TimerState.STOPPED, result.newSnapshot.state)
        assertNull(result.newSnapshot.nextTriggerAt)
        assertTrue(result.effects.any { it is TimerEffect.CancelTimer && it.timerGeneration == 5L })
    }

    @Test
    fun testTimerTriggerTransitionToAlertActive() {
        val waiting = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 2L,
            nextTriggerAt = fixedNow
        )
        val event = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 2L, timestamp = fixedNow)

        val result = TimerDomainEngine.processEvent(waiting, event, baseConfig, fixedNow)

        assertEquals(TimerState.ALERT_ACTIVE, result.newSnapshot.state)
        assertEquals(2L, result.newSnapshot.timerGeneration)
        assertEquals(1001L, result.newSnapshot.alertId)
        assertEquals(1001L, result.newSnapshot.lastAlertId)
        assertEquals(fixedNow, result.newSnapshot.alertStartedAt)
        assertEquals(fixedNow + 15_000L, result.newSnapshot.alertDeadlineAt)

        assertTrue(result.effects.any { it is TimerEffect.ShowReminder && it.alertId == 1001L })
        assertTrue(result.effects.any { it is TimerEffect.ScheduleAlertTimeout && it.alertId == 1001L })
    }

    @Test
    fun testMonotonicAlertIdIncrementsAcrossMultipleAlertCycles() {
        val waiting1 = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 1L, lastAlertId = 0L)
        val res1 = TimerDomainEngine.processEvent(waiting1, TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, timestamp = fixedNow), baseConfig, fixedNow)
        assertEquals(1001L, res1.newSnapshot.alertId)
        assertEquals(1001L, res1.newSnapshot.lastAlertId)

        val ack1 = TimerDomainEngine.processEvent(res1.newSnapshot, TimerEvent(type = TimerEventType.ACKNOWLEDGE, timerGeneration = 1L, alertId = 1001L, timestamp = fixedNow + 1000L), baseConfig, fixedNow + 1000L)
        assertNull(ack1.newSnapshot.alertId)
        assertEquals(1001L, ack1.newSnapshot.lastAlertId)

        val res2 = TimerDomainEngine.processEvent(ack1.newSnapshot, TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, timestamp = fixedNow + 30 * 60_000L), baseConfig, fixedNow + 30 * 60_000L)
        assertEquals(1002L, res2.newSnapshot.alertId)
        assertEquals(1002L, res2.newSnapshot.lastAlertId)

        val drink2 = TimerDomainEngine.processEvent(res2.newSnapshot, TimerEvent(type = TimerEventType.DRINK, timerGeneration = 1L, alertId = 1002L, timestamp = fixedNow + 30 * 60_000L + 2000L), baseConfig, fixedNow + 30 * 60_000L + 2000L)
        assertNull(drink2.newSnapshot.alertId)
        assertEquals(1002L, drink2.newSnapshot.lastAlertId)

        val res3 = TimerDomainEngine.processEvent(drink2.newSnapshot, TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, timestamp = fixedNow + 60 * 60_000L), baseConfig, fixedNow + 60 * 60_000L)
        assertEquals(1003L, res3.newSnapshot.alertId)
        assertEquals(1003L, res3.newSnapshot.lastAlertId)

        val staleAck1 = TimerDomainEngine.processEvent(res3.newSnapshot, TimerEvent(type = TimerEventType.ACKNOWLEDGE, timerGeneration = 1L, alertId = 1001L, timestamp = fixedNow + 60 * 60_000L + 1000L), baseConfig, fixedNow + 60 * 60_000L + 1000L)
        assertEquals(res3.newSnapshot, staleAck1.newSnapshot)
        assertTrue(staleAck1.effects.isEmpty())
    }

    @Test
    fun testMissingGenerationIsIgnored() {
        val waiting = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 5L, nextTriggerAt = fixedNow)
        val nullGenEvent = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = null, timestamp = fixedNow)

        val result = TimerDomainEngine.processEvent(waiting, nullGenEvent, baseConfig, fixedNow)

        assertEquals(waiting, result.newSnapshot)
        assertTrue(result.effects.isEmpty())
    }

    @Test
    fun testMissingAlertIdIsIgnored() {
        val alerting = TimerSnapshot(state = TimerState.ALERT_ACTIVE, timerGeneration = 5L, alertId = 200L)
        val nullAlertIdAck = TimerEvent(type = TimerEventType.ACKNOWLEDGE, timerGeneration = 5L, alertId = null, timestamp = fixedNow)

        val result = TimerDomainEngine.processEvent(alerting, nullAlertIdAck, baseConfig, fixedNow)

        assertEquals(alerting, result.newSnapshot)
        assertTrue(result.effects.isEmpty())
    }

    @Test
    fun testWrongGenerationIsIgnored() {
        val waiting = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 10L)
        val wrongGenEvent = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 9L, timestamp = fixedNow)

        val result = TimerDomainEngine.processEvent(waiting, wrongGenEvent, baseConfig, fixedNow)

        assertEquals(waiting, result.newSnapshot)
        assertTrue(result.effects.isEmpty())
    }

    @Test
    fun testWrongAlertIdIsIgnored() {
        val alerting = TimerSnapshot(state = TimerState.ALERT_ACTIVE, timerGeneration = 5L, alertId = 1020L)
        val wrongAck = TimerEvent(type = TimerEventType.ACKNOWLEDGE, timerGeneration = 5L, alertId = 1019L, timestamp = fixedNow)

        val result = TimerDomainEngine.processEvent(alerting, wrongAck, baseConfig, fixedNow)

        assertEquals(alerting, result.newSnapshot)
        assertTrue(result.effects.isEmpty())
    }

    @Test
    fun testAckThenStaleTimeoutRaceIsSafe() {
        val alerting = TimerSnapshot(
            state = TimerState.ALERT_ACTIVE,
            timerGeneration = 6L,
            alertId = 500L,
            lastAlertId = 500L,
            alertStartedAt = fixedNow,
            alertDeadlineAt = fixedNow + 15_000L
        )
        val ackEvent = TimerEvent(type = TimerEventType.ACKNOWLEDGE, timerGeneration = 6L, alertId = 500L, timestamp = fixedNow + 3000L)
        val ackResult = TimerDomainEngine.processEvent(alerting, ackEvent, baseConfig, fixedNow + 3000L)

        assertEquals(TimerState.WAITING, ackResult.newSnapshot.state)
        assertNull(ackResult.newSnapshot.alertId)

        val staleTimeout = TimerEvent(type = TimerEventType.ALERT_TIMEOUT, timerGeneration = 6L, alertId = 500L, timestamp = fixedNow + 15_000L)
        val timeoutResult = TimerDomainEngine.processEvent(ackResult.newSnapshot, staleTimeout, baseConfig, fixedNow + 15_000L)

        assertEquals(ackResult.newSnapshot, timeoutResult.newSnapshot)
        assertTrue(timeoutResult.effects.isEmpty())
    }

    @Test
    fun testDrinkThenStaleTimeoutRaceIsSafe() {
        val alerting = TimerSnapshot(
            state = TimerState.ALERT_ACTIVE,
            timerGeneration = 6L,
            alertId = 500L,
            lastAlertId = 500L,
            alertStartedAt = fixedNow,
            alertDeadlineAt = fixedNow + 15_000L
        )
        val drinkEvent = TimerEvent(type = TimerEventType.DRINK, timerGeneration = 6L, alertId = 500L, timestamp = fixedNow + 2000L)
        val drinkResult = TimerDomainEngine.processEvent(alerting, drinkEvent, baseConfig, fixedNow + 2000L)

        val staleTimeout = TimerEvent(type = TimerEventType.ALERT_TIMEOUT, timerGeneration = 6L, alertId = 500L, timestamp = fixedNow + 15_000L)
        val timeoutResult = TimerDomainEngine.processEvent(drinkResult.newSnapshot, staleTimeout, baseConfig, fixedNow + 15_000L)

        assertEquals(drinkResult.newSnapshot, timeoutResult.newSnapshot)
        assertTrue(timeoutResult.effects.isEmpty())
    }

    @Test
    fun testStopThenStartRaceCreatesNewGenerationAndRejectsOldCallbacks() {
        val sessionA = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 10L, nextTriggerAt = fixedNow + 5000L)

        val stopResult = TimerDomainEngine.processEvent(sessionA, TimerEvent(type = TimerEventType.STOP, timerGeneration = 10L, timestamp = fixedNow), baseConfig, fixedNow)
        assertEquals(TimerState.STOPPED, stopResult.newSnapshot.state)

        val startResult = TimerDomainEngine.processEvent(stopResult.newSnapshot, TimerEvent(type = TimerEventType.START, timestamp = fixedNow + 1000L), baseConfig, fixedNow + 1000L)
        assertEquals(11L, startResult.newSnapshot.timerGeneration)

        // Old trigger generation 10
        val oldTrigger = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 10L, timestamp = fixedNow + 5000L)
        val oldResult = TimerDomainEngine.processEvent(startResult.newSnapshot, oldTrigger, baseConfig, fixedNow + 5000L)

        assertEquals(startResult.newSnapshot, oldResult.newSnapshot)
        assertTrue(oldResult.effects.isEmpty())

        // Old timeout generation 10, alert 100
        val oldTimeout = TimerEvent(type = TimerEventType.ALERT_TIMEOUT, timerGeneration = 10L, alertId = 100L, timestamp = fixedNow + 6000L)
        val oldTimeoutResult = TimerDomainEngine.processEvent(startResult.newSnapshot, oldTimeout, baseConfig, fixedNow + 6000L)

        assertEquals(startResult.newSnapshot, oldTimeoutResult.newSnapshot)
        assertTrue(oldTimeoutResult.effects.isEmpty())
    }

    @Test
    fun testDuplicateAckIsIgnored() {
        val alerting = TimerSnapshot(state = TimerState.ALERT_ACTIVE, timerGeneration = 1L, alertId = 100L, lastAlertId = 100L)
        val ackResult1 = TimerDomainEngine.processEvent(alerting, TimerEvent(type = TimerEventType.ACKNOWLEDGE, timerGeneration = 1L, alertId = 100L, timestamp = fixedNow), baseConfig, fixedNow)

        val ackResult2 = TimerDomainEngine.processEvent(ackResult1.newSnapshot, TimerEvent(type = TimerEventType.ACKNOWLEDGE, timerGeneration = 1L, alertId = 100L, timestamp = fixedNow + 100L), baseConfig, fixedNow + 100L)

        assertEquals(ackResult1.newSnapshot, ackResult2.newSnapshot)
        assertTrue(ackResult2.effects.isEmpty())
    }

    @Test
    fun testDuplicateDrinkIsIgnored() {
        val alerting = TimerSnapshot(state = TimerState.ALERT_ACTIVE, timerGeneration = 1L, alertId = 100L, lastAlertId = 100L)
        val drinkResult1 = TimerDomainEngine.processEvent(alerting, TimerEvent(type = TimerEventType.DRINK, timerGeneration = 1L, alertId = 100L, timestamp = fixedNow), baseConfig, fixedNow)

        val drinkResult2 = TimerDomainEngine.processEvent(drinkResult1.newSnapshot, TimerEvent(type = TimerEventType.DRINK, timerGeneration = 1L, alertId = 100L, timestamp = fixedNow + 100L), baseConfig, fixedNow + 100L)

        assertEquals(drinkResult1.newSnapshot, drinkResult2.newSnapshot)
        assertTrue(drinkResult2.effects.isEmpty())
    }

    @Test
    fun testRecoveryDuringWaitingFutureTrigger() {
        val futureTime = fixedNow + 100_000L
        val waiting = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 2L, nextTriggerAt = futureTime)

        val result = TimerDomainEngine.processEvent(waiting, TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow), baseConfig, fixedNow)

        assertEquals(waiting, result.newSnapshot)
        assertTrue(result.effects.any { it is TimerEffect.ScheduleTimer && it.triggerAtMillis == futureTime })
    }

    @Test
    fun testRecoveryDuringWaitingOverdueTriggerSmallDelay() {
        val pastTime = fixedNow - 10_000L // 10s delay (< 2 * alertDuration = 30s)
        val waiting = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 2L, nextTriggerAt = pastTime)

        val result = TimerDomainEngine.processEvent(waiting, TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow), baseConfig, fixedNow)

        assertEquals(TimerState.ALERT_ACTIVE, result.newSnapshot.state)
        assertEquals(2L, result.newSnapshot.timerGeneration)
        assertNotNull(result.newSnapshot.alertId)
    }

    @Test
    fun testRecoveryDuringWaitingLongDowntimeAdvancesToNextTriggerWithoutStaleAlert() {
        val longPastTime = fixedNow - 3600_000L // 1 hour overdue
        val waiting = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 2L, nextTriggerAt = longPastTime)

        val result = TimerDomainEngine.processEvent(waiting, TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow), baseConfig, fixedNow)

        assertEquals(TimerState.WAITING, result.newSnapshot.state)
        assertEquals(fixedNow + 30 * 60_000L, result.newSnapshot.nextTriggerAt)
        assertTrue(result.effects.any { it is TimerEffect.ScheduleTimer })
    }

    @Test
    fun testRecoveryDuringAlertActiveFutureDeadlineDoesNotGenerateNewAlertId() {
        val alerting = TimerSnapshot(
            state = TimerState.ALERT_ACTIVE,
            timerGeneration = 5L,
            alertId = 777L,
            lastAlertId = 777L,
            alertStartedAt = fixedNow - 5000L,
            alertDeadlineAt = fixedNow + 10_000L
        )

        val result = TimerDomainEngine.processEvent(alerting, TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow), baseConfig, fixedNow)

        assertEquals(TimerState.ALERT_ACTIVE, result.newSnapshot.state)
        assertEquals(777L, result.newSnapshot.alertId)
        assertTrue(result.effects.any { it is TimerEffect.ScheduleAlertTimeout && it.alertId == 777L })
    }

    @Test
    fun testRecoveryDuringAlertActiveExpiredDeadline() {
        val alerting = TimerSnapshot(
            state = TimerState.ALERT_ACTIVE,
            timerGeneration = 5L,
            alertId = 777L,
            lastAlertId = 777L,
            alertStartedAt = fixedNow - 30_000L,
            alertDeadlineAt = fixedNow - 5000L
        )

        val result = TimerDomainEngine.processEvent(alerting, TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow), baseConfig, fixedNow)

        assertEquals(TimerState.WAITING, result.newSnapshot.state)
        assertNull(result.newSnapshot.alertId)
        assertTrue(result.effects.any { it is TimerEffect.RecordMissed })
    }

    @Test
    fun testQuietHoursDefersReminderTrigger() {
        val quietConfig = baseConfig.copy(
            quietHoursEnabled = true,
            quietHoursStart = "23:00",
            quietHoursEnd = "07:00"
        )
        val cal = java.util.Calendar.getInstance().apply {
            timeInMillis = fixedNow
            set(java.util.Calendar.HOUR_OF_DAY, 23)
            set(java.util.Calendar.MINUTE, 30)
            set(java.util.Calendar.SECOND, 0)
            set(java.util.Calendar.MILLISECOND, 0)
        }
        val nightNow = cal.timeInMillis

        val waiting = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 1L, nextTriggerAt = nightNow)
        val result = TimerDomainEngine.processEvent(waiting, TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, timestamp = nightNow), quietConfig, nightNow)

        assertEquals(TimerState.WAITING, result.newSnapshot.state)
        val nextCal = java.util.Calendar.getInstance().apply { timeInMillis = result.newSnapshot.nextTriggerAt!! }
        assertEquals(7, nextCal.get(java.util.Calendar.HOUR_OF_DAY))
        assertEquals(0, nextCal.get(java.util.Calendar.MINUTE))
    }

    @Test
    fun testAlertDurationIsSnapshottedAtTrigger() {
        val config15s = baseConfig.copy(alertDurationSeconds = 15)
        val waiting = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 1L, nextTriggerAt = fixedNow)

        val triggerResult = TimerDomainEngine.processEvent(waiting, TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, timestamp = fixedNow), config15s, fixedNow)

        assertEquals(fixedNow + 15_000L, triggerResult.newSnapshot.alertDeadlineAt)

        val config120s = baseConfig.copy(alertDurationSeconds = 120)

        val ackResult = TimerDomainEngine.processEvent(triggerResult.newSnapshot, TimerEvent(type = TimerEventType.ACKNOWLEDGE, timerGeneration = 1L, alertId = triggerResult.newSnapshot.alertId, timestamp = fixedNow + 5000L), config120s, fixedNow + 5000L)

        assertEquals(TimerState.WAITING, ackResult.newSnapshot.state)
    }
}
