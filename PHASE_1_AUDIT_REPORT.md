# HydroTimer Phase 1 – Timer State Machine Audit & Architecture Report

---

## 1. Executive Summary
HydroTimer is a dual-platform hydration and habit tracking application supporting Android (Kotlin) and Web (React/TypeScript). This Phase 1 engineering report defines one clear, platform-independent timer state machine contract.
Existing implementations on Android and Web exhibit timing discrepancies, stale callback vulnerabilities, race conditions during alert resolution, and divergent state representations. By decoupling timer domain state from platform scheduling primitives (`AlarmManager`, `setInterval`), introducing explicit token generation (`timerGeneration`, `alertId`), and standardizing canonical absolute timestamps, HydroTimer will achieve 100% behavioral parity, idempotency, and crash/reboot resiliency across Android and Web.

---

## 2. Repository Baseline
- **Repository:** `felhosip-web/HydroTimer`
- **Branch:** `main`
- **Baseline Commit:** `5bf9073b320aa3f876489a52b6ac83a494f614e4` ("Synchronize Android alert acknowledgement and timeout handling")
- **Repository Scope Inspected:**
  - **Android:** `android/app/src/main/java/com/hydrotimer/app/` (`TimerManager.kt`, `ReminderReceiver.kt`, `NotificationHelper.kt`, `BootReceiver.kt`, `MainActivity.kt`), `AndroidManifest.xml`, build files.
  - **Web:** `src/` (`App.tsx`, `components/CountdownView.tsx`, `components/PhoneDashboard.tsx`, `components/DailyStats.tsx`, `services/soundHaptics.ts`, `services/nativeAndroidCode.ts`, `types.ts`).

---

## 3. Current Android Behavior
Inspection of `TimerManager.kt`, `ReminderReceiver.kt`, `NotificationHelper.kt`, `BootReceiver.kt`, and `MainActivity.kt`:

- **How is a timer started?**
  Called via `TimerManager.startTimer(intervalMinutes)`. Sets `is_running = true`, persists `interval_minutes`, calculates `nextTriggerFromNow()`, persists `next_trigger_timestamp`, and calls `AlarmManager.setExactAndAllowWhileIdle(RTC_WAKEUP, triggerAt, pendingIntent)`.
- **How is it stopped?**
  Called via `TimerManager.stopTimer()`. Sets `is_running = false`, `next_trigger_timestamp = 0L`, and invokes `cancelAlarm()` and `cancelAlertTimeout()`.
- **What represents "running"?**
  The boolean preference `KEY_IS_RUNNING` (`is_running`) in `SharedPreferences`.
- **How is the next reminder calculated?**
  Via `nextTriggerFromNow()`:
  - Free mode: `System.currentTimeMillis() + interval_minutes * 60_000L`.
  - Clock mode: Calculates wall-clock slot boundary `((currentMinute / step) + 1) * step` and returns epoch millis for the next slot.
- **Where is the next trigger persisted?**
  In `SharedPreferences` under `KEY_NEXT_TRIGGER_TIMESTAMP` (`next_trigger_timestamp`).
- **What happens when the process/app is killed?**
  `AlarmManager` scheduled RTC alarms survive process death and wake up the device via `ReminderReceiver`.
- **What happens after app restart?**
  `MainActivity` inspects `isTimerRunning()` and `next_trigger_timestamp` in `onResume()` and recalculates the UI display countdown using a local `CountDownTimer`.
- **What happens after Android device reboot?**
  `BootReceiver` receives `ACTION_BOOT_COMPLETED` or `QUICKBOOT_POWERON`. If `isTimerRunning()` is true, it calls `scheduleNextOccurrence()` (re-calculates `nextTriggerFromNow()` from current time and reschedules `AlarmManager`).
- **What happens if the system delays an alarm?**
  `AlarmManager` fires `ReminderReceiver` late. `ReminderReceiver` checks `isTimerRunning()`. If true, it proceeds to check quiet hours/active days and posts `NotificationHelper.showWaterReminder()` regardless of delay.
- **What happens if an old callback executes late?**
  `ReminderReceiver` checks `isTimerRunning()`. However, it cannot verify if the callback belonged to a previous timer session or an earlier alert ID.
