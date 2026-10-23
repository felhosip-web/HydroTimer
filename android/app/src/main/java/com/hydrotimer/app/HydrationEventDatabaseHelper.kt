package com.hydrotimer.app

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class HydrationEventDatabaseHelper(
    context: Context,
    dbName: String = DATABASE_NAME
) : SQLiteOpenHelper(context, dbName, null, DATABASE_VERSION) {

    companion object {
        const val DATABASE_NAME = "hydro_timer_events.db"
        const val DATABASE_VERSION = 2

        const val TABLE_EVENTS = "hydration_events"
        const val COLUMN_ID = "id"
        const val COLUMN_TIMER_GENERATION = "timer_generation"
        const val COLUMN_ALERT_ID = "alert_id"
        const val COLUMN_SCHEDULED_AT = "scheduled_at"
        const val COLUMN_CREATED_AT = "created_at"
        const val COLUMN_STATUS = "status"
        const val COLUMN_UPDATED_AT = "updated_at"
        const val COLUMN_REVISION = "revision"
        const val COLUMN_INTAKE_ML = "intake_ml"
        const val COLUMN_DAILY_GOAL_ML = "daily_goal_ml"
    }

    override fun onCreate(db: SQLiteDatabase) {
        val createTableQuery = """
            CREATE TABLE IF NOT EXISTS $TABLE_EVENTS (
                $COLUMN_ID TEXT PRIMARY KEY,
                $COLUMN_TIMER_GENERATION INTEGER NOT NULL,
                $COLUMN_ALERT_ID INTEGER NOT NULL,
                $COLUMN_SCHEDULED_AT INTEGER NOT NULL,
                $COLUMN_CREATED_AT INTEGER NOT NULL,
                $COLUMN_STATUS TEXT NOT NULL,
                $COLUMN_UPDATED_AT INTEGER NOT NULL,
                $COLUMN_REVISION INTEGER NOT NULL DEFAULT 1,
                $COLUMN_INTAKE_ML INTEGER,
                $COLUMN_DAILY_GOAL_ML INTEGER
            )
        """.trimIndent()

        val createScheduledAtIndex = """
            CREATE INDEX IF NOT EXISTS idx_${TABLE_EVENTS}_scheduled_at
            ON $TABLE_EVENTS($COLUMN_SCHEDULED_AT)
        """.trimIndent()

        val createStatusIndex = """
            CREATE INDEX IF NOT EXISTS idx_${TABLE_EVENTS}_status
            ON $TABLE_EVENTS($COLUMN_STATUS)
        """.trimIndent()

        db.execSQL(createTableQuery)
        db.execSQL(createScheduledAtIndex)
        db.execSQL(createStatusIndex)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE $TABLE_EVENTS ADD COLUMN $COLUMN_INTAKE_ML INTEGER")
            db.execSQL("ALTER TABLE $TABLE_EVENTS ADD COLUMN $COLUMN_DAILY_GOAL_ML INTEGER")
        }
    }
}
