package com.hydrotimer.app

import androidx.test.core.app.ApplicationProvider
import java.util.concurrent.Executor
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
@Config(sdk = [33], shadows = [ShadowNotificationHelper::class])
class EventLogP3Test {

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
    fun test1_realAlertCapturesIntakeMlAndDailyGoalMl() {
        timerManager.setIntakePerAlertMl(350)
        timerManager.setDailyTargetMl(3500)

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

        assertEquals(350, result.newSnapshot.intakeMl)
        assertEquals(3500, result.newSnapshot.dailyGoalMl)

        val event = repository.getById("1_1001")
        assertNotNull(event)
        assertEquals(350, event?.intakeMl)
        assertEquals(3500, event?.dailyGoalMl)
    }

    @Test
    fun test2_changingSettingsDoesNotMutateAlreadyTriggeredAlert() {
        timerManager.setIntakePerAlertMl(250)
        timerManager.setDailyTargetMl(2500)

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

        val firstResult = timerManager.dispatch(triggerEvent, fixedNow)

        // User changes configuration while alert is active
        timerManager.setIntakePerAlertMl(500)
        timerManager.setDailyTargetMl(4000)

        // Existing active snapshot retains original values
        val activeSnap = timerManager.getSnapshot()
        assertEquals(250, activeSnap.intakeMl)
        assertEquals(2500, activeSnap.dailyGoalMl)

        val activeEvent = repository.getById("1_1001")
        assertEquals(250, activeEvent?.intakeMl)
        assertEquals(2500, activeEvent?.dailyGoalMl)

        // Acknowledge and advance to next trigger
        timerManager.dispatch(TimerEvent(type = TimerEventType.ACKNOWLEDGE, timerGeneration = 1L, alertId = 1001L, timestamp = fixedNow + 1000L), fixedNow + 1000L)

        val nextTriggerAt = timerManager.getSnapshot().nextTriggerAt!!
        val secondResult = timerManager.dispatch(
            TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, scheduledAt = nextTriggerAt, timestamp = nextTriggerAt),
            nextTriggerAt
        )

        assertEquals(500, secondResult.newSnapshot.intakeMl)
        assertEquals(4000, secondResult.newSnapshot.dailyGoalMl)

