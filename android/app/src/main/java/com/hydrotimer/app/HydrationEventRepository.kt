package com.hydrotimer.app

import android.content.ContentValues
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import java.time.LocalDate
import java.time.ZoneId

class HydrationEventRepository(private val dbHelper: HydrationEventDatabaseHelper) {

    /**
     * Creates an event if absent. Uses stable primary key `id`.
     * If an event with the same ID already exists, returns the existing record without overwriting.
     * If insertion fails or conflicts and no existing record can be retrieved, throws an IllegalStateException.
     */
    fun createIfAbsent(event: HydrationEvent): HydrationEvent {
        val db = dbHelper.writableDatabase
        val values = ContentValues().apply {
            put(HydrationEventDatabaseHelper.COLUMN_ID, event.id)
            put(HydrationEventDatabaseHelper.COLUMN_TIMER_GENERATION, event.timerGeneration)
            put(HydrationEventDatabaseHelper.COLUMN_ALERT_ID, event.alertId)
            put(HydrationEventDatabaseHelper.COLUMN_SCHEDULED_AT, event.scheduledAt)
            put(HydrationEventDatabaseHelper.COLUMN_CREATED_AT, event.createdAt)
            put(HydrationEventDatabaseHelper.COLUMN_STATUS, event.status.name)
            put(HydrationEventDatabaseHelper.COLUMN_UPDATED_AT, event.updatedAt)
            put(HydrationEventDatabaseHelper.COLUMN_REVISION, event.revision)
        }

        val rowId = db.insertWithOnConflict(
            HydrationEventDatabaseHelper.TABLE_EVENTS,
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE
        )

        return if (rowId != -1L) {
            event
        } else {
            getById(event.id) ?: throw IllegalStateException("Failed to insert or retrieve existing HydrationEvent with id '${event.id}'.")
        }
    }

    /**
     * Retrieves an event by its unique ID.
     */
    fun getById(id: String): HydrationEvent? {
        val db = dbHelper.readableDatabase
        val cursor = db.query(
            HydrationEventDatabaseHelper.TABLE_EVENTS,
            null,
            "${HydrationEventDatabaseHelper.COLUMN_ID} = ?",
            arrayOf(id),
            null,
            null,
            null
        )

        return cursor.use {
            if (it.moveToFirst()) {
                cursorToEvent(it)
            } else {
                null
            }
        }
    }

    /**
     * Lists events scheduled on the local calendar day corresponding to `date`.
     * Handles daylight-saving transitions correctly using `LocalDate` and `ZoneId`.
     */
    fun listByLocalDay(date: LocalDate, zoneId: ZoneId = ZoneId.systemDefault()): List<HydrationEvent> {
        val startOfDay = date.atStartOfDay(zoneId).toInstant().toEpochMilli()
        val startOfNextDay = date.plusDays(1).atStartOfDay(zoneId).toInstant().toEpochMilli()

        return getEventsInScheduledRange(startOfDay, startOfNextDay)
    }

    /**
     * Range query for events scheduled in `[startOfDayMillis, startOfNextDayMillis)`.
     */
    fun getEventsInScheduledRange(startOfDayMillis: Long, startOfNextDayMillis: Long): List<HydrationEvent> {
        val db = dbHelper.readableDatabase
        val selection = "${HydrationEventDatabaseHelper.COLUMN_SCHEDULED_AT} >= ? AND ${HydrationEventDatabaseHelper.COLUMN_SCHEDULED_AT} < ?"
        val selectionArgs = arrayOf(startOfDayMillis.toString(), startOfNextDayMillis.toString())

        val cursor = db.query(
            HydrationEventDatabaseHelper.TABLE_EVENTS,
            null,
            selection,
            selectionArgs,
            null,
            null,
            "${HydrationEventDatabaseHelper.COLUMN_SCHEDULED_AT} ASC"
        )

        val events = mutableListOf<HydrationEvent>()
        cursor.use {
            while (it.moveToNext()) {
                events.add(cursorToEvent(it))
            }
        }
        return events
    }