- **How is an active alert represented?**
  An active alert is represented implicitly by the display of the system notification (`NOTIFICATION_ID = 1001`) and an active timeout alarm scheduled via `scheduleAlertTimeout()`.
- **How is alert timeout represented?**
  By the execution of `ACTION_ALERT_TIMEOUT` in `ReminderReceiver`.
- **What happens on ACK?**
  `ReminderReceiver.onReceive()` handles `ACTION_ACKNOWLEDGE`: cancels alert timeout alarm, cancels notification `1001`, calls `recordTodayAck()`, shows Toast, and invokes `scheduleNextOccurrence()`.
- **What happens on DRINK?**
  Handles `ACTION_LOG_DRINK`: cancels alert timeout alarm, cancels notification `1001`, calls `addDrunkMl(intake)`, calls `recordTodayAck()`, shows Toast, and invokes `scheduleNextOccurrence()`.
- **What happens on missed alert?**
  When `ACTION_ALERT_TIMEOUT` fires: cancels notification `1001`, increments `missed_alerts_count` and `today_missed_count`, posts `MISSED_NOTIFICATION_ID = 1002`, and invokes `scheduleNextOccurrence()`.
- **How is the next interval calculated after ACK / DRINK / TIMEOUT?**
  All three trigger `scheduleNextOccurrence()`, which calls `nextTriggerFromNow()` (calculating `now + interval` or next clock slot).
- **What happens if configuration changes while the timer is running?**
  Changing interval or mode in `MainActivity` calls `stopTimer()` followed by `startTimer()` with new parameters.

---

## 4. Current Web Behavior
Inspection of `App.tsx` and React component trees:

- **How is a timer started?**
  Sets React state `isRunning = true`.
- **How is it stopped?**
  Sets React state `isRunning = false` and `isAlerting = false`.
- **What represents "running"?**
  The React state variable `isRunning`.
- **How is the next reminder calculated?**
  Via relative second decrementing: `setRemainingSeconds(prev => prev - 1)` in a 1000ms `setInterval`.
- **Where is the next trigger persisted?**
  The next trigger is **NOT** persisted in Web! Only configuration (`hydro_timer_config_v2`), daily water intake (`hydro_water_today`), and activity logs (`hydro_activity_logs`) are saved to `localStorage`.
- **What happens when the process/app is killed / closed?**
  `setInterval` stops. When reopened, `remainingSeconds` resets to `totalDuration` because no target timestamp was persisted.
- **What happens after React page reload?**
  Timer resets to initial state (`isRunning = false`, `remainingSeconds = totalDuration`). Running state and progress are lost!
- **What happens if an old callback executes late?**
  In-flight `setInterval` ticks in React effects can trigger state changes if dependencies or cleanup functions fail to cancel timers properly.
- **How is an active alert represented?**
  React state `isAlerting = true` with a countdown state `alertSecondsLeft`.
- **How is alert timeout represented?**
  When `alertSecondsLeft <= 1`, `handleAlertTimeoutMissed()` is invoked.
- **What happens on ACK?**
  `handleAcknowledgeAlert(false)` sets `isAlerting = false`, logs activity, and resets `remainingSeconds = totalDuration`. If `autoRestart` is true, sets `isRunning = true`.
- **What happens on DRINK?**
  `handleAcknowledgeAlert(true)` sets `isAlerting = false`, increments `waterIntakeMl`, logs activity, and resets `remainingSeconds = totalDuration`.
- **What happens on missed alert?**
  `handleAlertTimeoutMissed()` sets `isAlerting = false`, logs missed alert with timestamp, sets `missedAlertNotice`, and resets/restarts timer if in interval mode.
- **How is the next interval calculated after ACK / DRINK / TIMEOUT?**
  Relative reset: `remainingSeconds = config.intervalMinutes * 60`.
- **What happens if configuration changes while the timer is running?**
  Updating `config` in state updates parameters, but relative countdown continues from `remainingSeconds` until manual reset or next trigger.

---

## 5. Existing Android Fix Assessment
Commit `5bf9073b320aa3f876489a52b6ac83a494f614e4` synchronized alert cancellation across notification actions and timeout callbacks:
- Added `cancelAlertTimeout()` and `NotificationHelper.cancelAlertNotifications(context)` inside `ACTION_LOG_DRINK` and `ACTION_ACKNOWLEDGE`.
- Ensured `ACTION_ALERT_TIMEOUT` checks `isTimerRunning()` before proceeding.

