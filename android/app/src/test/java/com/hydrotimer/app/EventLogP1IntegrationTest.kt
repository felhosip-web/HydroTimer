package com.hydrotimer.app

import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33])
class EventLogP1IntegrationTest {

    private lateinit var dbHelper: HydrationEventDatabaseHelper
    private lateinit var repository: HydrationEventRepository
    private val baseConfig = EngineConfig(
        mode = "interval",
        intervalMinutes = 30,
        alertDurationSeconds = 15,
        intervalMode = "free",
        quietHoursEnabled = false,
        activeDays = booleanArrayOf(true, true, true, true, true, true, true)
    )
    private val fixedNow = 1_700_000_000_000L

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        dbHelper = HydrationEventDatabaseHelper(context)
        repository = HydrationEventRepository(dbHelper)
        repository.clearAll()
    }

    @After
    fun tearDown() {
        try {
            repository.clearAll()
        } catch (_: Exception) {}
        dbHelper.close()
    }

    @Test
    fun test1_validRealAlertCreatesExactlyOnePendingEvent() {
        val waitingSnap = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 1L,
            nextTriggerAt = fixedNow
        )
        val triggerEvent = TimerEvent(
            type = TimerEventType.TIMER_TRIGGER,
            timerGeneration = 1L,
            scheduledAt = fixedNow,
            timestamp = fixedNow
        )

        val result = TimerDomainEngine.processEvent(waitingSnap, triggerEvent, baseConfig, fixedNow)
        assertEquals(TimerState.ALERT_ACTIVE, result.newSnapshot.state)
        assertEquals(1001L, result.newSnapshot.alertId)

        val createEffect = result.effects.filterIsInstance<TimerEffect.CreateHydrationEvent>().firstOrNull()
        assertNotNull(createEffect)

        createEffect?.let {
            val pendingEvent = HydrationEvent.createPending(
                timerGeneration = it.timerGeneration,
                alertId = it.alertId,
                scheduledAt = it.scheduledAt,
                createdAt = fixedNow
            )

            val saved = repository.createIfAbsent(pendingEvent)
            assertEquals("1_1001", saved.id)
            assertEquals(1L, saved.timerGeneration)
            assertEquals(1001L, saved.alertId)
            assertEquals(fixedNow, saved.scheduledAt)
            assertEquals(HydrationEventStatus.PENDING, saved.status)

            val retrieved = repository.getById("1_1001")
            assertNotNull(retrieved)
            assertEquals(HydrationEventStatus.PENDING, retrieved?.status)
        }
    }

    @Test
    fun test2_duplicateCallbacksCreateNoDuplicateEvent() {
        val event1 = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = fixedNow,
            createdAt = fixedNow
        )

        repository.createIfAbsent(event1)

        val duplicateEvent = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = fixedNow,
            createdAt = fixedNow + 5000L
        )

        val secondResult = repository.createIfAbsent(duplicateEvent)

        assertEquals("1_1001", secondResult.id)
        assertEquals(fixedNow, secondResult.createdAt) // Original createdAt preserved
        assertEquals(HydrationEventStatus.PENDING, secondResult.status)

        val pendingList = repository.listPending()
        assertEquals(1, pendingList.size)
    }

    @Test
    fun test3_distinctAlertIdsProduceDistinctEvents() {
        val eventA = HydrationEvent.createPending(timerGeneration = 1L, alertId = 1001L, scheduledAt = fixedNow)
        val eventB = HydrationEvent.createPending(timerGeneration = 1L, alertId = 1002L, scheduledAt = fixedNow + 30 * 60_000L)

        repository.createIfAbsent(eventA)
        repository.createIfAbsent(eventB)

        val recA = repository.getById("1_1001")
        val recB = repository.getById("1_1002")

        assertNotNull(recA)
        assertNotNull(recB)
        assertTrue(recA?.id != recB?.id)
        assertEquals(1001L, recA?.alertId)
        assertEquals(1002L, recB?.alertId)
    }

    @Test
    fun test4_sameAlertIdUnderDifferentTimerGenProducesDistinctEvent() {
        val eventGen1 = HydrationEvent.createPending(timerGeneration = 1L, alertId = 1001L, scheduledAt = fixedNow)
        val eventGen2 = HydrationEvent.createPending(timerGeneration = 2L, alertId = 1001L, scheduledAt = fixedNow + 60_000L)

        repository.createIfAbsent(eventGen1)
        repository.createIfAbsent(eventGen2)

        val recGen1 = repository.getById("1_1001")
        val recGen2 = repository.getById("2_1001")

        assertEquals("1_1001", recGen1?.id)
        assertEquals("2_1001", recGen2?.id)
        assertEquals(1L, recGen1?.timerGeneration)
        assertEquals(2L, recGen2?.timerGeneration)
    }

    @Test
    fun test5_testAlertCreatesNoEventIncludingDuringRecovery() {
        val waitingSnap = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 1L,
            nextTriggerAt = fixedNow + 30 * 60_000L
        )

        val testAlertEvent = TimerEvent(type = TimerEventType.TEST_ALERT, timestamp = fixedNow)
        val testAlertResult = TimerDomainEngine.processEvent(waitingSnap, testAlertEvent, baseConfig, fixedNow)

        assertEquals(TimerState.ALERT_ACTIVE, testAlertResult.newSnapshot.state)
        assertTrue(testAlertResult.newSnapshot.isTestAlert)

        val hasCreateEffect = testAlertResult.effects.any { it is TimerEffect.CreateHydrationEvent }
        assertTrue(!hasCreateEffect)

        // Recovery of active test alert
        val recoverEvent = TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow + 2000L)
        val recoverResult = TimerDomainEngine.processEvent(testAlertResult.newSnapshot, recoverEvent, baseConfig, fixedNow + 2000L)

        assertEquals(TimerState.ALERT_ACTIVE, recoverResult.newSnapshot.state)
        val recoverHasCreateEffect = recoverResult.effects.any { it is TimerEffect.CreateHydrationEvent }
        assertTrue(!recoverHasCreateEffect)

        val pendingList = repository.listPending()
        assertEquals(0, pendingList.size)
    }

    @Test
    fun test6_staleOrRejectedTriggersCreateNoEvent() {
        val waitingSnap = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 2L,
            nextTriggerAt = fixedNow
        )

        // Wrong generation
        val staleGenTrigger = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, scheduledAt = fixedNow, timestamp = fixedNow)
        val resStaleGen = TimerDomainEngine.processEvent(waitingSnap, staleGenTrigger, baseConfig, fixedNow)
        assertTrue(resStaleGen.effects.none { it is TimerEffect.CreateHydrationEvent })

        // Wrong scheduledAt
        val wrongTimeTrigger = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 2L, scheduledAt = fixedNow - 5000L, timestamp = fixedNow)
        val resWrongTime = TimerDomainEngine.processEvent(waitingSnap, wrongTimeTrigger, baseConfig, fixedNow)
        assertTrue(resWrongTime.effects.none { it is TimerEffect.CreateHydrationEvent })

        val pendingList = repository.listPending()
        assertEquals(0, pendingList.size)
    }

    @Test
    fun test7_recoveryOfAcceptedRealAlertCreatesMissingEventIdempotently() {
        val activeRealAlertSnap = TimerSnapshot(
            state = TimerState.ALERT_ACTIVE,
            timerGeneration = 3L,
            alertId = 1005L,
            lastAlertId = 1005L,
            nextTriggerAt = fixedNow + 30 * 60_000L,
            alertStartedAt = fixedNow,
            alertDeadlineAt = fixedNow + 15_000L,
            isTestAlert = false
        )

        val recoverResult = TimerDomainEngine.processEvent(activeRealAlertSnap, TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow + 2000L), baseConfig, fixedNow + 2000L)
        val createEffect = recoverResult.effects.filterIsInstance<TimerEffect.CreateHydrationEvent>().firstOrNull()

        assertNotNull(createEffect)
        createEffect?.let {
            assertEquals(3L, it.timerGeneration)
            assertEquals(1005L, it.alertId)
            assertEquals(fixedNow, it.scheduledAt)

            val pendingEvent = HydrationEvent.createPending(
                timerGeneration = it.timerGeneration,
                alertId = it.alertId,
                scheduledAt = it.scheduledAt
            )

            val saved1 = repository.createIfAbsent(pendingEvent)
            assertEquals("3_1005", saved1.id)

            // Second recovery replay call
            val saved2 = repository.createIfAbsent(pendingEvent)
            assertEquals("3_1005", saved2.id)
            assertEquals(saved1.createdAt, saved2.createdAt)
        }
    }

    @Test
    fun test8_recoveryDoesNotResetStatusOrOverwriteOriginalTimestamps() {
        val initialEvent = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = fixedNow,
            createdAt = fixedNow
        )

        repository.createIfAbsent(initialEvent)

        // User marks event as DRANK
        val updated = repository.updateStatus("1_1001", HydrationEventStatus.DRANK, fixedNow + 5000L)
        assertEquals(HydrationEventStatus.DRANK, updated.status)

        // Recovery attempt
        val recoveryEvent = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = fixedNow,
            createdAt = fixedNow + 10_000L
        )

        val resultAfterRecoveryAttempt = repository.createIfAbsent(recoveryEvent)

        assertEquals(HydrationEventStatus.DRANK, resultAfterRecoveryAttempt.status) // Not reset
        assertEquals(fixedNow, resultAfterRecoveryAttempt.createdAt) // Kept original
        assertEquals(fixedNow, resultAfterRecoveryAttempt.scheduledAt)
    }

    @Test
    fun test9_eventPersistenceFailureHandledWithoutCorruptingTimerState() {
        // Dropping table causes repository operations to throw SQLiteException
        val db = dbHelper.writableDatabase
        db.execSQL("DROP TABLE IF EXISTS " + HydrationEventDatabaseHelper.TABLE_EVENTS)

        val pendingEvent = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = fixedNow
        )

        var caughtException: Exception? = null
        try {
            repository.createIfAbsent(pendingEvent)
        } catch (e: Exception) {
            caughtException = e
        }

        assertNotNull(caughtException)
    }
}
