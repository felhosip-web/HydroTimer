package com.hydrotimer.app

import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.Executor
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], packageName = "com.hydrotimer.app")
class EventLogP1IntegrationTest {

    private lateinit var dbHelper: HydrationEventDatabaseHelper
    private lateinit var repository: HydrationEventRepository
    private lateinit var timerManager: TimerManager
    private val directExecutor = Executor { command -> command.run() }
    private val fixedNow = 1_700_000_000_000L

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        dbHelper = HydrationEventDatabaseHelper(context)
        repository = HydrationEventRepository(dbHelper)
        repository.clearAll()

        timerManager = TimerManager(context, repository, directExecutor)
        timerManager.getPrefs().edit().clear().commit()
    }

    @After
    fun tearDown() {
        try {
            repository.clearAll()
        } catch (_: Exception) {}
        dbHelper.close()
    }

    @Test
    fun test1_realAlertViaTimerManagerBoundaryCreatesPendingEvent() {
        val waitingSnap = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 1L,
            nextTriggerAt = fixedNow
        )
        timerManager.saveSnapshot(waitingSnap)

        val triggerEvent = TimerEvent(
            type = TimerEventType.TIMER_TRIGGER,
            timerGeneration = 1L,
            scheduledAt = fixedNow,
            timestamp = fixedNow
        )

        val result = timerManager.dispatch(triggerEvent, fixedNow)

        assertEquals(TimerState.ALERT_ACTIVE, result.newSnapshot.state)
        assertEquals(1001L, result.newSnapshot.alertId)

        val saved = repository.getById("1_1001")
        assertNotNull(saved)
        assertEquals("1_1001", saved?.id)
        assertEquals(1L, saved?.timerGeneration)
        assertEquals(1001L, saved?.alertId)
        assertEquals(fixedNow, saved?.scheduledAt)
        assertEquals(HydrationEventStatus.PENDING, saved?.status)
    }

    @Test
    fun test2_testAlertViaTimerManagerBoundaryCreatesNoEvent() {
        val waitingSnap = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 1L,
            nextTriggerAt = fixedNow + 30 * 60_000L
        )
        timerManager.saveSnapshot(waitingSnap)

        val result = timerManager.dispatch(TimerEvent(type = TimerEventType.TEST_ALERT, timestamp = fixedNow), fixedNow)

        assertEquals(TimerState.ALERT_ACTIVE, result.newSnapshot.state)
        assertTrue(result.newSnapshot.isTestAlert)

        val pendingList = repository.listPending()
        assertEquals(0, pendingList.size)
    }

    @Test
    fun test3_recoveryViaTimerManagerBoundaryRecoversAcceptedRealAlertIdempotently() {
        val activeRealAlertSnap = TimerSnapshot(
            state = TimerState.ALERT_ACTIVE,
            timerGeneration = 3L,
            alertId = 1005L,
            lastAlertId = 1005L,
            nextTriggerAt = fixedNow + 30 * 60_000L,
            alertStartedAt = fixedNow,
            alertDeadlineAt = fixedNow + 15_000L,
            alertScheduledAt = fixedNow,
            isTestAlert = false
        )
        timerManager.saveSnapshot(activeRealAlertSnap)

        val recoverResult1 = timerManager.dispatch(TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow + 2000L), fixedNow + 2000L)
        assertEquals(TimerState.ALERT_ACTIVE, recoverResult1.newSnapshot.state)

        val saved1 = repository.getById("3_1005")
        assertNotNull(saved1)
        assertEquals(HydrationEventStatus.PENDING, saved1?.status)

        // Second recovery call
        val recoverResult2 = timerManager.dispatch(TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow + 4000L), fixedNow + 4000L)
        assertEquals(TimerState.ALERT_ACTIVE, recoverResult2.newSnapshot.state)

        val saved2 = repository.getById("3_1005")
        assertEquals(saved1?.createdAt, saved2?.createdAt)

        val pendingList = repository.listPending()
        assertEquals(1, pendingList.size)
    }

    @Test
    fun test4_recoveryViaTimerManagerBoundaryPreservesExistingStatusAndTimestamps() {
        val initialEvent = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = fixedNow,
            createdAt = fixedNow
        )
        repository.createIfAbsent(initialEvent)
        repository.updateStatus("1_1001", HydrationEventStatus.DRANK, fixedNow + 5000L)

        val activeSnap = TimerSnapshot(
            state = TimerState.ALERT_ACTIVE,
            timerGeneration = 1L,
            alertId = 1001L,
            lastAlertId = 1001L,
            nextTriggerAt = fixedNow + 30 * 60_000L,
            alertStartedAt = fixedNow,
            alertDeadlineAt = fixedNow + 15_000L,
            alertScheduledAt = fixedNow,
            isTestAlert = false
        )
        timerManager.saveSnapshot(activeSnap)

        timerManager.dispatch(TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow + 6000L), fixedNow + 6000L)

        val finalEvent = repository.getById("1_1001")
        assertEquals(HydrationEventStatus.DRANK, finalEvent?.status) // Not reset
        assertEquals(fixedNow, finalEvent?.createdAt)
        assertEquals(fixedNow, finalEvent?.scheduledAt)
    }

    @Test
    fun test5_recoveryViaTimerManagerBoundaryOfTestAlertCreatesNoEvent() {
        val testAlertSnap = TimerSnapshot(
            state = TimerState.ALERT_ACTIVE,
            timerGeneration = 1L,
            alertId = 1001L,
            lastAlertId = 1001L,
            nextTriggerAt = fixedNow + 30 * 60_000L,
            alertStartedAt = fixedNow,
            alertDeadlineAt = fixedNow + 15_000L,
            alertScheduledAt = null,
            isTestAlert = true
        )
        timerManager.saveSnapshot(testAlertSnap)

        timerManager.dispatch(TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow + 2000L), fixedNow + 2000L)

        val pendingList = repository.listPending()
        assertEquals(0, pendingList.size)
    }

    @Test
    fun test6_repositoryFailureAtTimerManagerBoundaryHandledWithoutCrashingOrCorruptingState() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val failingRepo = object : HydrationEventRepository(HydrationEventDatabaseHelper(context)) {
            override fun createIfAbsent(event: HydrationEvent): HydrationEvent {
                throw IllegalStateException("Database connection broken")
            }
        }

        val timerManagerWithFailingRepo = TimerManager(context, failingRepo, directExecutor)
        val waitingSnap = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 1L,
            nextTriggerAt = fixedNow
        )
        timerManagerWithFailingRepo.saveSnapshot(waitingSnap)

        val triggerEvent = TimerEvent(
            type = TimerEventType.TIMER_TRIGGER,
            timerGeneration = 1L,
            scheduledAt = fixedNow,
            timestamp = fixedNow
        )

        val result = timerManagerWithFailingRepo.dispatch(triggerEvent, fixedNow)
        assertEquals(TimerState.ALERT_ACTIVE, result.newSnapshot.state)
        assertEquals(1001L, result.newSnapshot.alertId)
    }

    @Test
    fun test7_delayedTriggerPreservesAuthoritativeScheduledAtDuringCreationAndRecovery() {
        val scheduledTime = fixedNow
        val delayedActivationTime = fixedNow + 5000L // 5 seconds delayed

        val waitingSnap = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 1L,
            nextTriggerAt = scheduledTime
        )
        timerManager.saveSnapshot(waitingSnap)

        val triggerEvent = TimerEvent(
            type = TimerEventType.TIMER_TRIGGER,
            timerGeneration = 1L,
            scheduledAt = scheduledTime,
            timestamp = delayedActivationTime
        )

        val result = timerManager.dispatch(triggerEvent, delayedActivationTime)
        assertEquals(delayedActivationTime, result.newSnapshot.alertStartedAt)
        assertEquals(scheduledTime, result.newSnapshot.alertScheduledAt)

        val saved = repository.getById("1_1001")
        assertEquals(scheduledTime, saved?.scheduledAt) // Preserves original scheduled time, not delayed activation time

        // Clear repo and simulate recovery of missing event
        repository.clearAll()

        timerManager.dispatch(TimerEvent(type = TimerEventType.RECOVER, timestamp = delayedActivationTime + 2000L), delayedActivationTime + 2000L)

        val recovered = repository.getById("1_1001")
        assertEquals(scheduledTime, recovered?.scheduledAt)
    }

    @Test
    fun test8_legacyActiveAlertSnapshotWithoutAlertScheduledAtSkipsEventCreation() {
        val legacySnap = TimerSnapshot(
            state = TimerState.ALERT_ACTIVE,
            timerGeneration = 1L,
            alertId = 1001L,
            lastAlertId = 1001L,
            nextTriggerAt = fixedNow + 30 * 60_000L,
            alertStartedAt = fixedNow,
            alertDeadlineAt = fixedNow + 15_000L,
            alertScheduledAt = null,
            isTestAlert = false
        )
        timerManager.saveSnapshot(legacySnap)

        timerManager.dispatch(TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow + 2000L), fixedNow + 2000L)

        val pendingList = repository.listPending()
        assertEquals(0, pendingList.size) // Legacy snapshot safely skips recreation without fake data fabrication
    }
}