### Evaluation & Adequacy Analysis
While this fix resolved basic synchronous overlay issues, **it remains insufficient against asynchronous stale callbacks and OS event queue race conditions**:
1. **The AlarmManager / PendingIntent Race Window:** When `AlarmManager` triggers `ACTION_ALERT_TIMEOUT`, the Android system constructs an Intent broadcast and enqueues it into the process main thread MessageQueue. If the user clicks "DRINK" or "ACK" while the broadcast is enqueued/in-flight:
   - The user action executes `ACTION_LOG_DRINK`: calls `cancelAlertTimeout()`, records drink, and schedules the *next* occurrence (`WAITING`).
   - `cancelAlertTimeout()` cancels future alarms in `AlarmManager`, but **cannot stop an intent already delivered to the OS receiver queue**.
   - The in-flight `ACTION_ALERT_TIMEOUT` broadcast executes immediately after.
   - Because `isTimerRunning()` is still `true` (the timer is waiting for the next occurrence!), `ReminderReceiver` executes the timeout logic: records a missed alert, cancels notifications, posts a missed warning, and calls `scheduleNextOccurrence()` **a second time**, corrupting the schedule and double-advancing the cycle!

---

## 6. Identified Race / Stale-Event Problems

| Hazard ID | Scenario / Race Condition | Current Behavior | Concrete Technical Consequence |
| :--- | :--- | :--- | :--- |
| **RACE-01** | User ACKs/DRINKs immediately as TIMEOUT fires | `cancelAlertTimeout()` called, but timeout broadcast is already in-flight in OS queue | Timeout executes anyway because `isTimerRunning() == true`. Records false missed alert and double-schedules next occurrence. |
| **RACE-02** | User stops and restarts timer while timeout alarm is queued | Timer restarted with new session. In-flight timeout from old session fires. | Old timeout executes against new session, marking new session as missed and rescheduling. |
| **RACE-03** | User taps notification action twice (or app ACK + notification ACK) | Duplicate `ACTION_ACKNOWLEDGE` broadcasts delivered. | Second ACK records duplicate stats (`recordTodayAck()`) and calls `scheduleNextOccurrence()` twice. |
| **RACE-04** | Web page reloads while timer is running | React state lost. `remainingSeconds` re-initializes to max duration. | Web timer loses running state and timing progress completely on browser reload or tab crash. |
| **RACE-05** | Android device reboot | `BootReceiver` calls `scheduleNextOccurrence()` starting a new full interval from reboot time. | Time elapsed prior to reboot is discarded; reminder is postponed longer than intended. |
| **RACE-06** | System delays alarm (Doze mode / OS throttling) | Alarm fires hours late. Immediately triggers alert with standard duration. | Alert fires out of context. If past quiet hours or next slot, scheduling drifts. |

---

## 7. Proposed Domain State Machine
A platform-independent finite state machine (FSM):

```
                   +------------------------+
                   |        STOPPED         |
                   +------------------------+
                     |                    ^
               START |                    | STOP /
                     v                    | EXPIRE (Countdown)
                   +------------------------+
        +--------> |        WAITING         |
        |          +------------------------+
        |            |                    ^
        |   TRIGGER  |                    | CANCEL_ALERT
        |            v                    |
        |          +------------------------+
        |          |      ALERT_ACTIVE      |
        |          +------------------------+
        |            |         |        |
    ACK |     DRINK  |         |        | TIMEOUT
        +------------+---------+        |
        |                               v
        |                     [ EVENT: MISSED_ALERT ]
        |                               |
        +-------------------------------+ (If autoRestart / interval mode)
```

### Domain Decision on `MISSED`:
`MISSED` is specified as a **transient domain event** rather than a persistent blocking state. When an alert times out, the domain machine emits a `MISSED_ALERT` side-effect event (recorded in stats/logs) and immediately transitions back to `WAITING` (if interval mode) or `STOPPED` (if single countdown mode). This guarantees that the timer cycle continues deterministically without requiring manual user unblocking.

---

## 8. Event Model
All state mutations are driven by typed, immutable domain events containing platform-independent payloads:

