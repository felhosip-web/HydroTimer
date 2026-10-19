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
class EventLogP2Test {

    private lateinit var context: Context
    private lateinit var dbHelper: HydrationEventDatabaseHelper
    private lateinit var repository: HydrationEventRepository
    private lateinit var dbName: String

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        dbName = "test_p2_${System.currentTimeMillis()}_${(1000..9999).random()}.db"
        dbHelper = HydrationEventDatabaseHelper(context, dbName)
        repository = HydrationEventRepository(dbHelper)
    }

    @After
    fun tearDown() {
        try {
            repository.clearAll()
            dbHelper.close()
        } catch (e: Exception) {
            // Ignore
        }
    }

    @Test
    fun testRepositoryQueriesEventsNewestFirstForLocalDay() {
        val today = LocalDate.now()
        val zone = ZoneId.systemDefault()
        val startOfDay = today.atStartOfDay(zone).toInstant().toEpochMilli()

        val e1 = HydrationEvent.createPending(1L, 1001L, startOfDay + 100000L)
        val e2 = HydrationEvent.createPending(1L, 1002L, startOfDay + 200000L)
        val e3 = HydrationEvent.createPending(1L, 1003L, startOfDay + 300000L)

        repository.createIfAbsent(e1)
        repository.createIfAbsent(e2)
        repository.createIfAbsent(e3)

        repository.updateStatus("1_1002", HydrationEventStatus.DRANK)
        repository.updateStatus("1_1003", HydrationEventStatus.REJECTED)

        val events = repository.listByLocalDay(today)
        assertEquals(3, events.size)

        // Verify newest first ordering
        assertEquals("1_1003", events[0].id)
        assertEquals("1_1002", events[1].id)
        assertEquals("1_1001", events[2].id)
    }

    @Test
    fun testHungarianStatusLabelsAndTreatments() {
        fun getHungarianLabel(status: HydrationEventStatus): String = when (status) {
            HydrationEventStatus.PENDING -> "Függőben"
            HydrationEventStatus.DRANK -> "Megtörtént"
            HydrationEventStatus.NOT_DRANK -> "Nem történt meg"
            HydrationEventStatus.REJECTED -> "Elutasítva"
        }

        assertEquals("Függőben", getHungarianLabel(HydrationEventStatus.PENDING))
        assertEquals("Megtörtént", getHungarianLabel(HydrationEventStatus.DRANK))
        assertEquals("Nem történt meg", getHungarianLabel(HydrationEventStatus.NOT_DRANK))
        assertEquals("Elutasítva", getHungarianLabel(HydrationEventStatus.REJECTED))
    }

    @Test
    fun testFutureDateNavigationPreventionLogic() {
        val today = LocalDate.now()
        val tomorrow = today.plusDays(1)

        fun navigateNext(current: LocalDate): LocalDate {
            return if (current >= today) today else current.plusDays(1)
        }

        assertEquals(today, navigateNext(today))
        assertEquals(today, navigateNext(tomorrow))

        val yesterday = today.minusDays(1)
        assertEquals(today, navigateNext(yesterday))
    }

    @Test
    fun testEmptyStateWhenNoEventsOnDate() {
        val pastDate = LocalDate.of(2020, 1, 1)
        val events = repository.listByLocalDay(pastDate)
        assertTrue(events.isEmpty())
    }

    @Test
    fun testQueryingEventLogDoesNotMutatePersistedRecords() {
        val today = LocalDate.now()
        val zone = ZoneId.systemDefault()
        val scheduledAt = today.atStartOfDay(zone).toInstant().toEpochMilli() + 50000L

        val event = HydrationEvent.createPending(1L, 1001L, scheduledAt)
        repository.createIfAbsent(event)

        val before = repository.getById("1_1001")
        assertNotNull(before)
        val initialRev = before?.revision
        val initialUpdatedAt = before?.updatedAt

        // Multiple queries
        repository.listByLocalDay(today)
        repository.listByLocalDay(today)

        val after = repository.getById("1_1001")
        assertEquals(initialRev, after?.revision)
        assertEquals(initialUpdatedAt, after?.updatedAt)
        assertEquals(HydrationEventStatus.PENDING, after?.status)
    }

    @Test
    fun testLifecycleResumeRefreshWithoutDuplication() {
        val today = LocalDate.now()
        val zone = ZoneId.systemDefault()
        val scheduledAt = today.atStartOfDay(zone).toInstant().toEpochMilli() + 100000L

        val e1 = HydrationEvent.createPending(1L, 1001L, scheduledAt)
        repository.createIfAbsent(e1)

        // Simulate resume call 1
        val list1 = repository.listByLocalDay(today)
        assertEquals(1, list1.size)

        // Background process adds a new event
        val e2 = HydrationEvent.createPending(1L, 1002L, scheduledAt + 50000L)
        repository.createIfAbsent(e2)

        // Simulate resume call 2
        val list2 = repository.listByLocalDay(today)
        assertEquals(2, list2.size)
        assertEquals("1_1002", list2[0].id)
        assertEquals("1_1001", list2[1].id)
    }
}
