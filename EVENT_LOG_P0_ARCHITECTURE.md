# HydroTimer — Event Log P0 Architecture Note

## 1. Storage Choices & Schemas

### Web Persistence (IndexedDB + Dexie.js)
- **Library**: Dexie.js (v4)
- **Database Name**: `HydroTimerEventsDB`
- **Database Version**: 1
- **Schema**:
  - Store: `events`
  - Primary Key: `id` (stable string identifier)
  - Indexes: `scheduledAt`, `status`, `createdAt`
- **Design Decisions**:
  - Independent from `TimerSnapshot` (which remains in `localStorage`).
  - Idempotent writes via `createIfAbsent(event)`. If a constraint error occurs on primary key `id`, the existing record is returned without overwriting.

### Native Android Persistence (SQLiteOpenHelper)
- **Implementation**: `SQLiteOpenHelper` (`HydrationEventDatabaseHelper`) and `HydrationEventRepository`
- **Database Name**: `hydro_timer_events.db`
- **Database Version**: 1
- **Schema**:
  - Table: `hydration_events`
    - `id` (TEXT PRIMARY KEY)
    - `timer_generation` (INTEGER NOT NULL)
    - `alert_id` (INTEGER NOT NULL)
    - `scheduled_at` (INTEGER NOT NULL)
    - `created_at` (INTEGER NOT NULL)
    - `status` (TEXT NOT NULL)
    - `updated_at` (INTEGER NOT NULL)
    - `revision` (INTEGER NOT NULL DEFAULT 1)
  - Indexes:
    - `idx_hydration_events_scheduled_at` on `scheduled_at`
    - `idx_hydration_events_status` on `status`
- **Trade-off Explanation**:
  - Standard Android `SQLiteOpenHelper` was chosen over Room to avoid adding annotation processing overhead (KSP/KAPT plugins and build configurations) while providing clean, lightweight, non-destructive SQLite schema management and full Robolectric JVM unit-test support.

---

## 2. Stable Event Identity & Idempotency

- **Key Format**: `${timerGeneration}_${alertId}`
- **Rationale**:
  - Every timer-triggered reminder alert generates a unique `(timerGeneration, alertId)` combination.
  - Test alerts (`TEST_ALERT`) do not create real hydration events.
  - If duplicate trigger callbacks or recovery attempts process the same reminder alert, the computed `id` is identical (`"1_1001"`).
  - Both Web and Android repositories use `createIfAbsent()` to ignore duplicate insertion attempts and return the existing event record without overwriting.

---

## 3. Local-Day Query Semantics

- **Range**: Half-open interval `scheduledAt >= startOfDayMillis AND scheduledAt < startOfNextDayMillis`
- **Local Boundary Calculation**:
  - **Web**: Uses local `Date` constructor `(year, month, day, 0, 0, 0, 0)` and `(year, month, day + 1, 0, 0, 0, 0)`.
  - **Android**: Uses `LocalDate` with `ZoneId` (e.g. `ZoneId.of("Europe/Budapest")` or `ZoneId.systemDefault()`), computing `date.atStartOfDay(zoneId)` and `date.plusDays(1).atStartOfDay(zoneId)`.
- **Daylight Saving Time (DST)**:
  - By using local date constructors and `ZoneId`, local day boundaries accurately capture 23-hour (spring forward) or 25-hour (fall back) calendar days without assuming a fixed 24-hour length.

---

## 4. Summary of Changed Files & Dependencies

### New Files
- `src/domain/eventlog/types.ts`
- `src/domain/eventlog/HydrationEventRepository.ts`
- `src/domain/eventlog/__tests__/HydrationEventRepository.test.ts`
- `android/app/src/main/java/com/hydrotimer/app/HydrationEvent.kt`
- `android/app/src/main/java/com/hydrotimer/app/HydrationEventDatabaseHelper.kt`
- `android/app/src/main/java/com/hydrotimer/app/HydrationEventRepository.kt`
- `android/app/src/test/java/com/hydrotimer/app/HydrationEventRepositoryTest.kt`
- `EVENT_LOG_P0_ARCHITECTURE.md`

### Modified Files
- `package.json` & `bun.lock`: Added `dexie` and `fake-indexeddb`
- `android/app/build.gradle.kts`: Added `robolectric` and `androidx.test:core` test dependencies

---

## 5. Phase Roadmap & Scope Boundaries

- **P0 (Current Phase)**: Domain model and local persistence foundation for hydration events. No live timer engine wiring or UI changes.
- **P1 (Next Phase)**: Integration with accepted, real timer triggers. Automatic creation of `PENDING` events when real reminder alerts fire (excluding `TEST_ALERT`).
- **P2 (Future Phase)**: Event-log UI and history browsing screen/components.
- **P3 (Future Phase)**: Status editing, resolution modal, and related UI interaction behavior.
