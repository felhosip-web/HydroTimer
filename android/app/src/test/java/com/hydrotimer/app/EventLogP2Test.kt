package com.hydrotimer.app

import android.content.Context
import android.view.View
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import com.google.android.material.button.MaterialButton
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import java.time.LocalDate
import java.time.ZoneId

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [33], shadows = [ShadowNotificationHelper::class])
class EventLogP2Test {

    private lateinit var context: Context
    private lateinit var dbHelper: HydrationEventDatabaseHelper
    private lateinit var repository: HydrationEventRepository

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        dbHelper = HydrationEventDatabaseHelper(context, "hydro_timer_events.db")
        repository = HydrationEventRepository(dbHelper)
        repository.clearAll()
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
    fun testMainActivitySubtabToggleBetweenStatsAndEvents() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val layoutStats = activity.findViewById<View>(R.id.layoutStatsContent)
        val layoutEvents = activity.findViewById<View>(R.id.layoutEventsContent)
        val btnTabStats = activity.findViewById<MaterialButton>(R.id.btnTabStats)
        val btnTabEvents = activity.findViewById<MaterialButton>(R.id.btnTabEvents)

        assertEquals(View.VISIBLE, layoutStats.visibility)
        assertEquals(View.GONE, layoutEvents.visibility)

        btnTabEvents.performClick()
        ShadowLooper.runUiThreadTasksIncludingDelayedTasks()

        assertEquals(View.GONE, layoutStats.visibility)
        assertEquals(View.VISIBLE, layoutEvents.visibility)

        btnTabStats.performClick()
        ShadowLooper.runUiThreadTasksIncludingDelayedTasks()

        assertEquals(View.VISIBLE, layoutStats.visibility)
        assertEquals(View.GONE, layoutEvents.visibility)

        controller.destroy()
    }

    @Test
    fun testDateNavigationAndFutureDateBlockingInMainActivity() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val btnTabEvents = activity.findViewById<MaterialButton>(R.id.btnTabEvents)
        btnTabEvents.performClick()
        ShadowLooper.runUiThreadTasksIncludingDelayedTasks()

        val tvDate = activity.findViewById<TextView>(R.id.tvSelectedDate)
        val btnPrev = activity.findViewById<View>(R.id.btnPrevDay)
        val btnNext = activity.findViewById<View>(R.id.btnNextDay)

        assertTrue(tvDate.text.contains("(Ma)"))
        assertFalse(btnNext.isEnabled)

        btnPrev.performClick()
        ShadowLooper.runUiThreadTasksIncludingDelayedTasks()

        assertFalse(tvDate.text.contains("(Ma)"))
        assertTrue(btnNext.isEnabled)

        btnNext.performClick()
        ShadowLooper.runUiThreadTasksIncludingDelayedTasks()

        assertTrue(tvDate.text.contains("(Ma)"))
        assertFalse(btnNext.isEnabled)

        controller.destroy()
    }

    @Test
    fun testEmptyStateDisplayedWhenNoEventsOnSelectedDate() {
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val btnTabEvents = activity.findViewById<MaterialButton>(R.id.btnTabEvents)
        btnTabEvents.performClick()

        Thread.sleep(50)
        ShadowLooper.runUiThreadTasksIncludingDelayedTasks()

        val tvEmpty = activity.findViewById<TextView>(R.id.tvEventsEmpty)
        assertEquals(View.VISIBLE, tvEmpty.visibility)
        assertEquals("Erre a napra nincs rögzített esemény.", tvEmpty.text.toString())

        controller.destroy()
    }

    @Test
    fun testEventCardsRenderedNewestFirstWithHungarianStatusBadges() {
        val today = LocalDate.now()
        val zone = ZoneId.systemDefault()
        val startOfDay = today.atStartOfDay(zone).toInstant().toEpochMilli()

        val e1 = HydrationEvent.createPending(1L, 1001L, startOfDay + 100000L)
        val e2 = HydrationEvent.createPending(1L, 1002L, startOfDay + 200000L)
        val e3 = HydrationEvent.createPending(1L, 1003L, startOfDay + 300000L)
        val e4 = HydrationEvent.createPending(1L, 1004L, startOfDay + 400000L)

        repository.createIfAbsent(e1)
        repository.createIfAbsent(e2)
        repository.createIfAbsent(e3)
        repository.createIfAbsent(e4)

        repository.updateStatus("1_1002", HydrationEventStatus.DRANK)
        repository.updateStatus("1_1003", HydrationEventStatus.NOT_DRANK)
        repository.updateStatus("1_1004", HydrationEventStatus.REJECTED)

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val btnTabEvents = activity.findViewById<MaterialButton>(R.id.btnTabEvents)
        btnTabEvents.performClick()

        Thread.sleep(50)
        ShadowLooper.runUiThreadTasksIncludingDelayedTasks()

        val layoutCards = activity.findViewById<android.widget.LinearLayout>(R.id.layoutEventCards)
        assertEquals(View.VISIBLE, layoutCards.visibility)
        assertEquals(4, layoutCards.childCount)

        val card0 = layoutCards.getChildAt(0)
        val tvStatus0 = card0.findViewById<TextView>(R.id.tvEventStatus)
        assertEquals("Elutasítva", tvStatus0.text.toString())

        val tvStatus1 = layoutCards.getChildAt(1).findViewById<TextView>(R.id.tvEventStatus)
        assertEquals("Nem történt meg", tvStatus1.text.toString())

        val tvStatus2 = layoutCards.getChildAt(2).findViewById<TextView>(R.id.tvEventStatus)
        assertEquals("Megtörtént", tvStatus2.text.toString())

        val tvStatus3 = layoutCards.getChildAt(3).findViewById<TextView>(R.id.tvEventStatus)
        assertEquals("Függőben", tvStatus3.text.toString())

        controller.destroy()
    }

    @Test
    fun testActivityResumeRefreshesEventListAutomatically() {
        val today = LocalDate.now()
        val zone = ZoneId.systemDefault()
        val startOfDay = today.atStartOfDay(zone).toInstant().toEpochMilli()

        repository.createIfAbsent(HydrationEvent.createPending(1L, 1001L, startOfDay + 100000L))

        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()

        val btnTabEvents = activity.findViewById<MaterialButton>(R.id.btnTabEvents)
        btnTabEvents.performClick()

        Thread.sleep(50)
        ShadowLooper.runUiThreadTasksIncludingDelayedTasks()

        val layoutCards = activity.findViewById<android.widget.LinearLayout>(R.id.layoutEventCards)
        assertEquals(1, layoutCards.childCount)

        repository.createIfAbsent(HydrationEvent.createPending(1L, 1002L, startOfDay + 200000L))

        controller.resume()
        Thread.sleep(50)
        ShadowLooper.runUiThreadTasksIncludingDelayedTasks()

        assertEquals(2, layoutCards.childCount)

        controller.destroy()
    }
}