```typescript
type TimerEventType =
  | "START"
  | "STOP"
  | "REMINDER_TRIGGER"
  | "ACKNOWLEDGE"
  | "LOG_DRINK"
  | "ALERT_TIMEOUT"
  | "RECOVER_STATE"
  | "CONFIG_CHANGE";

interface DomainTimerEvent {
  type: TimerEventType;
  timestamp: number; // Wall-clock epoch millis
  timerGeneration: number; // Target timer generation token
  alertId?: number | null; // Target alert ID token (for ACK/DRINK/TIMEOUT)
  payload?: Record<string, any>;
}
```

---

## 9. Timer Generation Strategy (`timerGeneration`)
To prevent stale callbacks from previous timer sessions from mutating a new session:
1. `timerGeneration` is a 64-bit integer monotonically increased on every `START` or `RESTART` action (`timerGeneration = System.currentTimeMillis()`).
2. Persisted in state storage (`SharedPreferences` / `localStorage`).
3. Embedded as an extra in all scheduled system alarms (`EXTRA_TIMER_GENERATION`) and browser timers.
4. **Validation Guard Rule:**
   $$\text{Guard}(e) = (e.\text{timerGeneration} == \text{state}.\text{timerGeneration}) \land (\text{state}.\text{state} \neq \text{"STOPPED"})$$
   If $e.\text{timerGeneration} \neq \text{state}.\text{timerGeneration}$, the event is **STALE** and immediately discarded with zero side-effects.

---

## 10. Alert Identity Strategy (`alertId`)
To prevent duplicate/stale ACK, DRINK, or TIMEOUT events from affecting resolved alerts:
1. `alertId` is a 64-bit integer generated when transitioning `WAITING -> ALERT_ACTIVE` (`alertId = System.currentTimeMillis()`).
2. When an alert becomes active, `alertId` is stored in canonical state and attached to notification action intents (`EXTRA_ALERT_ID`) and timeout alarms.
3. **Idempotency & Stale Resolution Guard Rule:**
   $$\text{GuardResolution}(e) = (\text{state}.\text{state} == \text{"ALERT_ACTIVE"}) \land (\text{state}.\text{alertId} \neq \text{null}) \land (e.\text{alertId} == \text{state}.\text{alertId})$$
4. Upon the first valid resolution (ACK, DRINK, or TIMEOUT), state transitions to `WAITING`, and `state.alertId` is cleared (`null`).
5. Any subsequent event with matching or older `alertId` fails the guard (`state.alertId == null`) and is ignored silently.

---

## 11. Canonical Timestamp Model
Canonical state relies strictly on absolute epoch timestamps (milliseconds since Unix epoch):

```typescript
type TimerState = "STOPPED" | "WAITING" | "ALERT_ACTIVE";

interface CanonicalTimerState {
  // Authoritative State
  state: TimerState;
  timerGeneration: number;
  alertId: number | null;
  nextTriggerAt: number | null;    // Epoch ms when next reminder triggers
  alertStartedAt: number | null;   // Epoch ms when alert phase started
  alertDeadlineAt: number | null;  // Epoch ms when alert expires

  // Configuration
  mode: "interval" | "countdown";
  intervalMinutes: number;
  countdownMinutes: number;
  countdownSeconds: number;
  alertDurationSeconds: number;
  autoRestart: boolean;
  intervalMode: "free" | "clock";
  clockIntervalMinutes: number;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // "23:00"
  quietHoursEnd: string;   // "07:00"
  activeDays: boolean[];   // Length 7 [Sun..Sat]
}
```

### Derived UI Values (Calculated on the fly):
$$\text{remainingSeconds} = \max\left(0, \left\lceil \frac{\text{nextTriggerAt} - \text{now}}{1000} \right\rceil\right)$$
$$\text{alertSecondsLeft} = \max\left(0, \left\lceil \frac{\text{alertDeadlineAt} - \text{now}}{1000} \right\rceil\right)$$

---

## 12. Free vs Clock-Aligned Semantics

### Free Mode (`intervalMode = "free"`):
The next trigger is calculated relative to the resolution timestamp $\text{T}_{\text{resolve}}$:
$$\text{nextTriggerAt} = \text{T}_{\text{resolve}} + (\text{intervalMinutes} \times 60,000)$$

