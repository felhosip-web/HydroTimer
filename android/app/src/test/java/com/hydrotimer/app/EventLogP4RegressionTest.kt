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
        // Explicitly disable quiet hours to ensure trigger determinism regardless of cleared pref defaults
        timerManager.setQuietHoursEnabled(false)
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

        // Close dbHelper and reopen database
        dbHelper.close()

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
    fun test3_duplicateTimerTriggerDispatchCreatesSingleRecordAndPreservesSnapshot() {
        val waitingSnap = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 1L, nextTriggerAt = fixedNow)
        timerManager.saveSnapshot(waitingSnap)

        val triggerEvent1 = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, scheduledAt = fixedNow, timestamp = fixedNow)
        timerManager.dispatch(triggerEvent1, fixedNow)

        val saved1 = repository.getById("1_1001")
        assertNotNull(saved1)
        val originalCreatedAt = saved1?.createdAt
        assertEquals(HydrationEventStatus.PENDING, saved1?.status)
        assertEquals(250, saved1?.intakeMl)
        assertEquals(2500, saved1?.dailyGoalMl)

        // Duplicate TIMER_TRIGGER dispatch for same alert / generation
        val triggerEvent2 = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, scheduledAt = fixedNow, timestamp = fixedNow + 500L)
        timerManager.dispatch(triggerEvent2, fixedNow + 500L)

        // Assert exactly 1 record exists, ID & createdAt unchanged, snapshot preserved
        val pendingList = repository.listPending()
        assertEquals(1, pendingList.size)

        val saved2 = repository.getById("1_1001")
        assertEquals("1_1001", saved2?.id)
        assertEquals(originalCreatedAt, saved2?.createdAt)
        assertEquals(HydrationEventStatus.PENDING, saved2?.status)
        assertEquals(250, saved2?.intakeMl)
        assertEquals(2500, saved2?.dailyGoalMl)

        // Recovery dispatch
        timerManager.dispatch(TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow + 1000L), fixedNow + 1000L)

        val saved3 = repository.getById("1_1001")
        assertEquals(originalCreatedAt, saved3?.createdAt)
        assertEquals(250, saved3?.intakeMl)
    }

    @Test
    fun test3b_directRepositoryCreateIfAbsentIgnoresDuplicateAndPreservesOriginalSnapshot() {
        val originalEvent = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = fixedNow,
            createdAt = fixedNow,
            intakeMl = 250,
            dailyGoalMl = 2500
        )
        val createdFirst = repository.createIfAbsent(originalEvent)
        assertEquals("1_1001", createdFirst.id)
        assertEquals(fixedNow, createdFirst.createdAt)
        assertEquals(250, createdFirst.intakeMl)
        assertEquals(2500, createdFirst.dailyGoalMl)

        // Attempt duplicate createIfAbsent call with same stable ID but deliberately different createdAt, intakeMl, dailyGoalMl
        val duplicateEvent = HydrationEvent(
            id = "1_1001",
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = fixedNow,
            createdAt = fixedNow + 99999L,
            status = HydrationEventStatus.PENDING,
            updatedAt = fixedNow + 99999L,
            revision = 1L,
            intakeMl = 999,
            dailyGoalMl = 9999
        )
        val resultSecond = repository.createIfAbsent(duplicateEvent)

        // Assert that the returned and stored record retains original ID, createdAt, status, intakeMl, dailyGoalMl
        assertEquals("1_1001", resultSecond.id)
        assertEquals(fixedNow, resultSecond.createdAt)
        assertEquals(HydrationEventStatus.PENDING, resultSecond.status)
        assertEquals(250, resultSecond.intakeMl)
        assertEquals(2500, resultSecond.dailyGoalMl)

        val fetched = repository.getById("1_1001")
        assertEquals(fixedNow, fetched?.createdAt)
        assertEquals(250, fetched?.intakeMl)
        assertEquals(2500, fetched?.dailyGoalMl)
    }

    // 4. Timer lifecycle
    @Test
    fun test4_stopRestartIncrementsGenerationAndRejectsStaleActions() {
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

    @Test
    fun test4b_changingTimerSettingsBeforeFutureAlertAffectsFutureAlertSnapshotNotExistingRecord() {
        val waitingSnap = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 1L, nextTriggerAt = fixedNow)
        timerManager.saveSnapshot(waitingSnap)

        // Alert 1 triggered with default config (250ml intake, 2500ml daily goal)
        val trigger1 = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, scheduledAt = fixedNow, timestamp = fixedNow)
        timerManager.dispatch(trigger1, fixedNow)

        // User acknowledges alert 1
        val ack1 = TimerEvent(type = TimerEventType.ACKNOWLEDGE, timerGeneration = 1L, alertId = 1001L, timestamp = fixedNow + 5000L)
        val ackRes = timerManager.dispatch(ack1, fixedNow + 5000L)

        // User updates settings via TimerManager to 500ml intake and 4000ml daily goal
        timerManager.setIntakePerAlertMl(500)
        timerManager.setDailyTargetMl(4000)

        // Alert 2 triggered
        val nextTriggerAt = ackRes.newSnapshot.nextTriggerAt!!
        val trigger2 = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, scheduledAt = nextTriggerAt, timestamp = nextTriggerAt)
        timerManager.dispatch(trigger2, nextTriggerAt)

        // Verify earlier event retained original snapshot, later event captured new config
        val record1 = repository.getById("1_1001")
        val record2 = repository.getById("1_1002")

        assertNotNull(record1)
        assertNotNull(record2)
        assertEquals(250, record1?.intakeMl)
        assertEquals(2500, record1?.dailyGoalMl)

        assertEquals(500, record2?.intakeMl)
        assertEquals(4000, record2?.dailyGoalMl)

        // Verify recovery does not overwrite either snapshot
        timerManager.dispatch(TimerEvent(type = TimerEventType.RECOVER, timestamp = nextTriggerAt + 1000L), nextTriggerAt + 1000L)

        val record1AfterRecover = repository.getById("1_1001")
        val record2AfterRecover = repository.getById("1_1002")

        assertEquals(250, record1AfterRecover?.intakeMl)
        assertEquals(2500, record1AfterRecover?.dailyGoalMl)
        assertEquals(500, record2AfterRecover?.intakeMl)
        assertEquals(4000, record2AfterRecover?.dailyGoalMl)
    }

    // 5. Application restart and persistence
    @Test
    fun test5_realPersistenceAcrossDatabaseCloseAndReopen() {
        val event = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = fixedNow,
            createdAt = fixedNow,
            intakeMl = 300,
            dailyGoalMl = 3000
        )
        repository.createIfAbsent(event)
        repository.updateStatus("1_1001", HydrationEventStatus.DRANK, fixedNow + 1000L)

        // Explicitly close database helper
        dbHelper.close()

        // Reopen database with same name
        val reopenedHelper = HydrationEventDatabaseHelper(context, "hydro_timer_events_p4.db")
        val reopenedRepo = HydrationEventRepository(reopenedHelper)

        val retrieved = reopenedRepo.getById("1_1001")
        assertNotNull(retrieved)
        assertEquals("1_1001", retrieved?.id)
        assertEquals(HydrationEventStatus.DRANK, retrieved?.status)
        assertEquals(fixedNow, retrieved?.scheduledAt)
        assertEquals(fixedNow, retrieved?.createdAt)
        assertEquals(fixedNow + 1000L, retrieved?.updatedAt)
        assertEquals(300, retrieved?.intakeMl)
        assertEquals(3000, retrieved?.dailyGoalMl)

        reopenedHelper.close()
    }

    @Test
    fun test5b_activeAlertRecoveryAfterDatabaseReopenPreservesSnapshotWithoutDuplicates() {
        val waitingSnap = TimerSnapshot(state = TimerState.WAITING, timerGeneration = 1L, nextTriggerAt = fixedNow)
        timerManager.saveSnapshot(waitingSnap)

        // Alert triggered
        val trigger = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, scheduledAt = fixedNow, timestamp = fixedNow)
        timerManager.dispatch(trigger, fixedNow)

        // Close db connection
        dbHelper.close()

        // Simulate app restart / reopen DB while alert is active
        val reopenedHelper = HydrationEventDatabaseHelper(context, "hydro_timer_events_p4.db")
        val reopenedRepo = HydrationEventRepository(reopenedHelper)
        val reopenedManager = TimerManager(context, reopenedRepo, directExecutor)
        reopenedManager.setQuietHoursEnabled(false)

        // Recover active alert
        reopenedManager.dispatch(TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow + 2000L), fixedNow + 2000L)

        val pending = reopenedRepo.listPending()
        assertEquals(1, pending.size)

        val record = reopenedRepo.getById("1_1001")
        assertEquals(250, record?.intakeMl)
        assertEquals(2500, record?.dailyGoalMl)

        reopenedHelper.close()
    }

    @Test
    fun test5c_legacyRecordWithoutSnapshotFieldsReturnsNullSnapshot() {
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
        dbHelper.close()

        val reopenedHelper = HydrationEventDatabaseHelper(context, "hydro_timer_events_p4.db")
        val reopenedRepo = HydrationEventRepository(reopenedHelper)

        val fetched = reopenedRepo.getById("1_900")
        assertNotNull(fetched)
        assertNull(fetched?.intakeMl)
        assertNull(fetched?.dailyGoalMl)

        reopenedHelper.close()
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
