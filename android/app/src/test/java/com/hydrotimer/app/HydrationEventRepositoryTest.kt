package com.hydrotimer.app

import android.content.ContentValues
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class HydrationEventRepositoryTest {

    private lateinit var context: Context
    private lateinit var dbHelper: HydrationEventDatabaseHelper
    private lateinit var repository: HydrationEventRepository
    private lateinit var dbName: String

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        dbName = "test_events_${System.currentTimeMillis()}_${(1000..9999).random()}.db"
        dbHelper = HydrationEventDatabaseHelper(context, dbName)
        repository = HydrationEventRepository(dbHelper)
    }

    @After
    fun tearDown() {
        try {
            repository.clearAll()
            dbHelper.close()
        } catch (e: Exception) {
            // Ignore teardown cleanup errors
        }
    }

    @Test
    fun testValidCreationOfPendingEvent() {
        val scheduledAt = 1710000000000L
        val createdAt = 1710000000000L
        val event = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = scheduledAt,
            createdAt = createdAt
        )

        val created = repository.createIfAbsent(event)

        assertEquals("1_1001", created.id)
        assertEquals(1L, created.timerGeneration)
        assertEquals(1001L, created.alertId)
        assertEquals(scheduledAt, created.scheduledAt)
        assertEquals(createdAt, created.createdAt)
        assertEquals(HydrationEventStatus.PENDING, created.status)
        assertEquals(createdAt, created.updatedAt)
        assertEquals(1L, created.revision)

        val fetched = repository.getById("1_1001")
        assertNotNull(fetched)
        assertEquals(HydrationEventStatus.PENDING, fetched?.status)
    }

    @Test
    fun testDuplicateCreationOfSameEventIsIdempotent() {
        val event1 = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = 1710000000000L,
            createdAt = 1710000000000L
        )

        repository.createIfAbsent(event1)
        repository.updateStatus("1_1001", HydrationEventStatus.DRANK, 1710000005000L)

        // Duplicate insert attempt with same (gen=1, alert=1001) but different scheduledAt
        val duplicateEvent = HydrationEvent.createPending(
            timerGeneration = 1L,
            alertId = 1001L,
            scheduledAt = 1710000999999L,
            createdAt = 1710000000000L
        )

        val result = repository.createIfAbsent(duplicateEvent)

        assertEquals("1_1001", result.id)
        assertEquals(HydrationEventStatus.DRANK, result.status)

        val pending = repository.listPending()
        assertTrue(pending.isEmpty())
    }

    @Test
    fun testDistinctEventsForDistinctTriggerIdentities() {
        val e1 = HydrationEvent.createPending(1L, 1001L, 1710000000000L)
        val e2 = HydrationEvent.createPending(1L, 1002L, 1710003600000L)
        val e3 = HydrationEvent.createPending(2L, 1001L, 1710007200000L)

        repository.createIfAbsent(e1)
        repository.createIfAbsent(e2)
        repository.createIfAbsent(e3)

        assertNotNull(repository.getById("1_1001"))
        assertNotNull(repository.getById("1_1002"))
        assertNotNull(repository.getById("2_1001"))

        val pendingList = repository.listPending()
        assertEquals(3, pendingList.size)
    }

    @Test
    fun testStatusUpdatesAndUpdatedAtHandling() {
        val event = HydrationEvent.createPending(1L, 1001L, 1710000000000L, 1710000000000L)
        repository.createIfAbsent(event)

        val updatedDrank = repository.updateStatus("1_1001", HydrationEventStatus.DRANK, 1710000010000L)
        assertEquals(HydrationEventStatus.DRANK, updatedDrank.status)
        assertEquals(1710000010000L, updatedDrank.updatedAt)
        assertEquals(2L, updatedDrank.revision)

        val updatedNotDrank = repository.updateStatus("1_1001", HydrationEventStatus.NOT_DRANK, 1710000020000L)
        assertEquals(HydrationEventStatus.NOT_DRANK, updatedNotDrank.status)
        assertEquals(1710000020000L, updatedNotDrank.updatedAt)
        assertEquals(3L, updatedNotDrank.revision)

        val updatedRejected = repository.updateStatus("1_1001", HydrationEventStatus.REJECTED, 1710000030000L)
        assertEquals(HydrationEventStatus.REJECTED, updatedRejected.status)
        assertEquals(1710000030000L, updatedRejected.updatedAt)
        assertEquals(4L, updatedRejected.revision)
    }

    @Test
    fun testPendingEventQueriesReturnOnlyPendingStatusEvents() {
        repository.createIfAbsent(HydrationEvent.createPending(1L, 1001L, 1000L))
        repository.createIfAbsent(HydrationEvent.createPending(1L, 1002L, 2000L))
        repository.createIfAbsent(HydrationEvent.createPending(1L, 1003L, 3000L))

        repository.updateStatus("1_1002", HydrationEventStatus.DRANK, 2500L)

        val pending = repository.listPending()
        assertEquals(2, pending.size)
        val ids = pending.map { it.id }
        assertTrue(ids.contains("1_1001"))
        assertTrue(ids.contains("1_1003"))
        assertFalse(ids.contains("1_1002"))
    }

    @Test
    fun testDeterministicDstTransitionsEuropeBudapest() {
        val budapestZone = ZoneId.of("Europe/Budapest")

        // 1. Spring forward transition: 2025-03-30 (clocks move forward 1h at 02:00 -> 03:00)
        val springDate = LocalDate.of(2025, 3, 30)
        val springStart = springDate.atStartOfDay(budapestZone).toInstant().toEpochMilli()
        val springNextDayStart = springDate.plusDays(1).atStartOfDay(budapestZone).toInstant().toEpochMilli()
        val springDayDurationMs = springNextDayStart - springStart

        // 23 hours in milliseconds = 23 * 3600 * 1000 = 82,800,000 ms
        assertEquals(23 * 3600 * 1000L, springDayDurationMs)

        // Verify boundary behavior on spring transition day: [springStart, springNextDayStart)
        val springBefore = HydrationEvent.createPending(1L, 1L, springStart - 1L)
        val springAtStart = HydrationEvent.createPending(1L, 2L, springStart)
        val springMidDay = HydrationEvent.createPending(1L, 3L, springStart + 12 * 3600 * 1000L)
        val springAtEnd = HydrationEvent.createPending(1L, 4L, springNextDayStart - 1L)
        val springAtNextStart = HydrationEvent.createPending(1L, 5L, springNextDayStart)

        repository.createIfAbsent(springBefore)
        repository.createIfAbsent(springAtStart)
        repository.createIfAbsent(springMidDay)
        repository.createIfAbsent(springAtEnd)
        repository.createIfAbsent(springAtNextStart)

        val springDayEvents = repository.listByLocalDay(springDate, budapestZone)
        assertEquals(3, springDayEvents.size)
        val springIds = springDayEvents.map { it.id }
        assertTrue(springIds.contains("1_2"))
        assertTrue(springIds.contains("1_3"))
        assertTrue(springIds.contains("1_4"))
        assertFalse(springIds.contains("1_1"))
        assertFalse(springIds.contains("1_5"))

        repository.clearAll()

        // 2. Autumn fall back transition: 2025-10-26 (clocks move back 1h at 03:00 -> 02:00)
        val autumnDate = LocalDate.of(2025, 10, 26)
        val autumnStart = autumnDate.atStartOfDay(budapestZone).toInstant().toEpochMilli()
        val autumnNextDayStart = autumnDate.plusDays(1).atStartOfDay(budapestZone).toInstant().toEpochMilli()
        val autumnDayDurationMs = autumnNextDayStart - autumnStart

        // 25 hours in milliseconds = 25 * 3600 * 1000 = 90,000,000 ms
        assertEquals(25 * 3600 * 1000L, autumnDayDurationMs)

        // Verify boundary behavior on autumn transition day: [autumnStart, autumnNextDayStart)
        val autumnBefore = HydrationEvent.createPending(2L, 1L, autumnStart - 1L)
        val autumnAtStart = HydrationEvent.createPending(2L, 2L, autumnStart)
        val autumnMidDay = HydrationEvent.createPending(2L, 3L, autumnStart + 12 * 3600 * 1000L)
        val autumnAtEnd = HydrationEvent.createPending(2L, 4L, autumnNextDayStart - 1L)
        val autumnAtNextStart = HydrationEvent.createPending(2L, 5L, autumnNextDayStart)

        repository.createIfAbsent(autumnBefore)
        repository.createIfAbsent(autumnAtStart)
        repository.createIfAbsent(autumnMidDay)
        repository.createIfAbsent(autumnAtEnd)
        repository.createIfAbsent(autumnAtNextStart)

        val autumnDayEvents = repository.listByLocalDay(autumnDate, budapestZone)
        assertEquals(3, autumnDayEvents.size)
        val autumnIds = autumnDayEvents.map { it.id }
        assertTrue(autumnIds.contains("2_2"))
        assertTrue(autumnIds.contains("2_3"))
        assertTrue(autumnIds.contains("2_4"))
        assertFalse(autumnIds.contains("2_1"))
        assertFalse(autumnIds.contains("2_5"))
    }

    @Test
    fun testCorruptOrUnknownStatusThrowsException() {
        val db = dbHelper.writableDatabase
        val values = ContentValues().apply {
            put(HydrationEventDatabaseHelper.COLUMN_ID, "corrupt_1")
            put(HydrationEventDatabaseHelper.COLUMN_TIMER_GENERATION, 1L)
            put(HydrationEventDatabaseHelper.COLUMN_ALERT_ID, 1001L)
            put(HydrationEventDatabaseHelper.COLUMN_SCHEDULED_AT, 1000L)
            put(HydrationEventDatabaseHelper.COLUMN_CREATED_AT, 1000L)
            put(HydrationEventDatabaseHelper.COLUMN_STATUS, "INVALID_CORRUPT_STATUS")
            put(HydrationEventDatabaseHelper.COLUMN_UPDATED_AT, 1000L)
            put(HydrationEventDatabaseHelper.COLUMN_REVISION, 1L)
        }
        db.insert(HydrationEventDatabaseHelper.TABLE_EVENTS, null, values)

        try {
            repository.getById("corrupt_1")
            fail("Expected IllegalStateException when reading corrupt status string")
        } catch (e: IllegalStateException) {
            assertTrue(e.message?.contains("Invalid or corrupted HydrationEventStatus") == true)
        }
    }

    @Test
    fun testPersistenceAcrossRepositoryReinitialization() {
        val event = HydrationEvent.createPending(1L, 1001L, 1710000000000L)
        repository.createIfAbsent(event)
        repository.updateStatus("1_1001", HydrationEventStatus.DRANK, 1710000005000L)

        // Instantiate new repository with same dbHelper/database
        val repository2 = HydrationEventRepository(dbHelper)
        val fetched = repository2.getById("1_1001")

        assertNotNull(fetched)
        assertEquals(HydrationEventStatus.DRANK, fetched?.status)
        assertEquals(1710000005000L, fetched?.updatedAt)
    }

    @Test(expected = IllegalArgumentException::class)
    fun testDatabaseFailureReportedWhenUpdatingNonExistentId() {
        repository.updateStatus("non_existent_id", HydrationEventStatus.DRANK)
    }

    @Test
    fun testNoAutomaticStatusTransitionWhenLeftUnanswered() {
        val pastTimestamp = System.currentTimeMillis() - 7 * 24 * 3600 * 1000L // 7 days ago
        val event = HydrationEvent.createPending(1L, 1001L, pastTimestamp, pastTimestamp)

        repository.createIfAbsent(event)

        val fetched = repository.getById("1_1001")
        assertEquals(HydrationEventStatus.PENDING, fetched?.status)

        val pending = repository.listPending()
        assertEquals(1, pending.size)
        assertEquals(HydrationEventStatus.PENDING, pending[0].status)
    }

    @Test
    fun testConcurrentStatusUpdatesInTransactions() {
        val event = HydrationEvent.createPending(1L, 1001L, 1710000000000L, 1710000000000L)
        repository.createIfAbsent(event)

        val executor = Executors.newFixedThreadPool(3)
        val startLatch = CountDownLatch(1)
        val completionLatch = CountDownLatch(3)
        val errors = ConcurrentLinkedQueue<Throwable>()
        val results = ConcurrentLinkedQueue<HydrationEvent>()

        val statuses = listOf(
            HydrationEventStatus.DRANK,
            HydrationEventStatus.NOT_DRANK,
            HydrationEventStatus.REJECTED
        )

        for (i in 0 until 3) {
            val status = statuses[i]
            val timestamp = 1710000001000L + (i * 1000L)
            executor.submit {
                try {
                    startLatch.await()
                    val updated = repository.updateStatus("1_1001", status, timestamp)
                    results.add(updated)
                } catch (t: Throwable) {
                    errors.add(t)
                } finally {
                    completionLatch.countDown()
                }
            }
        }

        startLatch.countDown()
        val finished = completionLatch.await(5, TimeUnit.SECONDS)
        executor.shutdown()

        assertTrue("Concurrent updates timed out", finished)
        assertTrue("Unexpected errors during concurrent updates: $errors", errors.isEmpty())
        assertEquals(3, results.size)

        val finalEvent = repository.getById("1_1001")
        assertNotNull(finalEvent)
        assertEquals(4L, finalEvent?.revision)
        assertTrue(
            "Final status ${finalEvent?.status} must be one of the submitted statuses",
            statuses.contains(finalEvent?.status)
        )
    }
}