### Clock-Aligned Mode (`intervalMode = "clock"`):
Intervals align to clock boundaries (e.g., 30m slot $\rightarrow$ 10:00, 10:30, 11:00).
1. Given step $S \in [30, 90]$ minutes.
2. Calculate current minute of day $M = \text{hour} \times 60 + \text{minute}$.
3. Target minute slot $M_{\text{next}} = \left( \lfloor M / S \rfloor + 1 \right) \times S$.
4. Calculate candidate epoch ms $T_{\text{slot}}$.
5. If $T_{\text{slot}} \le \text{now}$, add 24 hours.

### Quiet Hours & Active Days Adjustment Rule:
If candidate $T_{\text{candidate}}$ falls within Quiet Hours ($[\text{start}, \text{end})$) or an inactive day, $T_{\text{candidate}}$ is advanced automatically to the start of the next valid active time window.

---

## 13. ACK / DRINK / TIMEOUT Semantics

| Feature / Effect | ACK | DRINK | TIMEOUT |
| :--- | :--- | :--- | :--- |
| **Resolves Alert (`alertId`)** | Yes (`alertId = null`) | Yes (`alertId = null`) | Yes (`alertId = null`) |
| **Increments Ack Count** | Yes (`todayAckCount++`) | Yes (`todayAckCount++`) | No |
| **Logs Water Intake** | No | Yes (`+intakeMlPerAlert`) | No |
| **Increments Missed Count** | No | No | Yes (`missedCount++`, `todayMissed++`) |
| **Cancels Alert Notification** | Yes (`cancel(1001)`) | Yes (`cancel(1001)`) | Yes (`cancel(1001)`) |
| **Shows Missed Notification** | No | No | Yes (`showMissedNotification(1002)`) |
| **Next State (Interval)** | `WAITING` (schedule next) | `WAITING` (schedule next) | `WAITING` (schedule next) |
| **Next State (Countdown)** | `STOPPED` | `STOPPED` | `STOPPED` |

---

## 14. Notification Lifecycle

```
[WAITING]
   |
   | REMINDER_TRIGGER
   v
[ALERT_ACTIVE] ------------> Posts NOTIFICATION_ID (1001) [High Priority / Ringtone]
   |                             |
   +-------------+---------------+
   |             |               |
 ACK          DRINK           TIMEOUT
   |             |               |
   +-------------+               +---> Cancels NOTIFICATION_ID (1001)
   |                                   Posts MISSED_NOTIFICATION_ID (1002) [Warning tone]
   v                                   (Dismissible, click opens app)
 Cancels NOTIFICATION_ID (1001)
 No missed notification
```

- **Stale Notification Actions:** When a user interacts with a notification action, the intent passes `alertId` and `timerGeneration`. If the alert was already resolved in-app, the receiver validates the token, drops the stale action, and cancels the notification cleanly.

---

## 15. Persistence & Recovery

### Durable State (Must survive process death, reboot, page reload):
1. `state` (`"STOPPED"`, `"WAITING"`, `"ALERT_ACTIVE"`)
2. `timerGeneration` (Long)
3. `alertId` (Long or null)
4. `nextTriggerAt` (Long or null)
5. `alertStartedAt` (Long or null)
6. `alertDeadlineAt` (Long or null)
7. Full configuration object & daily stats

### Recovery Logic on App Startup / Reload:
```
T_now = CurrentTimeMs()

IF state == "WAITING":
    IF T_now >= nextTriggerAt:
        EMIT REMINDER_TRIGGER(now)
    ELSE:
        RESCHEDULE_SCHEDULER(nextTriggerAt)

ELSE IF state == "ALERT_ACTIVE":
    IF T_now >= alertDeadlineAt:
        EMIT ALERT_TIMEOUT(alertId, generation)
    ELSE:
        RESTORE_ALERT_UI(alertDeadlineAt - T_now)
        RESCHEDULE_TIMEOUT_SCHEDULER(alertDeadlineAt)

ELSE IF state == "STOPPED":
    CLEAR_ALL_SCHEDULERS()
```

---

## 16. Runtime Configuration Rules