        val secondEvent = repository.getById("1_1002")
        assertEquals(500, secondEvent?.intakeMl)
        assertEquals(4000, secondEvent?.dailyGoalMl)
    }

    @Test
    fun test3_recoveryDoesNotOverwriteSnapshotValuesOrDuplicateEvents() {
        timerManager.setIntakePerAlertMl(300)
        timerManager.setDailyTargetMl(3000)

        val waitingSnap = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 1L,
            nextTriggerAt = fixedNow
        )
        timerManager.saveSnapshot(waitingSnap)

        timerManager.dispatch(TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, scheduledAt = fixedNow, timestamp = fixedNow), fixedNow)

        // Recover while active
        timerManager.dispatch(TimerEvent(type = TimerEventType.RECOVER, timestamp = fixedNow + 1000L), fixedNow + 1000L)

        val event = repository.getById("1_1001")
        assertNotNull(event)
        assertEquals(300, event?.intakeMl)
        assertEquals(3000, event?.dailyGoalMl)

        val allEvents = repository.listPending()
        assertEquals(1, allEvents.size)
    }

    @Test
    fun test4_testAlertCreatesNoHydrationEvent() {
        timerManager.setIntakePerAlertMl(300)
        timerManager.setDailyTargetMl(3000)

        val waitingSnap = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 1L,
            nextTriggerAt = fixedNow + 100000L
        )
        timerManager.saveSnapshot(waitingSnap)

        val result = timerManager.dispatch(TimerEvent(type = TimerEventType.TEST_ALERT, timestamp = fixedNow), fixedNow)
        assertTrue(result.newSnapshot.isTestAlert)

        val pending = repository.listPending()
        assertEquals(0, pending.size)
    }

    @Test
    fun test5_legacyEventsWithoutSnapshotFieldsAreReadableWithoutFabricatedValues() {
        val db = dbHelper.writableDatabase
        db.execSQL(
            """
            INSERT INTO hydration_events (id, timer_generation, alert_id, scheduled_at, created_at, status, updated_at, revision)
            VALUES ('1_999', 1, 999, $fixedNow, $fixedNow, 'PENDING', $fixedNow, 1)
            """.trimIndent()
        )

        val legacyEvent = repository.getById("1_999")
        assertNotNull(legacyEvent)
        assertNull(legacyEvent?.intakeMl)
        assertNull(legacyEvent?.dailyGoalMl)
    }

    @Test
    fun test6_sqliteMigrationPreservesLegacyEventsAndSupportsNewColumns() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        context.deleteDatabase(HydrationEventDatabaseHelper.DATABASE_NAME)

        val oldDb = context.openOrCreateDatabase(HydrationEventDatabaseHelper.DATABASE_NAME, android.content.Context.MODE_PRIVATE, null)
        oldDb.execSQL(
            """
            CREATE TABLE hydration_events (
                id TEXT PRIMARY KEY,
                timer_generation INTEGER NOT NULL,
                alert_id INTEGER NOT NULL,
                scheduled_at INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                status TEXT NOT NULL,
                updated_at INTEGER NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1
            )
            """.trimIndent()
        )
        oldDb.execSQL("INSERT INTO hydration_events VALUES ('1_888', 1, 888, $fixedNow, $fixedNow, 'DRANK', $fixedNow, 1)")
        oldDb.version = 1
        oldDb.close()

        val newHelper = HydrationEventDatabaseHelper(context)
        val migratedRepo = HydrationEventRepository(newHelper)

        val legacy = migratedRepo.getById("1_888")
        assertNotNull(legacy)
        assertEquals(HydrationEventStatus.DRANK, legacy?.status)
        assertNull(legacy?.intakeMl)
        assertNull(legacy?.dailyGoalMl)

        val newEvent = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 889L,
            scheduledAt = fixedNow,
            intakeMl = 400,
            dailyGoalMl = 4000
        )
        migratedRepo.createIfAbsent(newEvent)

        val retrievedNew = migratedRepo.getById("1_889")
        assertEquals(400, retrievedNew?.intakeMl)
        assertEquals(4000, retrievedNew?.dailyGoalMl)

        newHelper.close()
    }

    @Test
    fun test7_drinkActionUsesCapturedSnapshotIntakeMl() {
        timerManager.setIntakePerAlertMl(300)
        timerManager.setDailyTargetMl(3000)

        val waitingSnap = TimerSnapshot(
            state = TimerState.WAITING,
            timerGeneration = 1L,
            nextTriggerAt = fixedNow
        )
        timerManager.saveSnapshot(waitingSnap)

        val triggerEvent = TimerEvent(type = TimerEventType.TIMER_TRIGGER, timerGeneration = 1L, scheduledAt = fixedNow, timestamp = fixedNow)
        val activeSnap = timerManager.dispatch(triggerEvent, fixedNow).newSnapshot

        // User updates config to 600ml while alert is active
        timerManager.setIntakePerAlertMl(600)

        val drinkEvent = TimerEvent(type = TimerEventType.DRINK, timerGeneration = 1L, alertId = 1001L, timestamp = fixedNow + 1000L)
        val drinkResult = timerManager.dispatch(drinkEvent, fixedNow + 1000L)

        val recordDrinkEffect = drinkResult.effects.filterIsInstance<TimerEffect.RecordDrink>().firstOrNull()
        assertNotNull(recordDrinkEffect)
        assertEquals(300, recordDrinkEffect?.amountMl) // Uses captured 300ml, NOT updated 600ml
    }

    @Test
    fun test8_zeroValueSnapshotPreservationInTimerManager() {
        val zeroSnap = TimerSnapshot(
            state = TimerState.ALERT_ACTIVE,
            timerGeneration = 1L,
            alertId = 1001L,
            intakeMl = 0,
            dailyGoalMl = 2500
        )

        timerManager.saveSnapshot(zeroSnap)
        val restored = timerManager.getSnapshot()

        assertNotNull(restored.intakeMl)
        assertEquals(0, restored.intakeMl)
        assertEquals(2500, restored.dailyGoalMl)
    }
}
