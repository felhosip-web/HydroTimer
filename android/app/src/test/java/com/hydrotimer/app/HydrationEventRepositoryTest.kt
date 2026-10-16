package com.hydrotimer.app

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
    fun testLocalDayRangeBoundariesIncludingDstTransition() {
        val localDate = LocalDate.of(2025, 5, 15)
        val zoneId = ZoneId.systemDefault()

        val startOfDay = localDate.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val startOfNextDay = localDate.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()

        val ePrev = HydrationEvent.createPending(1L, 1L, startOfDay - 1L)
        val eStart = HydrationEvent.createPending(1L, 2L, startOfDay)
        val eMid = HydrationEvent.createPending(1L, 3L, startOfDay + 12 * 3600 * 1000L)
        val eEnd = HydrationEvent.createPending(1L, 4L, startOfNextDay - 1L)
        val eNext = HydrationEvent.createPending(1L, 5L, startOfNextDay)

        repository.createIfAbsent(ePrev)
        repository.createIfAbsent(eStart)
        repository.createIfAbsent(eMid)
        repository.createIfAbsent(eEnd)
        repository.createIfAbsent(eNext)

        val dayEvents = repository.listByLocalDay(localDate, zoneId)
        assertEquals(3, dayEvents.size)
        val dayIds = dayEvents.map { it.id }
        assertTrue(dayIds.contains("1_2"))
        assertTrue(dayIds.contains("1_3"))
        assertTrue(dayIds.contains("1_4"))
        assertFalse(dayIds.contains("1_1"))
        assertFalse(dayIds.contains("1_5"))

        // DST transition day test
        val dstDate = LocalDate.of(2025, 3, 30)
        val dstStart = dstDate.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val dstNext = dstDate.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()

        val dstPrev = HydrationEvent.createPending(2L, 1L, dstStart - 1000L)
        val dst1 = HydrationEvent.createPending(2L, 2L, dstStart + 1800 * 1000L)
        val dst2 = HydrationEvent.createPending(2L, 3L, dstNext - 1800 * 1000L)
        val dstAfter = HydrationEvent.createPending(2L, 4L, dstNext + 1000L)

        repository.createIfAbsent(dstPrev)
        repository.createIfAbsent(dst1)
        repository.createIfAbsent(dst2)
        repository.createIfAbsent(dstAfter)

        val dstEvents = repository.listByLocalDay(dstDate, zoneId)
        assertEquals(2, dstEvents.size)
        val dstIds = dstEvents.map { it.id }
        assertTrue(dstIds.contains("2_2"))
        assertTrue(dstIds.contains("2_3"))
        assertFalse(dstIds.contains("2_1"))
        assertFalse(dstIds.contains("2_4"))
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
}