| Configuration Setting | Affects Active Alert? | Affects Next Occurrence? | Action Required |
| :--- | :--- | :--- | :--- |
| **Interval Minutes** | No | Yes | Re-calculate `nextTriggerAt` if in `WAITING` state; reschedule alarm. |
| **Interval Mode (Free/Clock)**| No | Yes | Re-calculate `nextTriggerAt` from current slot rules; reschedule alarm. |
| **Alert Duration (Seconds)** | Yes (updates deadline) | Yes | Update `alertDeadlineAt = alertStartedAt + newDuration`; reschedule timeout alarm. |
| **Quiet Hours / Active Days**| No | Yes | If current `nextTriggerAt` falls into new quiet hours, reschedule to next valid window. |
| **Intake Amount / Goal** | No | No | Persist immediately; used on next DRINK action. |

---

## 17. Android Architecture
Separation of concerns using clean architecture layers:

```
+-------------------------------------------------------------------+
|                          UI / Activity                            |
|                  (MainActivity / Views / ViewModel)                |
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|                        TimerDomainEngine                          |
|    (Authoritative FSM, Token Validator, Transition Handler)      |
+-------------------------------------------------------------------+
       |                          |                         |
       v                          v                         v
+--------------+        +-------------------+    +--------------------+
|  TimerStore  |        |  AlarmScheduler   |    | NotificationAdapter|
|(Preferences) |        |  (AlarmManager)   |    |(NotificationManager|
+--------------+        +-------------------+    +--------------------+
                                  ^
                                  | Events
                        +-------------------+
                        |  ReminderReceiver |
                        +-------------------+
```

---

## 18. Web Architecture
Clean React architecture matching Android domain semantics:

```
+-------------------------------------------------------------------+
|                        React UI Components                        |
|            (PhoneDashboard, CountdownView, Smartwatch)            |
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
|                           useTimer DomainHook                     |
|           (Wraps TimerDomainEngine, provides state snapshot)      |
+-------------------------------------------------------------------+
       |                          |                         |
       v                          v                         v
+--------------+        +-------------------+    +--------------------+
| WebStorage   |        | BrowserScheduler  |    | Sound/Notification |
|(localStorage)|        | (window.setTimeout|    | (Web Audio/Haptics)|
+--------------+        +-------------------+    +--------------------+
```

---

## 19. Cross-Platform Contract
The canonical contract shared between Android and Web:

1. **State Machine:** States (`STOPPED`, `WAITING`, `ALERT_ACTIVE`) and transition rules are 100% identical.
2. **Tokens:** Both platforms generate and validate `timerGeneration` and `alertId`.
3. **Timestamps:** Authoritative scheduling uses Unix epoch milliseconds (`nextTriggerAt`, `alertDeadlineAt`).
4. **Idempotency:** Late or duplicate callbacks with stale tokens produce 0 side-effects.
5. **Recovery:** Re-evaluating persisted timestamps on boot/reload produces identical recovery decisions.

---

## 20. Complete Transition Table

