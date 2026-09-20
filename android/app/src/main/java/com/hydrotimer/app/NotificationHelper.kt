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
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        val reminderChannel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.notification_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = context.getString(R.string.notification_channel_desc)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 450, 200, 450, 200, 600)
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            )
            setShowBadge(true)
            lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(reminderChannel)

        val missedChannel = NotificationChannel(
            MISSED_CHANNEL_ID,
            context.getString(R.string.missed_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = context.getString(R.string.missed_channel_desc)
            enableVibration(true)
            vibrationPattern = longArrayOf(0, 150, 100, 250)
            setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
            )
            setShowBadge(true)
            lockscreenVisibility = NotificationCompat.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(missedChannel)
    }

    fun cancelAlertNotifications(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(NOTIFICATION_ID)
        manager.cancel(MISSED_NOTIFICATION_ID)
    }

    private fun openAppPendingIntent(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 0,
        Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
        },
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    fun showWaterReminder(context: Context, customTitle: String? = null, customBody: String? = null) {
        val drinkPendingIntent = PendingIntent.getBroadcast(
            context, 1, Intent(context, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_LOG_DRINK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val ackPendingIntent = PendingIntent.getBroadcast(
            context, 2, Intent(context, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_ACKNOWLEDGE),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val title = customTitle ?: context.getString(R.string.reminder_title)
        val body = customBody ?: context.getString(R.string.reminder_body)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_water_drop)
            .setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppPendingIntent(context))
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setLocalOnly(false)
            .setWhen(System.currentTimeMillis())
            .addAction(R.drawable.ic_water_drop, context.getString(R.string.action_drink), drinkPendingIntent)
            .addAction(R.drawable.ic_water_drop, context.getString(R.string.action_acknowledge), ackPendingIntent)
            .extend(NotificationCompat.WearableExtender().addAction(
                NotificationCompat.Action(R.drawable.ic_water_drop, context.getString(R.string.action_drink), drinkPendingIntent)
            ).addAction(NotificationCompat.Action(R.drawable.ic_water_drop, context.getString(R.string.action_acknowledge), ackPendingIntent)))
            .build()
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, notification)
    }

    fun showMissedAlertNotification(context: Context, alertDurationSeconds: Int) {
        val drinkPendingIntent = PendingIntent.getBroadcast(
            context, 4, Intent(context, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION_LOG_DRINK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val body = context.getString(R.string.missed_alert_body, alertDurationSeconds)
        val notification = NotificationCompat.Builder(context, MISSED_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_water_drop)
            .setContentTitle(context.getString(R.string.missed_alert_title)).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(openAppPendingIntent(context))
            .setAutoCancel(true).setOnlyAlertOnce(true).setLocalOnly(false)
            .addAction(R.drawable.ic_water_drop, context.getString(R.string.action_drink), drinkPendingIntent)
            .extend(NotificationCompat.WearableExtender().addAction(
                NotificationCompat.Action(R.drawable.ic_water_drop, context.getString(R.string.action_drink), drinkPendingIntent)
            )).build()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.cancel(NOTIFICATION_ID)
        manager.notify(MISSED_NOTIFICATION_ID, notification)
    }
}
