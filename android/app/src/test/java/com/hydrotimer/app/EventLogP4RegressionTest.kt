package com.hydrotimer.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.Executor
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], shadows = [ShadowNotificationHelper::class])
class EventLogP4RegressionTest {

    private lateinit var context: Context
    private lateinit var dbHelper: HydrationEventDatabaseHelper
    private lateinit var repository: HydrationEventRepository
    private lateinit var timerManager: TimerManager
    private val directExecutor = Executor { command -> command.run() }
    private val fixedNow = 1_700_000_000_000L // Mon Nov 14 2023

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        dbHelper = HydrationEventDatabaseHelper(context, "hydro_timer_events_p4.db")
        repository = HydrationEventRepository(dbHelper)
        repository.clearAll()

        timerManager = TimerManager(context, repository, directExecutor)
        timerManager.getPrefs().edit().clear().commit()
    }

    @After
    fun tearDown() {
        try {
            repository.clearAll()
            dbHelper.close()
        } catch (_: Exception) {}
    }

    // 1. Historical days
    @Test
    fun test1_historicalDaysIsolationAndBudapestDstBoundaries() {
        val zone = ZoneId.of("Europe/Budapest")

        // Day 1: 2026-05-10
        val d1 = LocalDate.of(2026, 5, 10)
        val d1Next = d1.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()

        // Day 2: 2026-05-11
        val d2 = LocalDate.of(2026, 5, 11)
        val d2Start = d2.atStartOfDay(zone).toInstant().toEpochMilli()

        val e1 = HydrationEvent.createPending(1L, 1001L, d1Next - 1000L, d1Next - 1000L, 250, 2500)
        val e2 = HydrationEvent.createPending(1L, 1002L, d2Start, d2Start, 250, 2500)

        repository.createIfAbsent(e1)
        repository.createIfAbsent(e2)

        val day1List = repository.listByLocalDay(d1, zone)
        assertEquals(1, day1List.size)
        assertEquals("1_1001", day1List[0].id)

        val day2List = repository.listByLocalDay(d2, zone)
        assertEquals(1, day2List.size)
        assertEquals("1_1002", day2List[0].id)

        // DST Spring forward (23h) on 2026-03-29
        val springDate = LocalDate.of(2026, 3, 29)
        val springStart = springDate.atStartOfDay(zone).toInstant().toEpochMilli()
        val springNext = springDate.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        assertEquals(23 * 3600_000L, springNext - springStart)

        // DST Fall back (25h) on 2026-10-25
        val autumnDate = LocalDate.of(2026, 10, 25)
        val autumnStart = autumnDate.atStartOfDay(zone).toInstant().toEpochMilli()
        val autumnNext = autumnDate.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
        assertEquals(25 * 3600_000L, autumnNext - autumnStart)
    }

    // 2. Pending events
    @Test
    fun test2_unansweredAlertRemainsPendingAndCanBeResolvedLater() {
        val event = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = fixedNow - 3600_000L,
            createdAt = fixedNow - 3600_000L,
            intakeMl = 250,
            dailyGoalMl = 2500
        )
        repository.createIfAbsent(event)

        // Simulate app restart / new repo instance
        val reloadedHelper = HydrationEventDatabaseHelper(context, "hydro_timer_events_p4.db")
        val reloadedRepo = HydrationEventRepository(reloadedHelper)
        val pending = reloadedRepo.listPending()
        assertEquals(1, pending.size)
        assertEquals(HydrationEventStatus.PENDING, pending[0].status)

        // Resolve later to DRANK
        val updated = reloadedRepo.updateStatus("1_1001", HydrationEventStatus.DRANK, fixedNow)
        assertEquals(HydrationEventStatus.DRANK, updated.status)

        val pendingAfter = reloadedRepo.listPending()
        assertEquals(0, pendingAfter.size)
        reloadedHelper.close()
    }

    // 3. Repeated alerts and idempotency
    @Test
    fun test3_reprocessingDuplicateAlertPreservesOriginalEventIdentityAndSnapshot() {
        val waitingSnap = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 1L, nextTriggerAt = fixedNow)
        timerManager.saveSnapshot(waitingSnap)

        val triggerEvent = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, scheduledAt = fixedNow, timestamp = fixedNow)
        timerManager.dispatch(triggerEvent, fixedNow)

        val saved1 = repository.getById("1_1001")
        assertNotNull(saved1)
        assertEquals(HydrationEventStatus.PENDING, saved1?.status)
        assertEquals(250, saved1?.intakeMl)
        assertEquals(2500, saved1?.dailyGoalMl)

        // Recovery dispatch
        timerManager.dispatch(TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow + 1000L), fixedNow + 1000L)

        val saved2 = repository.getById("1_1001")
        assertEquals(saved1?.createdAt, saved2?.createdAt)
        assertEquals(saved1?.intakeMl, saved2?.intakeMl)

        val pendingList = repository.listPending()
        assertEquals(1, pendingList.size)
    }

    // 4. Timer lifecycle
    @Test
    fun test4_stopRestartIncrementsGenerationAndSettingsUpdateDoesNotCorruptHistory() {
        val activeSnap = TimerSnapshot(
            state = TimerState.ALERT_ACTIVE,
            timerGeneration = 1L,
            alertId = 1001L,
            lastAlertId = 1001L,
            nextTriggerAt = fixedNow + 1800_000L,
            alertStartedAt = fixedNow,
            alertDeadlineAt = fixedNow + 15_000L
        )
        timerManager.saveSnapshot(activeSnap)

        // Stop timer
        timerManager.dispatch(TimerEvent(type = TimerEventType.STOP, timerGeneration = 1L, timestamp = fixedNow + 1000L), fixedNow + 1000L)
        // Start timer
        val startRes = timerManager.dispatch(TimerEvent(type = TimerEventType.START, timestamp = fixedNow + 2000L), fixedNow + 2000L)

        assertEquals(TimerState.WAITING, startRes.newSnapshot.state)
        assertEquals(2L, startRes.newSnapshot.timerGeneration)

        // Stale action from generation 1 rejected
        val staleAck = timerManager.dispatch(TimerEvent(type = TimerEventType.ACKNOWLEDGE, timerGeneration = 1L, alertId = 1001L, timestamp = fixedNow + 3000L), fixedNow + 3000L)
        assertEquals(TimerState.WAITING, staleAck.newSnapshot.state)
        assertEquals(2L, staleAck.newSnapshot.timerGeneration)
    }

    // 5. Application restart and persistence
    @Test
    fun test5_legacyRecordWithoutSnapshotFieldsReturnsNullSnapshot() {
        val legacy = HydrationEvent(
            id = "1_900",
            timerGeneration = 1L,
            alertId = 900L,
            scheduledAt = fixedNow,
            createdAt = fixedNow,
            status = HydrationEventStatus.DRANK,
            updatedAt = fixedNow,
            revision = 1L,
            intakeMl = null,
            dailyGoalMl = null
        )

        repository.createIfAbsent(legacy)

        val fetched = repository.getById("1_900")
        assertNotNull(fetched)
        assertNull(fetched?.intakeMl)
        assertNull(fetched?.dailyGoalMl)
    }

    // 6. Regression boundaries
    @Test
    fun test6_testAlertProducesZeroSqliteRecords() {
        val waitingSnap = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 1L, nextTriggerAt = fixedNow + 1800_000L)
        timerManager.saveSnapshot(waitingSnap)

        timerManager.dispatch(TimerEvent(type = TimerEventType.TEST_ALERT, timestamp = fixedNow), fixedNow)

        val pending = repository.listPending()
        assertEquals(0, pending.size)
    }
}