| Current State | Domain Event | Guard Condition | New State | Emitted Side Effects / Actions |
| :--- | :--- | :--- | :--- | :--- |
| **STOPPED** | `START` | Valid config | `WAITING` | Increment `timerGeneration`. Calculate `nextTriggerAt`. Persist state. Schedule wake alarm. |
| **WAITING** | `REMINDER_TRIGGER` | `event.gen == state.gen` $\land$ `!inQuietHours` $\land$ `isDayActive` | `ALERT_ACTIVE` | Generate `alertId`. Set `alertStartedAt = now`, `alertDeadlineAt = now + duration`. Show alert notification (1001). Schedule timeout alarm. |
| **WAITING** | `REMINDER_TRIGGER` | `event.gen == state.gen` $\land$ (`inQuietHours` $\lor$ `!isDayActive`) | `WAITING` | Re-calculate `nextTriggerAt` for next window. Persist. Reschedule wake alarm. |
| **WAITING** | `STOP` | `event.gen == state.gen` | `STOPPED` | Clear `nextTriggerAt`. Cancel wake alarm. Persist. |
| **ALERT_ACTIVE** | `ACKNOWLEDGE` | `event.gen == state.gen` $\land$ `event.alertId == state.alertId` | `WAITING` (or `STOPPED` if countdown) | Cancel timeout alarm. Cancel notification 1001. `todayAckCount++`. Clear `alertId`. Calculate `nextTriggerAt`. Reschedule wake alarm. |
| **ALERT_ACTIVE** | `LOG_DRINK` | `event.gen == state.gen` $\land$ `event.alertId == state.alertId` | `WAITING` (or `STOPPED` if countdown) | Cancel timeout alarm. Cancel notification 1001. `todayAckCount++`. `todayDrunkMl += intake`. Clear `alertId`. Calculate `nextTriggerAt`. Reschedule wake alarm. |
| **ALERT_ACTIVE** | `ALERT_TIMEOUT` | `event.gen == state.gen` $\land$ `event.alertId == state.alertId` | `WAITING` (or `STOPPED` if countdown) | Cancel notification 1001. `missedCount++`, `todayMissed++`. Post missed notification 1002. Clear `alertId`. Calculate `nextTriggerAt`. Reschedule wake alarm. |
| **ANY** | *ANY* | `event.gen != state.gen` | *NO CHANGE* | **STALE_GENERATION_DISCARDED** (0 side effects). |
| **WAITING** | `ACK/DRINK/TIMEOUT`| `state.state != ALERT_ACTIVE` | *NO CHANGE* | **STALE_ALERT_DISCARDED** (0 side effects). |
| **ALERT_ACTIVE** | Duplicate `ACK` | `state.alertId == null` $\lor$ `event.alertId != state.alertId` | *NO CHANGE* | **DUPLICATE_EVENT_DISCARDED** (0 side effects). |

---

## 21. Test Matrix

### 1. Normal Flow Tests (Domain Unit Tests)
- `test_start_timer_transitions_to_waiting_and_schedules_trigger`
- `test_reminder_trigger_transitions_to_alert_active_with_tokens`
- `test_acknowledge_resolves_alert_and_schedules_next_interval`
- `test_log_drink_resolves_alert_adds_water_and_schedules_next_interval`
- `test_alert_timeout_records_missed_alert_and_advances_interval`

### 2. Race Condition & Token Guard Tests
- `test_in_flight_timeout_after_acknowledge_is_discarded`
- `test_duplicate_acknowledge_intent_ignored`
- `test_stale_timer_generation_event_ignored_after_stop_restart`
- `test_out_of_order_notification_action_dropped_if_alert_already_resolved`

### 3. Lifecycle & Recovery Integration Tests
- `test_android_process_death_recovery_restores_waiting_state`
- `test_android_reboot_preserves_elapsed_interval_progress`
- `test_web_page_reload_recalculates_remaining_time_from_next_trigger_timestamp`

### 4. Scheduling & Configuration Tests
- `test_clock_aligned_mode_calculates_correct_slot_boundary`
- `test_quiet_hours_defers_reminder_trigger_to_end_of_quiet_period`
- `test_changing_interval_while_running_reschedules_next_trigger`

---

## 22. Current Risks / Technical Debt Catalog

| ID | Severity | Current Behavior | Why It Matters | Recommended Solution | Phase |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **TD-01** | **CRITICAL** | Broadcasts lack token verification | Race condition causes duplicate interval advancement and false missed alerts | Implement `timerGeneration` and `alertId` token validation in domain engine | Phase 2 / Phase 3 |
| **TD-02** | **HIGH** | Web timer state is in-memory relative seconds | Page reload or background tab throttling loses timer state and timing progress | Store canonical `nextTriggerAt` epoch timestamp in `localStorage` | Phase 3 |
| **TD-03** | **HIGH** | Android `BootReceiver` resets full interval from reboot time | Users lose progress made prior to device restart | Re-calculate remaining time from persisted `nextTriggerAt` | Phase 2 |
| **TD-04** | **MEDIUM** | Clock-aligned mode missing on Web | Platform divergence between Android and Web timer behavior | Port slot calculation rules into domain engine shared specification | Phase 3 |
| **TD-05** | **MEDIUM** | Direct coupling between `AlarmManager` and `ReminderReceiver` business logic | Hard to test state machine transitions without Android framework | Extract pure Kotlin `TimerDomainEngine` decoupled from Android context | Phase 2 |

---

## 23. Phase 2 Implementation Plan (Android)
*Goal: Implement domain state machine, token generation, and clean adapter architecture on Android.*

