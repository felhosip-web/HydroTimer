package com.hydrotimer.app

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

            // Main Reminder Channel (High importance, vibration for watches)
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

            // Missed Alert Channel (Warning tone)
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

        // Intent to open MainActivity when tapped
        val openAppIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        }
        val openAppPendingIntent = PendingIntent.getActivity(
            context,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Action 1: "Megittam (+250ml)"
        val drinkIntent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_LOG_DRINK
        }
        val drinkPendingIntent = PendingIntent.getBroadcast(
            context,
            1,
            drinkIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Action 2: "Nyugtázás" (csak elnémítás & következő szakasz indítása)
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

        val wearableExtender = NotificationCompat.WearableExtender()
            .addAction(
                NotificationCompat.Action(
                    R.drawable.ic_water_drop,
                    context.getString(R.string.action_drink),
                    drinkPendingIntent
                )
            )
            .addAction(
                NotificationCompat.Action(
                    R.drawable.ic_water_drop,
                    context.getString(R.string.action_acknowledge),
                    ackPendingIntent
                )
            )

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
            .extend(wearableExtender)
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

        // Quick log drink action for missed alert
        val drinkIntent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_LOG_DRINK
        }
        val drinkPendingIntent = PendingIntent.getBroadcast(
            context,
            4,
            drinkIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val wearableExtender = NotificationCompat.WearableExtender()
            .addAction(
                NotificationCompat.Action(
                    R.drawable.ic_water_drop,
                    context.getString(R.string.action_drink),
                    drinkPendingIntent
                )
            )

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
            .addAction(R.drawable.ic_water_drop, context.getString(R.string.action_drink), drinkPendingIntent)
            .extend(wearableExtender)
            .build()

        // Cancel previous reminder if still showing
        notificationManager.cancel(NOTIFICATION_ID)
        // Show missed alert
        notificationManager.notify(MISSED_NOTIFICATION_ID, notification)
    }
}

