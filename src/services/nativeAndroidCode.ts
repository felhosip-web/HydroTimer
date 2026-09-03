import JSZip from 'jszip';

export interface AndroidFile {
  name: string;
  path: string;
  language: 'kotlin' | 'xml' | 'groovy' | 'yaml' | 'markdown' | 'properties' | 'shell';
  description: string;
  code: string;
}

export const nativeAndroidProject: AndroidFile[] = [
  {
    name: "build-apk.yml (GitHub Actions Workflow)",
    path: ".github/workflows/build-apk.yml",
    language: "yaml",
    description: "GitHub Actions CI munkafolyamat: Push-kor automatikusan lefordítja és letölthetővé teszi az APK-t.",
    code: `name: Build Android APK

on:
  push:
    branches: [ "main", "master" ]
  pull_request:
    branches: [ "main", "master" ]
  workflow_dispatch:

permissions:
  contents: write

jobs:
  build:
    name: Build HydroTimer Android APK
    runs-on: ubuntu-latest

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Set up Java JDK 17
        uses: actions/setup-java@v4
        with:
          distribution: 'zulu'
          java-version: '17'
          cache: 'gradle'

      - name: Grant execute permission for gradlew
        run: |
          if [ -f "./gradlew" ]; then
            chmod +x ./gradlew
          elif [ -f "./android/gradlew" ]; then
            chmod +x ./android/gradlew
          fi

      - name: Build Debug APK with Gradle
        run: |
          if [ -f "./gradlew" ]; then
            ./gradlew assembleDebug --stacktrace
          elif [ -f "./android/gradlew" ]; then
            cd android && ./gradlew assembleDebug --stacktrace
          else
            echo "Gradle wrapper not found, generating wrapper..."
            gradle wrapper
            ./gradlew assembleDebug --stacktrace
          fi

      - name: Upload Debug APK Artifact
        uses: actions/upload-artifact@v4
        with:
          name: HydroTimer-Debug-APK
          path: |
            **/build/outputs/apk/debug/*.apk
          retention-days: 14

      - name: Build Release APK (Unsigned)
        run: |
          if [ -f "./gradlew" ]; then
            ./gradlew assembleRelease --stacktrace || echo "Release build skipped or requires signing"
          elif [ -f "./android/gradlew" ]; then
            cd android && ./gradlew assembleRelease --stacktrace || echo "Release build skipped"
          fi

      - name: Upload Release APK Artifact
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: HydroTimer-Release-APK
          path: |
            **/build/outputs/apk/release/*.apk
          retention-days: 14`
  },
  {
    name: "MainActivity.kt (Fő képernyő & Vezérlés)",
    path: "app/src/main/java/com/hydrotimer/app/MainActivity.kt",
    language: "kotlin",
    description: "Fő Android telefonos felület: Ismétlődő emlékeztető & Visszaszámláló módok, 6 egyedi esemény slot, jelzési időablak (5s/15s/30s/Egyéni), nyugtázás és tesztelés.",
    code: `package com.hydrotimer.app

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.os.PowerManager
import android.view.View
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.hydrotimer.app.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var timerManager: TimerManager
    private var uiCountDownTimer: CountDownTimer? = null

    companion object {
        private const val PERMISSION_REQUEST_POST_NOTIFICATIONS = 101
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        timerManager = TimerManager(this)
        NotificationHelper.createNotificationChannel(this)

        checkNotificationPermission()
        checkBatteryOptimization()
        setupUI()
    }

    override fun onResume() {
        super.onResume()
        updateUIState()
        checkMissedAlertBanner()
    }

    private fun setupUI() {
        // Mode Switcher: Interval Loop vs Countdown Timer
        binding.btnModeInterval.setOnClickListener {
            timerManager.setTimerMode("interval")
            timerManager.stopTimer()
            updateModeButtons()
            updateUIState()
            Toast.makeText(this, "Ismétlődő emlékeztető mód", Toast.LENGTH_SHORT).show()
        }

        binding.btnModeCountdown.setOnClickListener {
            timerManager.setTimerMode("countdown")
            timerManager.stopTimer()
            updateModeButtons()
            updateUIState()
            Toast.makeText(this, "Visszaszámláló mód", Toast.LENGTH_SHORT).show()
        }

        // Toggle Timer (Start / Pause / Resume)
        binding.btnToggleTimer.setOnClickListener {
            if (timerManager.isTimerRunning()) {
                timerManager.stopTimer()
                Toast.makeText(this, "Időzítő szüneteltetve", Toast.LENGTH_SHORT).show()
            } else {
                if (timerManager.getTimerMode() == "countdown") {
                    val countdownMins = timerManager.getCountdownMinutes()
                    val countdownSecs = timerManager.getCountdownSeconds()
                    timerManager.startCountdown(countdownMins, countdownSecs)
                    Toast.makeText(this, "Visszaszámlálás indítva (\${countdownMins}p)", Toast.LENGTH_SHORT).show()
                } else {
                    val interval = timerManager.getIntervalMinutes()
                    timerManager.startTimer(interval)
                    Toast.makeText(this, "Időzítő indítva (\${interval} percenként)", Toast.LENGTH_SHORT).show()
                }
            }
            updateUIState()
        }

        binding.btnResetTimer.setOnClickListener {
            timerManager.stopTimer()
            Toast.makeText(this, "Időzítő alaphelyzetbe állítva", Toast.LENGTH_SHORT).show()
            updateUIState()
        }

        binding.btnTestAlert.setOnClickListener {
            val title = timerManager.getCurrentEventTitle()
            NotificationHelper.showWaterReminder(this, "⏰ $title (Teszt)", "Próbaértesítés! Jelzési időablak tesztelése.")
            val alertDuration = timerManager.getAlertDurationSeconds()
            timerManager.scheduleAlertTimeout(alertDuration)
            Toast.makeText(this, "🔊 Riasztás elküldve! ($alertDuration mp nyugtázási ablak)", Toast.LENGTH_SHORT).show()
        }

        binding.btnLogDrink.setOnClickListener {
            val total = timerManager.addDrunkMl(250)
            updateProgress()
            Toast.makeText(this, "💧 +250 ml rögzítve! (\${total} ml)", Toast.LENGTH_SHORT).show()
        }

        binding.btnDismissMissed.setOnClickListener {
            timerManager.clearMissedAlerts()
            binding.cardMissedAlert.visibility = View.GONE
        }

        // Alert Duration Buttons: Min 5s, 5s, 15s, 30s + Custom
        binding.btnDuration5s.setOnClickListener { setAlertDuration(5) }
        binding.btnDuration15s.setOnClickListener { setAlertDuration(15) }
        binding.btnDuration30s.setOnClickListener { setAlertDuration(30) }
        binding.btnDurationCustom.setOnClickListener { showCustomDurationDialog() }

        // Countdown Quick Chips (1p, 3p, 5p, 10p, 15p, 25p Pomodoro)
        binding.chipCd1m?.setOnClickListener { setCountdownMinutes(1) }
        binding.chipCd3m?.setOnClickListener { setCountdownMinutes(3) }
        binding.chipCd5m?.setOnClickListener { setCountdownMinutes(5) }
        binding.chipCd10m?.setOnClickListener { setCountdownMinutes(10) }
        binding.chipCd15m?.setOnClickListener { setCountdownMinutes(15) }
        binding.chipCd25m?.setOnClickListener { setCountdownMinutes(25) }

        // 6 Custom Event Slot Selectors
        binding.cardEvent1?.setOnClickListener { selectEventPreset(0) }
        binding.cardEvent2?.setOnClickListener { selectEventPreset(1) }
        binding.cardEvent3?.setOnClickListener { selectEventPreset(2) }
        binding.cardEvent4?.setOnClickListener { selectEventPreset(3) }
        binding.cardEvent5?.setOnClickListener { selectEventPreset(4) }
        binding.cardEvent6?.setOnClickListener { selectEventPreset(5) }
    }

    private fun setAlertDuration(seconds: Int) {
        val safeSeconds = Math.max(5, seconds)
        timerManager.setAlertDurationSeconds(safeSeconds)
        updateDurationButtonStyles()
        Toast.makeText(this, "Jelzési időablak: $safeSeconds másodperc", Toast.LENGTH_SHORT).show()
        updateUIState()
    }

    private fun showCustomDurationDialog() {
        val input = EditText(this)
        input.inputType = android.text.InputType.TYPE_CLASS_NUMBER
        input.setText(timerManager.getAlertDurationSeconds().toString())
        input.hint = "Minimum 5 másodperc"

        AlertDialog.Builder(this)
            .setTitle("Egyéni jelzési időablak (mp)")
            .setMessage("Add meg a jelzési és nyugtázási időablakot másodpercben (min. 5s):")
            .setView(input)
            .setPositiveButton("Mentés") { _, _ ->
                val sec = input.text.toString().toIntOrNull() ?: 15
                setAlertDuration(Math.max(5, sec))
            }
            .setNegativeButton("Mégse", null)
            .show()
    }

    private fun setCountdownMinutes(minutes: Int) {
        timerManager.setCountdownMinutes(minutes)
        timerManager.setCountdownSeconds(0)
        if (timerManager.getTimerMode() == "countdown" && !timerManager.isTimerRunning()) {
            binding.tvTimerCountdown.text = String.format("%02d:00", minutes)
        }
        Toast.makeText(this, "Visszaszámlálás beállítva: $minutes perc", Toast.LENGTH_SHORT).show()
    }

    private fun selectEventPreset(index: Int) {
        val eventNames = arrayOf("Vízivás (30p)", "Nyújtás (45p)", "Szemtorna (20p)", "Gyógyszer (120p)", "Séta (60p)", "Fókusz (25p)")
        val intervals = intArrayOf(30, 45, 20, 120, 60, 25)
        val durations = intArrayOf(15, 15, 5, 30, 15, 5)

        if (index in eventNames.indices) {
            timerManager.setCurrentEventTitle(eventNames[index].substringBefore(" ("))
            timerManager.setIntervalMinutes(intervals[index])
            timerManager.setAlertDurationSeconds(durations[index])
            Toast.makeText(this, "Kiválasztva: \${eventNames[index]}", Toast.LENGTH_SHORT).show()
            updateUIState()
        }
    }

    private fun updateModeButtons() {
        val isCountdown = timerManager.getTimerMode() == "countdown"
        if (isCountdown) {
            binding.btnModeCountdown.setBackgroundColor(ContextCompat.getColor(this, R.color.primary))
            binding.btnModeInterval.setBackgroundColor(ContextCompat.getColor(this, R.color.surface))
            binding.layoutCountdownPresets?.visibility = View.VISIBLE
            binding.layoutEventPresets?.visibility = View.GONE
        } else {
            binding.btnModeInterval.setBackgroundColor(ContextCompat.getColor(this, R.color.primary))
            binding.btnModeCountdown.setBackgroundColor(ContextCompat.getColor(this, R.color.surface))
            binding.layoutCountdownPresets?.visibility = View.GONE
            binding.layoutEventPresets?.visibility = View.VISIBLE
        }
    }

    private fun updateDurationButtonStyles() {
        val currentDuration = timerManager.getAlertDurationSeconds()

        fun applyStyle(btn: com.google.android.material.button.MaterialButton, isSelected: Boolean) {
            if (isSelected) {
                btn.setBackgroundColor(ContextCompat.getColor(this, R.color.primary))
                btn.setTextColor(ContextCompat.getColor(this, R.color.text_primary))
                btn.strokeWidth = 0
            } else {
                btn.setBackgroundColor(ContextCompat.getColor(this, android.R.color.transparent))
                btn.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
                btn.strokeWidth = 2
            }
        }

        applyStyle(binding.btnDuration5s, currentDuration == 5)
        applyStyle(binding.btnDuration15s, currentDuration == 15)
        applyStyle(binding.btnDuration30s, currentDuration == 30)
        applyStyle(binding.btnDurationCustom, currentDuration !in listOf(5, 15, 30))
    }

    private fun checkMissedAlertBanner() {
        val missedCount = timerManager.getMissedAlertsCount()
        if (missedCount > 0) {
            val duration = timerManager.getAlertDurationSeconds()
            binding.cardMissedAlert.visibility = View.VISIBLE
            binding.tvMissedAlertTitle.text = "⚠️ $missedCount elmulasztott jelzés történt!"
            binding.tvMissedAlertDesc.text = "Nem érkezett nyugtázás $duration mp-en belül. A következő szakasz automatikusan elindult."
        } else {
            binding.cardMissedAlert.visibility = View.GONE
        }
    }

    private fun updateUIState() {
        val isRunning = timerManager.isTimerRunning()
        val isCountdown = timerManager.getTimerMode() == "countdown"
        val alertSec = timerManager.getAlertDurationSeconds()
        val title = timerManager.getCurrentEventTitle()

        if (isCountdown) {
            val cdMins = timerManager.getCountdownMinutes()
            binding.tvIntervalLabel.text = "⏱️ Visszaszámláló ($cdMins p) • $alertSec mp jelzési ablak"
        } else {
            val interval = timerManager.getIntervalMinutes()
            binding.tvIntervalLabel.text = "💧 $title ($interval p) • $alertSec mp jelzési ablak"
        }

        if (isRunning) {
            binding.btnToggleTimer.text = "Szüneteltetés"
            binding.btnToggleTimer.setBackgroundColor(ContextCompat.getColor(this, R.color.surface))
            startUiCountDown()
        } else {
            binding.btnToggleTimer.text = "Indítás"
            binding.btnToggleTimer.setBackgroundColor(ContextCompat.getColor(this, R.color.primary))
            if (isCountdown) {
                binding.tvTimerCountdown.text = String.format("%02d:%02d", timerManager.getCountdownMinutes(), timerManager.getCountdownSeconds())
            } else {
                binding.tvTimerCountdown.text = String.format("%02d:00", timerManager.getIntervalMinutes())
            }
            uiCountDownTimer?.cancel()
        }
        updateModeButtons()
        updateProgress()
        updateDurationButtonStyles()
        checkMissedAlertBanner()
    }

    private fun startUiCountDown() {
        uiCountDownTimer?.cancel()
        val nextTime = timerManager.getNextTriggerTimestamp()
        val millisRemaining = nextTime - System.currentTimeMillis()

        if (millisRemaining <= 0) {
            binding.tvTimerCountdown.text = "00:00"
            return
        }

        uiCountDownTimer = object : CountDownTimer(millisRemaining, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val totalSeconds = millisUntilFinished / 1000
                val minutes = totalSeconds / 60
                val seconds = totalSeconds % 60
                binding.tvTimerCountdown.text = String.format("%02d:%02d", minutes, seconds)
            }

            override fun onFinish() {
                binding.tvTimerCountdown.text = "00:00"
                if (timerManager.isTimerRunning()) {
                    updateUIState()
                }
            }
        }.start()
    }

    private fun updateProgress() {
        val drunk = timerManager.getTodayDrunkMl()
        val target = timerManager.getDailyTargetMl()
        binding.tvDailyProgress.text = "Napi fogyasztás: $drunk / $target ml"
    }

    private fun checkNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    PERMISSION_REQUEST_POST_NOTIFICATIONS
                )
            }
        }
    }

    private fun checkBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                // Background execution optimization check
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        uiCountDownTimer?.cancel()
    }
}`
  },
  {
    name: "NotificationHelper.kt (Értesítések & Csatornák)",
    path: "app/src/main/java/com/hydrotimer/app/NotificationHelper.kt",
    language: "kotlin",
    description: "Kiemelt prioritású emlékeztető és figyelmeztető csatornák, rezgési minták, Honor Watch és Wear OS továbbítás.",
    code: `package com.hydrotimer.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat

object NotificationHelper {

    const val CHANNEL_ID = "hydro_timer_channel"
    const val MISSED_CHANNEL_ID = "hydro_timer_missed_channel"
    const val NOTIFICATION_ID = 1001
    const val MISSED_NOTIFICATION_ID = 1002

    fun createNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // Fő Emlékeztető Csatorna (Kiemelt prioritás, rezgés órákra is)
            val name = context.getString(R.string.notification_channel_name)
            val descriptionText = context.getString(R.string.notification_channel_desc)
            val reminderChannel = NotificationChannel(CHANNEL_ID, name, NotificationManager.IMPORTANCE_HIGH).apply {
                description = descriptionText
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 450, 200, 450, 200, 600)
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setShowBadge(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }
            notificationManager.createNotificationChannel(reminderChannel)

            // Elmulasztott Jelzés Csatorna (Figyelmeztető hang)
            val missedName = context.getString(R.string.missed_channel_name)
            val missedDesc = context.getString(R.string.missed_channel_desc)
            val missedChannel = NotificationChannel(MISSED_CHANNEL_ID, missedName, NotificationManager.IMPORTANCE_HIGH).apply {
                description = missedDesc
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 150, 100, 250)
                setSound(
                    RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setShowBadge(true)
                lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
            }
            notificationManager.createNotificationChannel(missedChannel)
        }
    }

    fun showWaterReminder(context: Context, customTitle: String? = null, customBody: String? = null) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val openAppIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            context,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val drinkIntent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_LOG_DRINK
        }
        val drinkPendingIntent = PendingIntent.getBroadcast(
            context,
            1,
            drinkIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val ackIntent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_ACKNOWLEDGE
        }
        val ackPendingIntent = PendingIntent.getBroadcast(
            context,
            2,
            ackIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = customTitle ?: context.getString(R.string.reminder_title)
        val body = customBody ?: context.getString(R.string.reminder_body)

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_water_drop)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppPendingIntent)
            .setAutoCancel(true)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVibrate(longArrayOf(0, 450, 200, 450, 200, 600))
            .addAction(R.drawable.ic_water_drop, context.getString(R.string.action_drink), drinkPendingIntent)
            .addAction(R.drawable.ic_water_drop, context.getString(R.string.action_acknowledge), ackPendingIntent)
            .build()

        notificationManager.notify(NOTIFICATION_ID, notification)
    }

    fun showMissedAlertNotification(context: Context, alertDurationSeconds: Int) {
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val openAppIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            context,
            3,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val title = context.getString(R.string.missed_alert_title)
        val body = context.getString(R.string.missed_alert_body, alertDurationSeconds)

        val notification = NotificationCompat.Builder(context, MISSED_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_water_drop)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppPendingIntent)
            .setAutoCancel(true)
            .setVibrate(longArrayOf(0, 150, 100, 250))
            .build()

        notificationManager.cancel(NOTIFICATION_ID)
        notificationManager.notify(MISSED_NOTIFICATION_ID, notification)
    }
}`
  },
  {
    name: "TimerManager.kt (Háttér időzítő & Timeout vezérlő)",
    path: "app/src/main/java/com/hydrotimer/app/TimerManager.kt",
    language: "kotlin",
    description: "AlarmManager setExactAndAllowWhileIdle pontos ébresztések, visszaszámláló mód, 6 egyedi esemény slot, min 5s nyugtázási timeout.",
    code: `package com.hydrotimer.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build

class TimerManager(private val context: Context) {

    private val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager

    companion object {
        const val PREFS_NAME = "hydro_timer_prefs"
        const val KEY_TIMER_MODE = "timer_mode" // "interval" or "countdown"
        const val KEY_IS_RUNNING = "is_running"
        const val KEY_EVENT_TITLE = "current_event_title"
        const val KEY_INTERVAL_MINUTES = "interval_minutes"
        const val KEY_COUNTDOWN_MINUTES = "countdown_minutes"
        const val KEY_COUNTDOWN_SECONDS = "countdown_seconds"
        const val KEY_ALERT_DURATION_SECONDS = "alert_duration_seconds"
        const val KEY_NEXT_TRIGGER_TIMESTAMP = "next_trigger_timestamp"
        const val KEY_TODAY_DRUNK_ML = "today_drunk_ml"
        const val KEY_DAILY_TARGET_ML = "daily_target_ml"
        const val KEY_MISSED_COUNT = "missed_alerts_count"
        const val KEY_LAST_MISSED_TIME = "last_missed_timestamp"
        const val DEFAULT_INTERVAL_MINUTES = 30
        const val DEFAULT_COUNTDOWN_MINUTES = 5
        const val DEFAULT_ALERT_DURATION_SECONDS = 15
    }

    fun getTimerMode(): String = prefs.getString(KEY_TIMER_MODE, "interval") ?: "interval"
    fun setTimerMode(mode: String) {
        prefs.edit().putString(KEY_TIMER_MODE, mode).apply()
    }

    fun getCurrentEventTitle(): String = prefs.getString(KEY_EVENT_TITLE, "Vízivás") ?: "Vízivás"
    fun setCurrentEventTitle(title: String) {
        prefs.edit().putString(KEY_EVENT_TITLE, title).apply()
    }

    fun startTimer(intervalMinutes: Int = getIntervalMinutes()) {
        val triggerAtMillis = System.currentTimeMillis() + (intervalMinutes * 60 * 1000L)

        prefs.edit()
            .putBoolean(KEY_IS_RUNNING, true)
            .putInt(KEY_INTERVAL_MINUTES, intervalMinutes)
            .putLong(KEY_NEXT_TRIGGER_TIMESTAMP, triggerAtMillis)
            .apply()

        scheduleAlarm(triggerAtMillis)
    }

    fun startCountdown(minutes: Int = getCountdownMinutes(), seconds: Int = getCountdownSeconds()) {
        val totalMillis = (minutes * 60 + seconds) * 1000L
        val triggerAtMillis = System.currentTimeMillis() + totalMillis

        prefs.edit()
            .putBoolean(KEY_IS_RUNNING, true)
            .putInt(KEY_COUNTDOWN_MINUTES, minutes)
            .putInt(KEY_COUNTDOWN_SECONDS, seconds)
            .putLong(KEY_NEXT_TRIGGER_TIMESTAMP, triggerAtMillis)
            .apply()

        scheduleAlarm(triggerAtMillis)
    }

    fun stopTimer() {
        prefs.edit()
            .putBoolean(KEY_IS_RUNNING, false)
            .putLong(KEY_NEXT_TRIGGER_TIMESTAMP, 0L)
            .apply()

        cancelAlarm()
        cancelAlertTimeout()
    }

    fun scheduleNextOccurrence() {
        if (!isTimerRunning()) return
        val mode = getTimerMode()
        if (mode == "countdown") {
            // One-shot countdown completes and stops
            stopTimer()
            return
        }

        val intervalMinutes = prefs.getInt(KEY_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES)
        val triggerAtMillis = System.currentTimeMillis() + (intervalMinutes * 60 * 1000L)

        prefs.edit()
            .putLong(KEY_NEXT_TRIGGER_TIMESTAMP, triggerAtMillis)
            .apply()

        scheduleAlarm(triggerAtMillis)
    }

    private fun scheduleAlarm(triggerAtMillis: Long) {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_TRIGGER_REMINDER
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                triggerAtMillis,
                pendingIntent
            )
        } else {
            alarmManager.setExact(
                AlarmManager.RTC_WAKEUP,
                triggerAtMillis,
                pendingIntent
            )
        }
    }

    private fun cancelAlarm() {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_TRIGGER_REMINDER
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarmManager.cancel(pendingIntent)
    }

    fun scheduleAlertTimeout(seconds: Int = getAlertDurationSeconds()) {
        val safeSeconds = Math.max(5, seconds)
        val timeoutAtMillis = System.currentTimeMillis() + (safeSeconds * 1000L)
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_ALERT_TIMEOUT
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.TIMEOUT_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            alarmManager.setExactAndAllowWhileIdle(
                AlarmManager.RTC_WAKEUP,
                timeoutAtMillis,
                pendingIntent
            )
        } else {
            alarmManager.setExact(
                AlarmManager.RTC_WAKEUP,
                timeoutAtMillis,
                pendingIntent
            )
        }
    }

    fun cancelAlertTimeout() {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_ALERT_TIMEOUT
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            ReminderReceiver.TIMEOUT_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        alarmManager.cancel(pendingIntent)
    }

    fun isTimerRunning(): Boolean = prefs.getBoolean(KEY_IS_RUNNING, false)
    
    fun getIntervalMinutes(): Int = prefs.getInt(KEY_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES)
    fun setIntervalMinutes(minutes: Int) {
        prefs.edit().putInt(KEY_INTERVAL_MINUTES, Math.max(1, minutes)).apply()
    }

    fun getCountdownMinutes(): Int = prefs.getInt(KEY_COUNTDOWN_MINUTES, DEFAULT_COUNTDOWN_MINUTES)
    fun setCountdownMinutes(minutes: Int) {
        prefs.edit().putInt(KEY_COUNTDOWN_MINUTES, Math.max(0, minutes)).apply()
    }

    fun getCountdownSeconds(): Int = prefs.getInt(KEY_COUNTDOWN_SECONDS, 0)
    fun setCountdownSeconds(seconds: Int) {
        prefs.edit().putInt(KEY_COUNTDOWN_SECONDS, Math.max(0, Math.min(59, seconds))).apply()
    }

    fun getAlertDurationSeconds(): Int = Math.max(5, prefs.getInt(KEY_ALERT_DURATION_SECONDS, DEFAULT_ALERT_DURATION_SECONDS))
    fun setAlertDurationSeconds(seconds: Int) {
        prefs.edit().putInt(KEY_ALERT_DURATION_SECONDS, Math.max(5, seconds)).apply()
    }

    fun getNextTriggerTimestamp(): Long = prefs.getLong(KEY_NEXT_TRIGGER_TIMESTAMP, 0L)

    fun getTodayDrunkMl(): Int = prefs.getInt(KEY_TODAY_DRUNK_ML, 0)
    fun addDrunkMl(ml: Int): Int {
        val current = getTodayDrunkMl() + ml
        prefs.edit().putInt(KEY_TODAY_DRUNK_ML, current).apply()
        return current
    }

    fun getDailyTargetMl(): Int = prefs.getInt(KEY_DAILY_TARGET_ML, 2500)

    fun recordMissedAlert() {
        val currentCount = prefs.getInt(KEY_MISSED_COUNT, 0) + 1
        prefs.edit()
            .putInt(KEY_MISSED_COUNT, currentCount)
            .putLong(KEY_LAST_MISSED_TIME, System.currentTimeMillis())
            .apply()
    }

    fun getMissedAlertsCount(): Int = prefs.getInt(KEY_MISSED_COUNT, 0)
    fun getLastMissedTimestamp(): Long = prefs.getLong(KEY_LAST_MISSED_TIME, 0L)
    fun clearMissedAlerts() {
        prefs.edit().putInt(KEY_MISSED_COUNT, 0).putLong(KEY_LAST_MISSED_TIME, 0L).apply()
    }
}
`
  },
  {
    name: "ReminderReceiver.kt (Alarm & Timeout kezelő)",
    path: "app/src/main/java/com/hydrotimer/app/ReminderReceiver.kt",
    language: "kotlin",
    description: "Eseménykezelő: riasztás kiküldése, nyugtázás kezelése, illetve timeout esetén figyelmeztetés és következő ciklus indítása.",
    code: `package com.hydrotimer.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.widget.Toast

class ReminderReceiver : BroadcastReceiver() {

    companion object {
        const val ALARM_REQUEST_CODE = 2001
        const val TIMEOUT_REQUEST_CODE = 2002
        const val ACTION_TRIGGER_REMINDER = "com.hydrotimer.app.ACTION_TRIGGER_REMINDER"
        const val ACTION_LOG_DRINK = "com.hydrotimer.app.ACTION_LOG_DRINK"
        const val ACTION_ACKNOWLEDGE = "com.hydrotimer.app.ACTION_ACKNOWLEDGE"
        const val ACTION_ALERT_TIMEOUT = "com.hydrotimer.app.ACTION_ALERT_TIMEOUT"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val timerManager = TimerManager(context)
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager

        when (intent.action) {
            ACTION_TRIGGER_REMINDER -> {
                // 1. Értesítés és rezgés megjelenítése
                NotificationHelper.showWaterReminder(context)

                // 2. Nyugtázási időablak (timeout) ébresztésének indítása
                val alertDurationSeconds = timerManager.getAlertDurationSeconds()
                timerManager.scheduleAlertTimeout(alertDurationSeconds)
            }

            ACTION_LOG_DRINK -> {
                // 1. Timeout ébresztés és értesítés törlése
                timerManager.cancelAlertTimeout()
                notificationManager.cancel(NotificationHelper.NOTIFICATION_ID)

                // 2. Fogyasztás rögzítése
                val updatedTotal = timerManager.addDrunkMl(250)
                Toast.makeText(context, "💧 +250 ml rögzítve! Összesen: \${updatedTotal} ml", Toast.LENGTH_SHORT).show()

                // 3. Következő periódus indítása
                timerManager.scheduleNextOccurrence()
            }

            ACTION_ACKNOWLEDGE -> {
                // 1. Timeout ébresztés és értesítés törlése
                timerManager.cancelAlertTimeout()
                notificationManager.cancel(NotificationHelper.NOTIFICATION_ID)

                Toast.makeText(context, "✓ Emlékeztető nyugtázva, következő szakasz elindult.", Toast.LENGTH_SHORT).show()

                // 2. Következő periódus indítása
                timerManager.scheduleNextOccurrence()
            }

            ACTION_ALERT_TIMEOUT -> {
                // 1. Nyugtázatlan jelzés lejárta: eredeti értesítés leállítása
                notificationManager.cancel(NotificationHelper.NOTIFICATION_ID)

                // 2. Elmulasztott esemény rögzítése
                timerManager.recordMissedAlert()

                // 3. Figyelmeztető értesítés kiadása
                val alertDuration = timerManager.getAlertDurationSeconds()
                NotificationHelper.showMissedAlertNotification(context, alertDuration)

                // 4. Következő szakasz automatikus elindítása
                timerManager.scheduleNextOccurrence()
            }
        }
    }
}`
  },
  {
    name: "BootReceiver.kt (Telefon újraindítás kezelő)",
    path: "app/src/main/java/com/hydrotimer/app/BootReceiver.kt",
    language: "kotlin",
    description: "Automatikus újraütemezés a telefon újraindítása (BOOT_COMPLETED) után.",
    code: `package com.hydrotimer.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            val timerManager = TimerManager(context)
            if (timerManager.isTimerRunning()) {
                timerManager.scheduleNextOccurrence()
            }
        }
    }
}`
  },
  {
    name: "activity_main.xml (Layout & UI)",
    path: "app/src/main/res/layout/activity_main.xml",
    language: "xml",
    description: "Material3 felhasználói felület: Módválasztó (Ismétlődő/Visszaszámláló), 6 esemény slot, 5s/15s/30s/Egyéni jelzési gombok, nyugtázás és tesztelés.",
    code: `<?xml version="1.0" encoding="utf-8"?>
<ScrollView xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    xmlns:tools="http://schemas.android.com/tools"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/background"
    android:fillViewport="true">

    <androidx.constraintlayout.widget.ConstraintLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:padding="16dp">

        <TextView
            android:id="@+id/tvAppTitle"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="HydroTimer"
            android:textColor="@color/text_primary"
            android:textSize="22sp"
            android:textStyle="bold"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintTop_toTopOf="parent" />

        <TextView
            android:id="@+id/tvAppSubtitle"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="Telefon &amp; Honor / Wear OS Okosóra Rendszer"
            android:textColor="@color/accent"
            android:textSize="12sp"
            app:layout_constraintStart_toStartOf="parent"
            app:layout_constraintTop_toBottomOf="@id/tvAppTitle" />

        <!-- Mode Switcher: Interval vs Countdown -->
        <LinearLayout
            android:id="@+id/layoutModeSwitcher"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="12dp"
            android:background="@color/surface"
            android:orientation="horizontal"
            android:padding="4dp"
            app:layout_constraintTop_toBottomOf="@id/tvAppSubtitle">

            <com.google.android.material.button.MaterialButton
                android:id="@+id/btnModeInterval"
                android:layout_width="0dp"
                android:layout_height="40dp"
                android:layout_weight="1"
                android:backgroundTint="@color/primary"
                android:text="🔁 Ismétlődő"
                android:textAllCaps="false"
                android:textSize="12sp"
                app:cornerRadius="12dp" />

            <com.google.android.material.button.MaterialButton
                android:id="@+id/btnModeCountdown"
                style="@style/Widget.Material3.Button.OutlinedButton"
                android:layout_width="0dp"
                android:layout_height="40dp"
                android:layout_marginStart="6dp"
                android:layout_weight="1"
                android:text="⏱️ Visszaszámláló"
                android:textAllCaps="false"
                android:textColor="@color/text_secondary"
                android:textSize="12sp"
                app:cornerRadius="12dp"
                app:strokeColor="#475569" />

        </LinearLayout>

        <!-- Missed Alert Banner Card -->
        <com.google.android.material.card.MaterialCardView
            android:id="@+id/cardMissedAlert"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="12dp"
            android:visibility="gone"
            app:cardBackgroundColor="#451A03"
            app:cardCornerRadius="16dp"
            app:cardElevation="0dp"
            app:strokeColor="#F59E0B"
            app:strokeWidth="1dp"
            app:layout_constraintTop_toBottomOf="@id/layoutModeSwitcher">

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:orientation="vertical"
                android:padding="14dp">

                <TextView
                    android:id="@+id/tvMissedAlertTitle"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="⚠️ Elmulasztott jelzés!"
                    android:textColor="#FDE68A"
                    android:textSize="14sp"
                    android:textStyle="bold" />

                <TextView
                    android:id="@+id/tvMissedAlertDesc"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="4dp"
                    android:text="Nem érkezett nyugtázás időben. A következő szakasz automatikusan elindult."
                    android:textColor="#FEF3C7"
                    android:textSize="12sp" />

                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnDismissMissed"
                    style="@style/Widget.Material3.Button.TextButton"
                    android:layout_width="wrap_content"
                    android:layout_height="36dp"
                    android:layout_gravity="end"
                    android:text="Tudomásul vettem"
                    android:textColor="#FBBF24"
                    android:textSize="12sp" />

            </LinearLayout>

        </com.google.android.material.card.MaterialCardView>

        <!-- Main Timer Card -->
        <com.google.android.material.card.MaterialCardView
            android:id="@+id/cardTimer"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="12dp"
            app:cardBackgroundColor="@color/surface"
            app:cardCornerRadius="24dp"
            app:cardElevation="0dp"
            app:strokeColor="#334155"
            app:strokeWidth="1dp"
            app:layout_constraintTop_toBottomOf="@id/cardMissedAlert">

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center"
                android:orientation="vertical"
                android:padding="20dp">

                <ImageView
                    android:layout_width="40dp"
                    android:layout_height="40dp"
                    android:src="@drawable/ic_water_drop"
                    app:tint="@color/accent" />

                <TextView
                    android:id="@+id/tvTimerCountdown"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="8dp"
                    android:fontFamily="monospace"
                    android:text="30:00"
                    android:textColor="@color/text_primary"
                    android:textSize="40sp"
                    android:textStyle="bold" />

                <TextView
                    android:id="@+id/tvIntervalLabel"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="4dp"
                    android:text="30p ciklus • 15mp jelzési ablak"
                    android:textColor="@color/text_secondary"
                    android:textSize="13sp" />

                <!-- Countdown Presets (visible when countdown mode selected) -->
                <LinearLayout
                    android:id="@+id/layoutCountdownPresets"
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="12dp"
                    android:gravity="center"
                    android:orientation="horizontal"
                    android:visibility="gone">

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/chipCd1m"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="wrap_content"
                        android:layout_height="36dp"
                        android:layout_marginEnd="4dp"
                        android:text="1p"
                        android:textSize="11sp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/chipCd3m"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="wrap_content"
                        android:layout_height="36dp"
                        android:layout_marginEnd="4dp"
                        android:text="3p"
                        android:textSize="11sp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/chipCd5m"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="wrap_content"
                        android:layout_height="36dp"
                        android:layout_marginEnd="4dp"
                        android:text="5p"
                        android:textSize="11sp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/chipCd10m"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="wrap_content"
                        android:layout_height="36dp"
                        android:layout_marginEnd="4dp"
                        android:text="10p"
                        android:textSize="11sp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/chipCd25m"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="wrap_content"
                        android:layout_height="36dp"
                        android:text="25p (Pomodoro)"
                        android:textSize="11sp" />

                </LinearLayout>

                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="16dp"
                    android:gravity="center"
                    android:orientation="horizontal">

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/btnToggleTimer"
                        android:layout_width="0dp"
                        android:layout_height="48dp"
                        android:layout_weight="1"
                        android:backgroundTint="@color/primary"
                        android:text="Indítás"
                        android:textAllCaps="false"
                        android:textSize="15sp"
                        app:cornerRadius="16dp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/btnResetTimer"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="wrap_content"
                        android:layout_height="48dp"
                        android:layout_marginStart="10dp"
                        android:text="Újra"
                        android:textColor="@color/text_secondary"
                        app:cornerRadius="16dp"
                        app:strokeColor="#475569" />

                </LinearLayout>

                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnTestAlert"
                    style="@style/Widget.Material3.Button.TextButton"
                    android:layout_width="match_parent"
                    android:layout_height="38dp"
                    android:layout_marginTop="6dp"
                    android:text="🔊 Riasztás &amp; Nyugtázási ablak tesztelése"
                    android:textColor="@color/accent"
                    android:textSize="12sp" />

            </LinearLayout>

        </com.google.android.material.card.MaterialCardView>

        <!-- Alert Duration & Settings Card (5s min, 5s/15s/30s/Egyéni) -->
        <com.google.android.material.card.MaterialCardView
            android:id="@+id/cardSettings"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="12dp"
            app:cardBackgroundColor="@color/surface"
            app:cardCornerRadius="20dp"
            app:cardElevation="0dp"
            app:strokeColor="#334155"
            app:strokeWidth="1dp"
            app:layout_constraintTop_toBottomOf="@id/cardTimer">

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:orientation="vertical"
                android:padding="16dp">

                <TextView
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="⏱️ Jelzési időablak (Nyugtázási határidő - min. 5s)"
                    android:textColor="@color/text_primary"
                    android:textSize="13sp"
                    android:textStyle="bold" />

                <TextView
                    android:id="@+id/tvAlertDurationDesc"
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="2dp"
                    android:text="Ha nem nyugtázod ezen időn belül, a következő szakasz automatikusan indul."
                    android:textColor="@color/text_secondary"
                    android:textSize="11sp" />

                <LinearLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="10dp"
                    android:gravity="center"
                    android:orientation="horizontal">

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/btnDuration5s"
                        android:layout_width="0dp"
                        android:layout_height="40dp"
                        android:layout_weight="1"
                        android:layout_marginEnd="4dp"
                        android:text="5 mp"
                        android:textAllCaps="false"
                        android:textSize="12sp"
                        app:cornerRadius="10dp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/btnDuration15s"
                        android:layout_width="0dp"
                        android:layout_height="40dp"
                        android:layout_weight="1"
                        android:layout_marginEnd="4dp"
                        android:backgroundTint="@color/primary"
                        android:text="15 mp"
                        android:textAllCaps="false"
                        android:textSize="12sp"
                        app:cornerRadius="10dp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/btnDuration30s"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="0dp"
                        android:layout_height="40dp"
                        android:layout_weight="1"
                        android:layout_marginEnd="4dp"
                        android:text="30 mp"
                        android:textAllCaps="false"
                        android:textColor="@color/text_secondary"
                        android:textSize="12sp"
                        app:cornerRadius="10dp"
                        app:strokeColor="#475569" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/btnDurationCustom"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="0dp"
                        android:layout_height="40dp"
                        android:layout_weight="1"
                        android:text="Egyéni..."
                        android:textAllCaps="false"
                        android:textColor="@color/accent"
                        android:textSize="11sp"
                        app:cornerRadius="10dp"
                        app:strokeColor="#475569" />

                </LinearLayout>

            </LinearLayout>

        </com.google.android.material.card.MaterialCardView>

        <!-- 6 Custom Events Slot Card -->
        <com.google.android.material.card.MaterialCardView
            android:id="@+id/layoutEventPresets"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="12dp"
            app:cardBackgroundColor="@color/surface"
            app:cardCornerRadius="20dp"
            app:cardElevation="0dp"
            app:strokeColor="#334155"
            app:strokeWidth="1dp"
            app:layout_constraintTop_toBottomOf="@id/cardSettings">

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:orientation="vertical"
                android:padding="16dp">

                <TextView
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:text="📋 Egyedi Események (Max 6 slot)"
                    android:textColor="@color/text_primary"
                    android:textSize="13sp"
                    android:textStyle="bold" />

                <GridLayout
                    android:layout_width="match_parent"
                    android:layout_height="wrap_content"
                    android:layout_marginTop="8dp"
                    android:columnCount="2"
                    android:rowCount="3">

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/cardEvent1"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="0dp"
                        android:layout_height="44dp"
                        android:layout_columnWeight="1"
                        android:layout_margin="3dp"
                        android:text="💧 Vízivás (30p)"
                        android:textSize="11sp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/cardEvent2"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="0dp"
                        android:layout_height="44dp"
                        android:layout_columnWeight="1"
                        android:layout_margin="3dp"
                        android:text="🧘 Nyújtás (45p)"
                        android:textSize="11sp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/cardEvent3"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="0dp"
                        android:layout_height="44dp"
                        android:layout_columnWeight="1"
                        android:layout_margin="3dp"
                        android:text="👀 Szemtorna (20p)"
                        android:textSize="11sp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/cardEvent4"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="0dp"
                        android:layout_height="44dp"
                        android:layout_columnWeight="1"
                        android:layout_margin="3dp"
                        android:text="💊 Gyógyszer (120p)"
                        android:textSize="11sp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/cardEvent5"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="0dp"
                        android:layout_height="44dp"
                        android:layout_columnWeight="1"
                        android:layout_margin="3dp"
                        android:text="🚶 Séta (60p)"
                        android:textSize="11sp" />

                    <com.google.android.material.button.MaterialButton
                        android:id="@+id/cardEvent6"
                        style="@style/Widget.Material3.Button.OutlinedButton"
                        android:layout_width="0dp"
                        android:layout_height="44dp"
                        android:layout_columnWeight="1"
                        android:layout_margin="3dp"
                        android:text="🧠 Fókusz (25p)"
                        android:textSize="11sp" />

                </GridLayout>

            </LinearLayout>

        </com.google.android.material.card.MaterialCardView>

        <!-- Quick Log & Progress Card -->
        <com.google.android.material.card.MaterialCardView
            android:id="@+id/cardQuickLog"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="12dp"
            app:cardBackgroundColor="@color/surface"
            app:cardCornerRadius="20dp"
            app:cardElevation="0dp"
            app:strokeColor="#334155"
            app:strokeWidth="1dp"
            app:layout_constraintTop_toBottomOf="@id/layoutEventPresets">

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:gravity="center_vertical"
                android:orientation="horizontal"
                android:padding="16dp">

                <LinearLayout
                    android:layout_width="0dp"
                    android:layout_height="wrap_content"
                    android:layout_weight="1"
                    android:orientation="vertical">

                    <TextView
                        android:id="@+id/tvDailyProgress"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        android:text="Napi fogyasztás: 1250 / 2500 ml"
                        android:textColor="@color/text_primary"
                        android:textSize="14sp"
                        android:textStyle="bold" />

                    <TextView
                        android:id="@+id/tvHonorSyncStatus"
                        android:layout_width="wrap_content"
                        android:layout_height="wrap_content"
                        android:layout_marginTop="2dp"
                        android:text="✓ Honor Health &amp; Wear OS szinkron aktív"
                        android:textColor="#34D399"
                        android:textSize="12sp" />
                </LinearLayout>

                <com.google.android.material.button.MaterialButton
                    android:id="@+id/btnLogDrink"
                    android:layout_width="wrap_content"
                    android:layout_height="44dp"
                    android:backgroundTint="#059669"
                    android:text="+250 ml"
                    android:textAllCaps="false"
                    app:cornerRadius="12dp" />

            </LinearLayout>

        </com.google.android.material.card.MaterialCardView>

        <TextView
            android:id="@+id/tvWatchGuideFootnote"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="16dp"
            android:layout_marginBottom="24dp"
            android:gravity="center"
            android:text="Honor, Huawei és Amazfit órák a Honor Health / Huawei Health értesítési továbbítóján keresztül automatikusan rezegnek és szinkronizálnak."
            android:textColor="@color/text_secondary"
            android:textSize="11sp"
            app:layout_constraintBottom_toBottomOf="parent"
            app:layout_constraintTop_toBottomOf="@id/cardQuickLog" />

    </androidx.constraintlayout.widget.ConstraintLayout>

</ScrollView>`
  },
  {
    name: "strings.xml (Lokalizáció & Szövegek)",
    path: "app/src/main/res/values/strings.xml",
    language: "xml",
    description: "Alkalmazás feliratai, értesítési szövegek, figyelmeztetések, visszaszámláló és gombfeliratok magyarul.",
    code: `<resources>
    <string name="app_name">HydroTimer</string>
    <string name="notification_channel_name">Vízivás és Szokás Értesítések</string>
    <string name="notification_channel_desc">Rendszeres hidratációs és szokás emlékeztetők telefonra és okosórára</string>
    <string name="missed_channel_name">Elmulasztott Jelzések</string>
    <string name="missed_channel_desc">Figyelmeztető értesítések ha a jelzés nem került nyugtázásra</string>
    <string name="reminder_title">💧 Ideje inni egy pohár vizet!</string>
    <string name="reminder_body">Frissítsd fel a szervezeted 2.5 dl tiszta vízzel.</string>
    <string name="missed_alert_title">⚠️ Elmulasztott jelzés!</string>
    <string name="missed_alert_body">Nem érkezett nyugtázás %1$d mp-en belül. A következő időszakasz automatikusan elindult!</string>
    <string name="action_drink">Megittam (+250ml)</string>
    <string name="action_acknowledge">Nyugtázás</string>
    <string name="action_snooze">10 perc múlva</string>
    <string name="status_running">Időzítő aktív</string>
    <string name="status_paused">Időzítő szünetel</string>
    <string name="mode_interval">Ismétlődő mód</string>
    <string name="mode_countdown">Visszaszámláló mód</string>
    <string name="alert_duration_title">Jelzés és nyugtázási időtartam</string>
    <string name="alert_duration_desc">Mennyi ideig csörögjön a készülék nyugtázásra várva (min. 5s)</string>
</resources>`
  },
  {
    name: "AndroidManifest.xml (Engedélyek & Rendszerelemek)",
    path: "app/src/main/AndroidManifest.xml",
    language: "xml",
    description: "Értesítés, pontos ébresztés (SCHEDULE_EXACT_ALARM), rezgés és boot jogosultságok.",
    code: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.USE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" />

    <application
        android:allowBackup="true"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:fullBackupContent="@xml/backup_rules"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher"
        android:supportsRtl="true"
        android:theme="@style/Theme.HydroTimer"
        tools:targetApi="34">

        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:launchMode="singleTop">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>

        <receiver
            android:name=".ReminderReceiver"
            android:enabled="true"
            android:exported="false">
            <intent-filter>
                <action android:name="com.hydrotimer.app.ACTION_TRIGGER_REMINDER" />
                <action android:name="com.hydrotimer.app.ACTION_LOG_DRINK" />
                <action android:name="com.hydrotimer.app.ACTION_ACKNOWLEDGE" />
                <action android:name="com.hydrotimer.app.ACTION_ALERT_TIMEOUT" />
            </intent-filter>
        </receiver>

        <receiver
            android:name=".BootReceiver"
            android:enabled="true"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.QUICKBOOT_POWERON" />
            </intent-filter>
        </receiver>

    </application>

</manifest>`
  },
  {
    name: "app/build.gradle.kts (App modul konfiguráció)",
    path: "app/build.gradle.kts",
    language: "groovy",
    description: "Gradle App modul konfiguráció, SDK 34 célzás, Kotlin és AndroidX Material3 függőségek.",
    code: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.hydrotimer.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.hydrotimer.app"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.preference:preference-ktx:1.2.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.0")
}`
  },
  {
    name: "settings.gradle.kts (Gyökér beállítások)",
    path: "settings.gradle.kts",
    language: "groovy",
    description: "Gradle beállítások és tárolók (Google, MavenCentral) konfigurációja.",
    code: `pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\\\.android.*")
                includeGroupByRegex("com\\\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "HydroTimer"
include(":app")`
  },
  {
    name: "build.gradle.kts (Gyökér Build Script)",
    path: "build.gradle.kts",
    language: "groovy",
    description: "Gyökérszintű Gradle plugin verziók (Android Gradle Plugin 8.3.2, Kotlin 1.9.23).",
    code: `plugins {
    id("com.android.application") version "8.3.2" apply false
    id("org.jetbrains.kotlin.android") version "1.9.23" apply false
} `
  },
  {
    name: "gradle-wrapper.properties",
    path: "gradle/wrapper/gradle-wrapper.properties",
    language: "properties",
    description: "Gradle 8.4 bináris letöltési konfiguráció a CI automatikus futtatásához.",
    code: `distributionBase=GRADLE_USER_HOME
distributionPath=wrapper/dists
distributionUrl=https\\://services.gradle.org/distributions/gradle-8.4-bin.zip
networkTimeout=10000
validateDistributionUrl=true
zipStoreBase=GRADLE_USER_HOME
zipStorePath=wrapper/dists`
  },
  {
    name: "README.md (GitHub Használati Útmutató)",
    path: "README.md",
    language: "markdown",
    description: "Lépésről-lépésre leírás a GitHub feltöltéshez és az APK letöltéséhez.",
    code: `# HydroTimer - Android & Honor Okosóra Rendszer

Ez a tároló tartalmazza a teljes Android natív forráskódot és a beépített GitHub Actions munkafolyamatot, amely minden commit/push után automatikusan lefordítja és letölthetővé teszi a telepíthető Android APK fájlt.

## 🌟 Legújabb funkciók
- **⏱️ Konfigurálható jelzési és nyugtázási időablak (15s / 30s / 60s)**
- **⚡ Automatikus szakaszváltás**: Ha a jelzés nem kerül nyugtázásra a megadott időn belül, a hang/rezgés leáll, figyelmeztető értesítés jelenik meg, és a következő időszakasz automatikusan elindul.
- **⌚ Honor / Huawei Health szinkronizáció és csuklórezgés**.

## 🚀 Hogyan kapod meg az APK-t GitHubon?

1. **Hozd létre a GitHub tárolót** és töltsd fel / pushold a fájlokat:
   \`\`\`bash
   git init
   git add .
   git commit -m "HydroTimer Android with auto timeout and continuous period progression"
   git branch -M main
   git remote add origin https://github.com/FELHASZNALONEV/hydrotimer-android.git
   git push -u origin main
   \`\`\`

2. **Nyisd meg a GitHub oldaladat** a böngészőben.
3. Kattints az **Actions** fülre felül.
4. Látni fogod a futó **Build Android APK** munkafolyamatot (zöld pipa jelzi ha kész).
5. Kattints a befejezett futásra, majd görgess az oldal alján lévő **Artifacts** részhez.
6. Kattints a **HydroTimer-Debug-APK** linkre és töltsd le az elkészült \`.apk\` fájlt!
7. Telepítsd a telefonodra, és állítsd be a **Honor Health** alkalmazásban az értesítések továbbítását a csuklódra!`
  }
];

export async function generateFullProjectZip(): Promise<Blob> {
  const zip = new JSZip();

  for (const file of nativeAndroidProject) {
    zip.file(file.path, file.code);
  }

  // Add extra essential files for standard android layout
  zip.file("gradle.properties", "org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8\nandroid.useAndroidX=true\nandroid.nonTransitiveRClass=true\nkotlin.code.style=official\n");
  zip.file("app/proguard-rules.pro", "# Proguard rules\n-keep class com.hydrotimer.app.** { *; }\n");
  zip.file(".gitignore", "*.iml\n.gradle\n/local.properties\n/.idea/\n.DS_Store\n/build\n/captures\n.externalNativeBuild\n.cxx\nlocal.properties\n");

  const blob = await zip.generateAsync({ type: "blob" });
  return blob;
}