    /**
     * Updates the status of an existing event.
     * Throws an IllegalArgumentException if the event with `id` does not exist.
     */
    fun updateStatus(
        id: String,
        status: HydrationEventStatus,
        updatedAt: Long = System.currentTimeMillis()
    ): HydrationEvent {
        val existing = getById(id) ?: throw IllegalArgumentException("HydrationEvent with id '$id' not found.")

        val updatedEvent = existing.copy(
            status = status,
            updatedAt = updatedAt,
            revision = existing.revision + 1
        )

        val db = dbHelper.writableDatabase
        val values = ContentValues().apply {
            put(HydrationEventDatabaseHelper.COLUMN_STATUS, updatedEvent.status.name)
            put(HydrationEventDatabaseHelper.COLUMN_UPDATED_AT, updatedEvent.updatedAt)
            put(HydrationEventDatabaseHelper.COLUMN_REVISION, updatedEvent.revision)
        }

        val rowsAffected = db.update(
            HydrationEventDatabaseHelper.TABLE_EVENTS,
            values,
            "${HydrationEventDatabaseHelper.COLUMN_ID} = ?",
            arrayOf(id)
        )

        if (rowsAffected == 0) {
            throw IllegalArgumentException("HydrationEvent with id '$id' failed to update.")
        }

        return updatedEvent
    }

    /**
     * Lists all pending hydration events.
     */
    fun listPending(): List<HydrationEvent> {
        val db = dbHelper.readableDatabase
        val cursor = db.query(
            HydrationEventDatabaseHelper.TABLE_EVENTS,
            null,
            "${HydrationEventDatabaseHelper.COLUMN_STATUS} = ?",
            arrayOf(HydrationEventStatus.PENDING.name),
            null,
            null,
            "${HydrationEventDatabaseHelper.COLUMN_SCHEDULED_AT} ASC"
        )

        val events = mutableListOf<HydrationEvent>()
        cursor.use {
            while (it.moveToNext()) {
                events.add(cursorToEvent(it))
            }
        }
        return events
    }

    /**
     * Helper method to clear all events in table (useful for test isolation).
     */
    fun clearAll() {
        val db = dbHelper.writableDatabase
        db.delete(HydrationEventDatabaseHelper.TABLE_EVENTS, null, null)
    }

    private fun cursorToEvent(cursor: Cursor): HydrationEvent {
        val id = cursor.getString(cursor.getColumnIndexOrThrow(HydrationEventDatabaseHelper.COLUMN_ID))
        val timerGen = cursor.getLong(cursor.getColumnIndexOrThrow(HydrationEventDatabaseHelper.COLUMN_TIMER_GENERATION))
        val alertId = cursor.getLong(cursor.getColumnIndexOrThrow(HydrationEventDatabaseHelper.COLUMN_ALERT_ID))
        val scheduledAt = cursor.getLong(cursor.getColumnIndexOrThrow(HydrationEventDatabaseHelper.COLUMN_SCHEDULED_AT))
        val createdAt = cursor.getLong(cursor.getColumnIndexOrThrow(HydrationEventDatabaseHelper.COLUMN_CREATED_AT))
        val statusStr = cursor.getString(cursor.getColumnIndexOrThrow(HydrationEventDatabaseHelper.COLUMN_STATUS))
        val updatedAt = cursor.getLong(cursor.getColumnIndexOrThrow(HydrationEventDatabaseHelper.COLUMN_UPDATED_AT))
        val revision = cursor.getLong(cursor.getColumnIndexOrThrow(HydrationEventDatabaseHelper.COLUMN_REVISION))

        val status = try {
            HydrationEventStatus.valueOf(statusStr)
        } catch (e: Exception) {
            throw IllegalStateException("Invalid or corrupted HydrationEventStatus '$statusStr' for event id '$id'.", e)
        }

        return HydrationEvent(
            id = id,
            timerGeneration = timerGen,
            alertId = alertId,
            scheduledAt = scheduledAt,
            createdAt = createdAt,
            status = status,
            updatedAt = updatedAt,
            revision = revision
        )
    }
}