1. **Create `TimerDomainEngine.kt`:** Pure Kotlin domain FSM handling state, transitions, `timerGeneration`, and `alertId`.
2. **Update `TimerManager.kt`:** Persist canonical snapshot (`KEY_STATE`, `KEY_TIMER_GENERATION`, `KEY_ALERT_ID`, `KEY_NEXT_TRIGGER_TIMESTAMP`, `KEY_ALERT_DEADLINE_TIMESTAMP`).
3. **Update `ReminderReceiver.kt`:** Extract Intent extras (`EXTRA_TIMER_GENERATION`, `EXTRA_ALERT_ID`), pass to `TimerDomainEngine`, and delegate actions.
4. **Update `NotificationHelper.kt`:** Attach token extras to notification action `PendingIntent` instances.
5. **Update `BootReceiver.kt`:** Re-evaluate persisted `nextTriggerAt` against current time instead of resetting full interval.
6. **Add Unit & Integration Tests:** Test FSM transitions and stale event discarding in `android/app/src/test/`.

---

## 24. Phase 3 Implementation Plan (Web & Integration)
*Goal: Port domain state machine to React/TypeScript and verify cross-platform parity.*

1. **Create `src/domain/timerDomainEngine.ts`:** TypeScript state machine implementing identical transition matrix and token guards.
2. **Create `src/hooks/useTimer.ts`:** React hook providing authoritative state snapshot, derived `remainingSeconds`, and action dispatchers.
3. **Update `App.tsx`, `PhoneDashboard.tsx`, `CountdownView.tsx`:** Connect UI to `useTimer` hook; replace relative decrementing with epoch timestamp comparison.
4. **Persist State:** Save full `CanonicalTimerState` snapshot to `localStorage` (`hydro_timer_state_v3`).
5. **Cross-Platform Verification:** Execute test matrix across both platforms to confirm 100% behavioral equivalence.

---

## 25. File-Level Implementation Plan

| File Path | Current Responsibility | Proposed Change | Proposed Responsibility |
| :--- | :--- | :--- | :--- |
| `android/app/src/main/java/com/hydrotimer/app/TimerDomainEngine.kt` *(New)* | None | Create pure Kotlin FSM | Authoritative domain state machine logic & token validation |
| `android/app/src/main/java/com/hydrotimer/app/TimerManager.kt` | Direct SharedPreferences & AlarmManager scheduling | Refactor as state store adapter | Persists `CanonicalTimerState` and interacts with `AlarmManager` |
| `android/app/src/main/java/com/hydrotimer/app/ReminderReceiver.kt` | Unvalidated broadcast handling & inline logic | Parse tokens & pass to FSM | Event entry point forwarding validated intents to domain engine |
| `android/app/src/main/java/com/hydrotimer/app/NotificationHelper.kt` | Builds notifications | Embed `timerGeneration` & `alertId` in action intents | Notification builder with tokenized pending intents |
| `android/app/src/main/java/com/hydrotimer/app/BootReceiver.kt` | Re-schedules full interval on boot | Re-evaluates target timestamp | Restores timer state accurately after phone reboot |
| `src/domain/timerDomainEngine.ts` *(New)* | None | Create pure TS FSM | Authoritative Web state machine matching Kotlin specification |
| `src/hooks/useTimer.ts` *(New)* | None | Create React hook | React wrapper around domain FSM with local storage persistence |
| `src/App.tsx` | In-memory `setInterval` relative counter state | Connect to `useTimer` | App shell and state provider |
| `src/components/PhoneDashboard.tsx` | Mixed countdown & timer UI | Connect to domain state snapshot | Declarative UI renderer driven by domain snapshot |

---

## 26. Open Questions & Decisions Requiring Approval

1. **Clock-Aligned Mode on Web:** Should clock-aligned slot mode (e.g. aligning reminders to 10:00, 10:30) be enabled in the Web React UI as part of Phase 3 to match Android?
2. **Wear OS Data Sync Protocol:** For Wear OS / smartwatch companion integration, should the smartwatch receive the `alertId` and `timerGeneration` tokens over Bluetooth/DataLayer to allow direct acknowledgment from the wrist without race conditions?
3. **Missed Alert Notification Behavior:** Should missed alert notifications on Android remain visible until explicitly dismissed by the user, or automatically clear when the next reminder fires?
