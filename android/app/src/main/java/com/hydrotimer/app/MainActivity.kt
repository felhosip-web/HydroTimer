package com.hydrotimer.app

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
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
        // Toggle Main Interval Timer
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
            NotificationHelper.showWaterReminder(this)
            val alertDuration = timerManager.getAlertDurationSeconds()
            timerManager.scheduleAlertTimeout(alertDuration)
            Toast.makeText(this, "🔊 Riasztás elküldve! ($alertDuration mp nyugtázási ablak)", Toast.LENGTH_SHORT).show()
        }

        binding.btnLogDrink.setOnClickListener {
            val total = timerManager.addDrunkMl(250)
            updateProgress()
            Toast.makeText(this, "💧 +250 ml rögzítve! (${total} ml)", Toast.LENGTH_SHORT).show()
        }

        binding.btnDismissMissed.setOnClickListener {
            timerManager.clearMissedAlerts()
            binding.cardMissedAlert.visibility = View.GONE
        }

        // Alert Duration Quick Buttons: 5s (min), 15s, 30s + Custom input
        binding.btnDuration5s.setOnClickListener { setAlertDuration(5) }
        binding.btnDuration15s.setOnClickListener { setAlertDuration(15) }
        binding.btnDuration30s.setOnClickListener { setAlertDuration(30) }
        binding.btnDurationCustom.setOnClickListener { showCustomDurationDialog() }

        // Quiet Hours (Csendes Időszak / Ne Zavarj) controls
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
        val isRunning = timerManager.isTimerRunning()
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
        updateProgress()
        updateDurationButtonStyles()
        updateQuietHoursUI()
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
}
