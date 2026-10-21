package com.hydrotimer.app

import android.Manifest
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.os.PowerManager
import android.view.LayoutInflater
import android.view.View
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.hydrotimer.app.databinding.ActivityMainBinding
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var timerManager: TimerManager
    private lateinit var eventRepository: HydrationEventRepository

    private var uiCountDownTimer: CountDownTimer? = null
    private var selectedEventDate: LocalDate = LocalDate.now()
    private var activeEventsQueryToken: Long = 0L
    private var currentSubTab: String = "stats"

    var queryExecutor: java.util.concurrent.ExecutorService = java.util.concurrent.Executors.newSingleThreadExecutor()

    private val prefChangeListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == TimerManager.KEY_STATE ||
            key == TimerManager.KEY_TIMER_GENERATION ||
            key == TimerManager.KEY_ALERT_ID ||
            key == TimerManager.KEY_NEXT_TRIGGER_TIMESTAMP ||
            key == TimerManager.KEY_TODAY_DRUNK_ML ||
            key == TimerManager.KEY_TODAY_MISSED_COUNT ||
            key == TimerManager.KEY_TODAY_ACK_COUNT ||
            key == TimerManager.KEY_IS_RUNNING) {
            runOnUiThread {
                updateUIState()
            }
        }
    }

    companion object {
        private const val PERMISSION_REQUEST_POST_NOTIFICATIONS = 101
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        timerManager = TimerManager(this)
        eventRepository = HydrationEventRepository(HydrationEventDatabaseHelper(this))

        NotificationHelper.createNotificationChannel(this)
        timerManager.getPrefs().registerOnSharedPreferenceChangeListener(prefChangeListener)

        checkNotificationPermission()
        checkBatteryOptimization()
        setupUI()
        updateDateHeaderUI()
    }

    override fun onResume() {
        super.onResume()
        timerManager.dispatch(TimerEvent(TimerEventType.RECOVER, timestamp = System.currentTimeMillis()))
        updateUIState()
        checkMissedAlertBanner()
        updateDateHeaderUI()
        if (currentSubTab == "events") {
            loadEventsForSelectedDate()
        }
    }

    private fun setupUI() {
        binding.btnToggleTimer.setOnClickListener {
            if (timerManager.isTimerRunning()) {
                timerManager.stopTimer()
                Toast.makeText(this, "Időzítő leállítva", Toast.LENGTH_SHORT).show()
            } else {
                val interval = timerManager.getIntervalMinutes()
                timerManager.startTimer(interval)
                Toast.makeText(this, "Időzítő elindítva ($interval percenként)", Toast.LENGTH_SHORT).show()
            }
            updateUIState()
        }

        binding.btnResetTimer.setOnClickListener {
            val interval = timerManager.getIntervalMinutes()
            timerManager.stopTimer()
            timerManager.startTimer(interval)
            Toast.makeText(this, "Időzítő újraindítva", Toast.LENGTH_SHORT).show()
            updateUIState()
        }

        binding.btnTestAlert.setOnClickListener {
            val snapshotBefore = timerManager.getSnapshot()
            if (snapshotBefore.state == TimerState.ALERT_ACTIVE) {
                Toast.makeText(this, "⚠️ A riasztás már aktív!", Toast.LENGTH_SHORT).show()
            } else {
                val result = timerManager.dispatch(TimerEvent(TimerEventType.TEST_ALERT, timestamp = System.currentTimeMillis()))
                if (result.newSnapshot.state == TimerState.ALERT_ACTIVE) {
                    val alertDuration = timerManager.getAlertDurationSeconds()
                    Toast.makeText(this, "🔊 Teszt riasztás elindítva! ($alertDuration mp nyugtázási ablak)", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this, "⚠️ Teszt riasztás nem indítható el", Toast.LENGTH_SHORT).show()
                }
            }
        }

        binding.btnLogDrink.setOnClickListener {
            val snapshot = timerManager.getSnapshot()
            if (snapshot.state == TimerState.ALERT_ACTIVE) {
                timerManager.dispatch(TimerEvent(TimerEventType.DRINK, timerGeneration = snapshot.timerGeneration, alertId = snapshot.alertId, timestamp = System.currentTimeMillis()))
            } else {
                val intake = timerManager.getIntakePerAlertMl()
                val total = timerManager.addDrunkMl(intake)
                Toast.makeText(this, "💧 +$intake ml rögzítve! (${total} ml)", Toast.LENGTH_SHORT).show()
            }
            updateProgress()
        }

        binding.btnEditIntakeAmount.setOnClickListener {
            showEditIntakeAmountDialog()
        }

        binding.btnDismissMissed.setOnClickListener {
            timerManager.clearMissedAlerts()
            binding.cardMissedAlert.visibility = View.GONE
        }

        binding.btnInterval30m.setOnClickListener { setInterval(30) }
        binding.btnInterval45m.setOnClickListener { setInterval(45) }
        binding.btnInterval60m.setOnClickListener { setInterval(60) }
        binding.btnIntervalCustom.setOnClickListener { showCustomIntervalDialog() }

        setupActiveDaysUI()

        binding.btnDuration5s.setOnClickListener { setAlertDuration(5) }
        binding.btnDuration15s.setOnClickListener { setAlertDuration(15) }
        binding.btnDuration30s.setOnClickListener { setAlertDuration(30) }
        binding.btnDurationCustom.setOnClickListener { showCustomDurationDialog() }

        binding.switchQuietHours.setOnCheckedChangeListener { _, isChecked ->
            timerManager.setQuietHoursEnabled(isChecked)
            updateQuietHoursUI()
            val msg = if (isChecked) "Csendes időszak bekapcsolva (${timerManager.getQuietHoursStart()} - ${timerManager.getQuietHoursEnd()})" else "Csendes időszak kikapcsolva"
            Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
        }

        binding.btnQuiet23to7.setOnClickListener {
            timerManager.setQuietHoursStart("23:00")
            timerManager.setQuietHoursEnd("07:00")
            timerManager.setQuietHoursEnabled(true)
            binding.switchQuietHours.isChecked = true
            updateQuietHoursUI()
            Toast.makeText(this, "Csendes időszak beállítva: 23:00 - 07:00", Toast.LENGTH_SHORT).show()
        }

        binding.btnQuiet22to6.setOnClickListener {
            timerManager.setQuietHoursStart("22:00")
            timerManager.setQuietHoursEnd("06:00")
            timerManager.setQuietHoursEnabled(true)
            binding.switchQuietHours.isChecked = true
            updateQuietHoursUI()
            Toast.makeText(this, "Csendes időszak beállítva: 22:00 - 06:00", Toast.LENGTH_SHORT).show()
        }

        binding.btnQuietCustom.setOnClickListener {
            showCustomQuietHoursDialog()
        }

        binding.btnEditProgress.setOnClickListener {
            showEditProgressDialog()
        }

        // Internal subtab navigation inside cardStats
        binding.btnTabStats.setOnClickListener { switchSubTab("stats") }
        binding.btnTabEvents.setOnClickListener { switchSubTab("events") }

        // Event Log Date Navigation
        binding.btnPrevDay.setOnClickListener { navigateDate(-1) }
        binding.btnNextDay.setOnClickListener { navigateDate(1) }
        binding.btnSelectDate.setOnClickListener { showDatePickerDialog() }
        binding.btnRetryEvents.setOnClickListener { loadEventsForSelectedDate() }
    }

    private fun switchSubTab(tab: String) {
        currentSubTab = tab
        if (tab == "stats") {
            binding.layoutStatsContent.visibility = View.VISIBLE
            binding.layoutEventsContent.visibility = View.GONE

            binding.btnTabStats.setBackgroundColor(ContextCompat.getColor(this, R.color.primary))
            binding.btnTabStats.setTextColor(ContextCompat.getColor(this, R.color.text_primary))
            binding.btnTabStats.strokeWidth = 0

            binding.btnTabEvents.setBackgroundColor(ContextCompat.getColor(this, android.R.color.transparent))
            binding.btnTabEvents.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
            binding.btnTabEvents.strokeWidth = 2
        } else {
            binding.layoutStatsContent.visibility = View.GONE
            binding.layoutEventsContent.visibility = View.VISIBLE

            binding.btnTabEvents.setBackgroundColor(ContextCompat.getColor(this, R.color.primary))
            binding.btnTabEvents.setTextColor(ContextCompat.getColor(this, R.color.text_primary))
            binding.btnTabEvents.strokeWidth = 0

            binding.btnTabStats.setBackgroundColor(ContextCompat.getColor(this, android.R.color.transparent))
            binding.btnTabStats.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
            binding.btnTabStats.strokeWidth = 2

            loadEventsForSelectedDate()
        }
    }

    private fun navigateDate(dayDelta: Int) {
        val today = LocalDate.now()
        if (dayDelta > 0 && selectedEventDate >= today) {
            return
        }
        val next = selectedEventDate.plusDays(dayDelta.toLong())
        selectedEventDate = if (next > today) today else next
        updateDateHeaderUI()
        loadEventsForSelectedDate()
    }

    private fun showDatePickerDialog() {
        val today = LocalDate.now()
        val dialog = android.app.DatePickerDialog(
            this,
            { _, year, month, dayOfMonth ->
                val chosen = LocalDate.of(year, month + 1, dayOfMonth)
                selectedEventDate = if (chosen > today) today else chosen
                updateDateHeaderUI()
                loadEventsForSelectedDate()
            },
            selectedEventDate.year,
            selectedEventDate.monthValue - 1,
            selectedEventDate.dayOfMonth
        )
        dialog.datePicker.maxDate = System.currentTimeMillis()
        dialog.show()
    }

    private fun updateDateHeaderUI() {
        val today = LocalDate.now()
        val isToday = selectedEventDate == today
        binding.btnNextDay.isEnabled = !isToday
        binding.btnNextDay.alpha = if (isToday) 0.3f else 1.0f

        val formattedStr = String.format("%04d. %02d. %02d.", selectedEventDate.year, selectedEventDate.monthValue, selectedEventDate.dayOfMonth)
        binding.tvSelectedDate.text = if (isToday) "$formattedStr (Ma)" else formattedStr
    }

    private fun loadEventsForSelectedDate() {
        binding.layoutEventsLoading.visibility = View.VISIBLE
        binding.layoutEventsError.visibility = View.GONE
        binding.tvEventsEmpty.visibility = View.GONE
        binding.layoutEventCards.visibility = View.GONE

        val token = ++activeEventsQueryToken
        val queryDate = selectedEventDate

        queryExecutor.execute {
            try {
                val list = eventRepository.listByLocalDay(queryDate)
                val events = list.sortedByDescending { it.scheduledAt }

                runOnUiThread {
                    if (token != activeEventsQueryToken) return@runOnUiThread

                    binding.layoutEventsLoading.visibility = View.GONE
                    if (events.isEmpty()) {
                        binding.tvEventsEmpty.visibility = View.VISIBLE
                        binding.tvEventsEmpty.text = "Erre a napra nincs rögzített esemény."
                    } else {
                        binding.layoutEventCards.removeAllViews()
                        binding.layoutEventCards.visibility = View.VISIBLE
                        for (event in events) {
                            val cardView = renderEventCardView(event)
                            binding.layoutEventCards.addView(cardView)
                        }
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    if (token != activeEventsQueryToken) return@runOnUiThread
                    binding.layoutEventsLoading.visibility = View.GONE
                    binding.layoutEventsError.visibility = View.VISIBLE
                    binding.tvEventsErrorMessage.text = "Nem sikerült az események betöltése."
                }
            }
        }
    }

    private fun renderEventCardView(event: HydrationEvent): View {
        val view = LayoutInflater.from(this).inflate(R.layout.item_hydration_event, binding.layoutEventCards, false)
        val tvTime = view.findViewById<TextView>(R.id.tvEventTime)
        val tvStatus = view.findViewById<TextView>(R.id.tvEventStatus)

        val localTime = Instant.ofEpochMilli(event.scheduledAt)
            .atZone(ZoneId.systemDefault())
            .toLocalTime()
        val timeFormatter = DateTimeFormatter.ofPattern("HH:mm")
        tvTime.text = localTime.format(timeFormatter)

        val (labelText, textColorHex, bgColorHex, strokeColorHex) = when (event.status) {
            HydrationEventStatus.PENDING -> Quadruple("Függőben", "#F59E0B", "#2A2000", "#D97706")
            HydrationEventStatus.DRANK -> Quadruple("Megtörtént", "#34D399", "#064E3B", "#059669")
            HydrationEventStatus.NOT_DRANK -> Quadruple("Nem történt meg", "#FB923C", "#7C2D12", "#EA580C")
            HydrationEventStatus.REJECTED -> Quadruple("Elutasítva", "#FB7185", "#881337", "#E11D48")
        }

        tvStatus.text = labelText
        tvStatus.setTextColor(Color.parseColor(textColorHex))

        val bgDrawable = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = 16f
            setColor(Color.parseColor(bgColorHex))
            setStroke(2, Color.parseColor(strokeColorHex))
        }
        tvStatus.background = bgDrawable

        return view
    }

    private data class Quadruple<A, B, C, D>(val first: A, val second: B, val third: C, val fourth: D)

    private fun setInterval(minutes: Int) {
        val sanitized = Math.max(1, minutes)
        timerManager.setIntervalMinutes(sanitized)
        if (timerManager.isTimerRunning()) {
            timerManager.stopTimer()
            timerManager.startTimer(sanitized)
        }
        updateIntervalButtonStyles()
        Toast.makeText(this, "Ciklus idő: $sanitized perc", Toast.LENGTH_SHORT).show()
        updateUIState()
    }

    private fun showCustomIntervalDialog() {
        val input = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            hint = "Perc (min. 1)"
            setText(timerManager.getIntervalMinutes().toString())
        }

        AlertDialog.Builder(this)
            .setTitle("Egyedi Ciklus Idő")
            .setMessage("Add meg az értesítések közötti időt percben:")
            .setView(input)
            .setPositiveButton("Mentés") { _, _ ->
                val text = input.text.toString()
                val value = text.toIntOrNull() ?: 30
                setInterval(value)
            }
            .setNegativeButton("Mégse", null)
            .show()
    }

    private fun updateIntervalButtonStyles() {
        val currentInterval = timerManager.getIntervalMinutes()

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

        applyStyle(binding.btnInterval30m, currentInterval == 30)
        applyStyle(binding.btnInterval45m, currentInterval == 45)
        applyStyle(binding.btnInterval60m, currentInterval == 60)
        applyStyle(binding.btnIntervalCustom, currentInterval !in listOf(30, 45, 60))
    }

    private fun showEditProgressDialog() {
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(50, 20, 50, 20)
        }

        val tvCurrent = android.widget.TextView(this).apply { text = "Jelenlegi fogyasztás (ml):" }
        val inputCurrent = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            hint = "Pl. 1250"
            setText(timerManager.getTodayDrunkMl().toString())
        }

        val tvTarget = android.widget.TextView(this).apply {
            text = "Napi cél (ml):"
            setPadding(0, 20, 0, 0)
        }
        val inputTarget = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            hint = "Pl. 2500"
            setText(timerManager.getDailyTargetMl().toString())
        }

        layout.addView(tvCurrent)
        layout.addView(inputCurrent)
        layout.addView(tvTarget)
        layout.addView(inputTarget)

        AlertDialog.Builder(this)
            .setTitle("Fogyasztás és Cél Módosítása")
            .setView(layout)
            .setPositiveButton("Mentés") { _, _ ->
                val currentText = inputCurrent.text.toString()
                val targetText = inputTarget.text.toString()

                val currentVal = currentText.toIntOrNull()
                val targetVal = targetText.toIntOrNull()

                if (currentVal != null) {
                    timerManager.setTodayDrunkMl(currentVal)
                }
                if (targetVal != null) {
                    timerManager.setDailyTargetMl(targetVal)
                }

                updateProgress()
                Toast.makeText(this, "Adatok frissítve", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Mégse", null)
            .show()
    }

    private fun showEditIntakeAmountDialog() {
        val input = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            hint = "Pl. 250"
            setText(timerManager.getIntakePerAlertMl().toString())
        }

        AlertDialog.Builder(this)
            .setTitle("Adag / Jelzés Módosítása")
            .setMessage("Add meg a folyadék beviteli mennyiséget jelzésenként (ml):")
            .setView(input)
            .setPositiveButton("Mentés") { _, _ ->
                val value = input.text.toString().toIntOrNull()
                if (value != null && value > 0) {
                    timerManager.setIntakePerAlertMl(value)
                    updateUIState()
                    Toast.makeText(this, "Mennyiség frissítve: $value ml", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this, "Érvénytelen mennyiség", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Mégse", null)
            .show()
    }

    private fun setupActiveDaysUI() {
        binding.btnActiveDaysDropdown.setOnClickListener {
            val days = timerManager.getActiveDays()
            val options = arrayOf("Hétfő", "Kedd", "Szerda", "Csütörtök", "Péntek", "Szombat", "Vasárnap")
            val checkedItems = booleanArrayOf(days[1], days[2], days[3], days[4], days[5], days[6], days[0])

            AlertDialog.Builder(this)
                .setTitle("Aktív Napok")
                .setMultiChoiceItems(options, checkedItems) { _, which, isChecked ->
                    checkedItems[which] = isChecked
                }
                .setPositiveButton("Mentés") { _, _ ->
                    val newDays = BooleanArray(7)
                    newDays[0] = checkedItems[6]
                    newDays[1] = checkedItems[0]
                    newDays[2] = checkedItems[1]
                    newDays[3] = checkedItems[2]
                    newDays[4] = checkedItems[3]
                    newDays[5] = checkedItems[4]
                    newDays[6] = checkedItems[5]
                    timerManager.setActiveDays(newDays)
                    Toast.makeText(this, "Aktív napok frissítve", Toast.LENGTH_SHORT).show()
                }
                .setNegativeButton("Mégse", null)
                .show()
        }
    }

    private fun showCustomQuietHoursDialog() {
        val layout = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            setPadding(50, 20, 50, 20)
        }

        val tvStart = android.widget.TextView(this).apply { text = "Kezdete (pl. 23:00):" }
        val inputStart = EditText(this).apply {
            hint = "23:00"
            setText(timerManager.getQuietHoursStart())
        }

        val tvEnd = android.widget.TextView(this).apply {
            text = "Vége (pl. 07:00):"
            setPadding(0, 20, 0, 0)
        }
        val inputEnd = EditText(this).apply {
            hint = "07:00"
            setText(timerManager.getQuietHoursEnd())
        }

        layout.addView(tvStart)
        layout.addView(inputStart)
        layout.addView(tvEnd)
        layout.addView(inputEnd)

        AlertDialog.Builder(this)
            .setTitle("Egyedi Csendes Időszak")
            .setMessage("Add meg az éjszakai némítás kezdeti és befejező időpontját (ÓÓ:PP formátumban):")
            .setView(layout)
            .setPositiveButton("Mentés") { _, _ ->
                val start = inputStart.text.toString().trim()
                val end = inputEnd.text.toString().trim()
                if (start.matches(Regex("^([01]\\d|2[0-3]):[0-5]\\d$")) && end.matches(Regex("^([01]\\d|2[0-3]):[0-5]\\d$"))) {
                    timerManager.setQuietHoursStart(start)
                    timerManager.setQuietHoursEnd(end)
                    timerManager.setQuietHoursEnabled(true)
                    binding.switchQuietHours.isChecked = true
                    updateQuietHoursUI()
                    Toast.makeText(this, "Csendes időszak mentve: $start - $end", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this, "Érvénytelen időformátum! Használj ÓÓ:PP formátumot (pl. 23:00).", Toast.LENGTH_LONG).show()
                }
            }
            .setNegativeButton("Mégse", null)
            .show()
    }

    private fun updateQuietHoursUI() {
        val isEnabled = timerManager.isQuietHoursEnabled()
        val start = timerManager.getQuietHoursStart()
        val end = timerManager.getQuietHoursEnd()
        val isCurrentlyQuiet = timerManager.isInQuietHours()

        binding.switchQuietHours.isChecked = isEnabled
        binding.layoutQuietPresets.visibility = if (isEnabled) View.VISIBLE else View.GONE

        if (!isEnabled) {
            binding.tvQuietHoursStatus.text = "Kikapcsolva (Mindig jelez)"
            binding.tvQuietHoursStatus.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
        } else if (isCurrentlyQuiet) {
            binding.tvQuietHoursStatus.text = "🌙 AKTUÁLISAN AKTÍV ($start – $end) • Riasztások némítva"
            binding.tvQuietHoursStatus.setTextColor(android.graphics.Color.parseColor("#C084FC"))
        } else {
            binding.tvQuietHoursStatus.text = "Beállítva: $start – $end (Jelenleg aktív riasztások engedélyezve)"
            binding.tvQuietHoursStatus.setTextColor(ContextCompat.getColor(this, R.color.text_secondary))
        }

        fun stylePresetBtn(btn: com.google.android.material.button.MaterialButton, isSelected: Boolean) {
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

        val is23to7 = start == "23:00" && end == "07:00"
        val is22to6 = start == "22:00" && end == "06:00"
        stylePresetBtn(binding.btnQuiet23to7, isEnabled && is23to7)
        stylePresetBtn(binding.btnQuiet22to6, isEnabled && is22to6)
        stylePresetBtn(binding.btnQuietCustom, isEnabled && !is23to7 && !is22to6)
    }

    private fun setAlertDuration(seconds: Int) {
        val sanitized = Math.max(5, seconds)
        timerManager.setAlertDurationSeconds(sanitized)
        updateDurationButtonStyles()
        Toast.makeText(this, "Jelzési időablak: $sanitized másodperc", Toast.LENGTH_SHORT).show()
        updateUIState()
    }

    private fun showCustomDurationDialog() {
        val input = EditText(this).apply {
            inputType = android.text.InputType.TYPE_CLASS_NUMBER
            hint = "Másodperc (min. 5)"
            setText(timerManager.getAlertDurationSeconds().toString())
        }

        AlertDialog.Builder(this)
            .setTitle("Egyedi Jelzési Időablak")
            .setMessage("Add meg a riasztás és nyugtázás időtartamát másodpercben (minimum 5 mp):")
            .setView(input)
            .setPositiveButton("Mentés") { _, _ ->
                val text = input.text.toString()
                val value = text.toIntOrNull() ?: 15
                setAlertDuration(value)
            }
            .setNegativeButton("Mégse", null)
            .show()
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
        val snapshot = timerManager.getSnapshot()
        val isRunning = snapshot.state != TimerState.STOPPED
        val interval = timerManager.getIntervalMinutes()
        val alertSec = timerManager.getAlertDurationSeconds()

        binding.tvIntervalLabel.text = "${interval}p ciklus • ${alertSec}mp jelzési ablak"

        if (isRunning) {
            binding.btnToggleTimer.text = "Szüneteltetés"
            binding.btnToggleTimer.setBackgroundColor(ContextCompat.getColor(this, R.color.surface))
            startUiCountDown()
        } else {
            binding.btnToggleTimer.text = "Időzítő Indítása"
            binding.btnToggleTimer.setBackgroundColor(ContextCompat.getColor(this, R.color.primary))
            binding.tvTimerCountdown.text = String.format("%02d:00", interval)
            uiCountDownTimer?.cancel()
        }
        binding.btnLogDrink.text = "+${timerManager.getIntakePerAlertMl()} ml"
        updateProgress()
        updateDurationButtonStyles()
        updateIntervalButtonStyles()
        updateQuietHoursUI()
        checkMissedAlertBanner()
    }

    private fun startUiCountDown() {
        uiCountDownTimer?.cancel()
        val snapshot = timerManager.getSnapshot()
        val now = System.currentTimeMillis()

        if (snapshot.state == TimerState.ALERT_ACTIVE) {
            binding.tvTimerCountdown.text = "RIASZTÁS"
            binding.tvTimerCountdown.setTextColor(android.graphics.Color.parseColor("#F59E0B"))

            val deadline = snapshot.alertDeadlineAt ?: now
            val alertMillisRemaining = deadline - now

            if (alertMillisRemaining <= 0L) {
                timerManager.dispatch(
                    TimerEvent(
                        type = TimerEventType.ALERT_TIMEOUT,
                        timerGeneration = snapshot.timerGeneration,
                        alertId = snapshot.alertId,
                        timestamp = now
                    )
                )
                return
            }

            uiCountDownTimer = object : CountDownTimer(alertMillisRemaining, 1000) {
                override fun onTick(millisUntilFinished: Long) {}
                override fun onFinish() {
                    updateUIState()
                }
            }.start()
            return
        }

        binding.tvTimerCountdown.setTextColor(ContextCompat.getColor(this, R.color.text_primary))
        val nextTime = snapshot.nextTriggerAt ?: now
        val millisRemaining = nextTime - now

        if (millisRemaining <= 0L) {
            timerManager.dispatch(
                TimerEvent(
                    type = TimerEventType.TIMER_TRIGGER,
                    timerGeneration = snapshot.timerGeneration,
                    scheduledAt = snapshot.nextTriggerAt,
                    timestamp = now
                )
            )
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
                updateUIState()
            }
        }.start()
    }

    private fun updateProgress() {
        val drunk = timerManager.getTodayDrunkMl()
        val target = timerManager.getDailyTargetMl()
        binding.tvDailyProgress.text = "Napi fogyasztás: $drunk / $target ml"

        val missed = timerManager.getTodayMissedCount()
        val ack = timerManager.getTodayAckCount()
        val remaining = Math.max(0, target - drunk)

        binding.tvStatsDrunk.text = "$drunk ml"
        binding.tvStatsRemaining.text = "$remaining ml"
        binding.tvStatsAck.text = "$ack"
        binding.tvStatsMissed.text = "$missed"
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
        timerManager.getPrefs().unregisterOnSharedPreferenceChangeListener(prefChangeListener)
        queryExecutor.shutdown()
    }
}
