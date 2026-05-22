package com.chiiiiiiing.todolistapp

import android.Manifest
import android.annotation.SuppressLint
import android.content.ContentUris
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.net.Uri
import android.provider.CalendarContract
import android.webkit.WebChromeClient
import android.webkit.ConsoleMessage
import android.util.Log
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.ValueCallback
import android.webkit.JavascriptInterface
import androidx.appcompat.app.AppCompatActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var nativeCalendarSyncRequested = false

    private val readCalendarPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            startNativeCalendarSync()
        } else {
            postCalendarSyncResult(false, "未授予读取日历权限")
        }
    }

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        Log.d("WebViewConsole", "fileChooserLauncher resultCode=${result.resultCode} data=${result.data}")
        val callback = filePathCallback ?: return@registerForActivityResult
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        Log.d("WebViewConsole", "Parsed URIs: ${uris?.joinToString()}")
        callback.onReceiveValue(uris)
        filePathCallback = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.settings.databaseEnabled = true
        webView.settings.mediaPlaybackRequiresUserGesture = false
        webView.settings.cacheMode = WebSettings.LOAD_DEFAULT
        webView.settings.allowFileAccess = true
        webView.settings.allowContentAccess = true
        // Allow file:// pages to access file URLs and enable universal access from file URLs
        try {
            webView.settings.allowFileAccessFromFileURLs = true
            webView.settings.allowUniversalAccessFromFileURLs = true
        } catch (e: Exception) {
            // some older devices may not expose these setters; ignore if unavailable
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                return false
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                try {
                    Log.d("WebViewConsole", "JS: ${consoleMessage?.message()} -- ${consoleMessage?.messageLevel()}")
                } catch (e: Exception) {
                    // ignore
                }
                return super.onConsoleMessage(consoleMessage)
            }
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                Log.d("WebViewConsole", "onShowFileChooser invoked; params=${fileChooserParams}")
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback

                val intent = try {
                    fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                } catch (e: Exception) {
                    Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }
                }

                return try {
                    fileChooserLauncher.launch(intent)
                    true
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback?.onReceiveValue(null)
                    this@MainActivity.filePathCallback = null
                    false
                }
            }
        }
        webView.addJavascriptInterface(CalendarBridge(), "AndroidCalendarSync")
        webView.loadUrl(APP_URL)
    }

    private inner class CalendarBridge {
        @JavascriptInterface
        fun requestSync() {
            runOnUiThread {
                nativeCalendarSyncRequested = true
                val permissionGranted = ContextCompat.checkSelfPermission(
                    this@MainActivity,
                    Manifest.permission.READ_CALENDAR
                ) == PackageManager.PERMISSION_GRANTED
                if (permissionGranted) {
                    startNativeCalendarSync()
                } else {
                    readCalendarPermissionLauncher.launch(Manifest.permission.READ_CALENDAR)
                }
            }
        }
    }

    private fun startNativeCalendarSync() {
        if (!nativeCalendarSyncRequested) return
        nativeCalendarSyncRequested = false

        thread {
            try {
                val events = querySystemCalendarEvents()
                postCalendarSyncResult(true, null, events)
            } catch (error: Exception) {
                Log.e("WebViewConsole", "Calendar sync failed", error)
                postCalendarSyncResult(false, error.message ?: "同步系统日历失败")
            }
        }
    }

    private fun querySystemCalendarEvents(): List<JSONObject> {
        val now = System.currentTimeMillis()
        val startMillis = now - 3650L * 24L * 60L * 60L * 1000L // 10 years back
        val endMillis = now + 3650L * 24L * 60L * 60L * 1000L   // 10 years forward

        Log.d("WebViewConsole", "Calendar sync: time range = $startMillis ~ $endMillis (now=$now)")
        Log.d("WebViewConsole", "Permission check: READ_CALENDAR = ${ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.READ_CALENDAR)}")

        val events = mutableListOf<JSONObject>()

        // Step 1: list calendars
        try { listAvailableCalendars() } catch (e: Exception) { Log.e("WebViewConsole", "List calendars failed", e) }

        // Step 2: standard Instances query
        try {
            val r = queryByInstances(startMillis, endMillis)
            events.addAll(r)
            Log.d("WebViewConsole", "Instances: ${r.size} events")
        } catch (e: Exception) { Log.e("WebViewConsole", "Instances failed", e) }

        // Step 3: Events table fallback
        if (events.isEmpty()) {
            try {
                val r = queryByEvents(startMillis, endMillis)
                events.addAll(r)
                Log.d("WebViewConsole", "Events table: ${r.size} events")
            } catch (e: Exception) { Log.e("WebViewConsole", "Events table failed", e) }
        }

        // Step 4: Per-calendar query (HarmonyOS fallback)
        if (events.isEmpty()) {
            try {
                val r = queryByAllCalendars(startMillis, endMillis)
                events.addAll(r)
                Log.d("WebViewConsole", "Per-calendar: ${r.size} events")
            } catch (e: Exception) { Log.e("WebViewConsole", "Per-calendar failed", e) }
        }

        Log.d("WebViewConsole", "Total events synced: ${events.size}")
        return events
    }

    private fun queryByAllCalendars(startMillis: Long, endMillis: Long): List<JSONObject> {
        val events = mutableListOf<JSONObject>()
        val calendarsUri = CalendarContract.Calendars.CONTENT_URI
        val calProjection = arrayOf(CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_DISPLAY_NAME)

        contentResolver.query(calendarsUri, calProjection, null, null, null)?.use { cursor ->
            val idCol = cursor.getColumnIndex(CalendarContract.Calendars._ID)
            val nameCol = cursor.getColumnIndex(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME)
            while (cursor.moveToNext()) {
                val calId = cursor.getLong(idCol)
                val calName = cursor.getString(nameCol) ?: "Unknown"
                Log.d("WebViewConsole", "Querying calendar[$calId]: $calName")

                val instUriBuilder = CalendarContract.Instances.CONTENT_URI.buildUpon()
                ContentUris.appendId(instUriBuilder, startMillis)
                ContentUris.appendId(instUriBuilder, endMillis)

                val instProjection = arrayOf(
                    CalendarContract.Instances.EVENT_ID, CalendarContract.Instances.TITLE,
                    CalendarContract.Instances.BEGIN, CalendarContract.Instances.END,
                    CalendarContract.Instances.EVENT_LOCATION, CalendarContract.Instances.CALENDAR_DISPLAY_NAME,
                    CalendarContract.Instances.ALL_DAY
                )
                contentResolver.query(instUriBuilder.build(), instProjection,
                    "${CalendarContract.Instances.CALENDAR_ID} = ?",
                    arrayOf(calId.toString()),
                    "${CalendarContract.Instances.BEGIN} ASC"
                )?.use { evCursor ->
                    Log.d("WebViewConsole", "  Calendar[$calId] events: ${evCursor.count}")
                    while (evCursor.moveToNext()) {
                        val title = evCursor.getString(evCursor.getColumnIndexOrThrow(CalendarContract.Instances.TITLE))?.trim().orEmpty()
                        if (title.isBlank()) continue
                        val begin = evCursor.getLong(evCursor.getColumnIndexOrThrow(CalendarContract.Instances.BEGIN))
                        val end = evCursor.getLong(evCursor.getColumnIndexOrThrow(CalendarContract.Instances.END))
                        val allDay = evCursor.getInt(evCursor.getColumnIndexOrThrow(CalendarContract.Instances.ALL_DAY)) == 1
                        val eventId = evCursor.getLong(evCursor.getColumnIndexOrThrow(CalendarContract.Instances.EVENT_ID))
                        val location = evCursor.getString(evCursor.getColumnIndexOrThrow(CalendarContract.Instances.EVENT_LOCATION))?.trim().orEmpty()
                        val calDispName = evCursor.getString(evCursor.getColumnIndexOrThrow(CalendarContract.Instances.CALENDAR_DISPLAY_NAME))?.trim().orEmpty()

                        val item = JSONObject()
                        item.put("summary", title)
                        item.put("start", formatCalendarDateTime(begin, allDay))
                        item.put("end", formatCalendarDateTime(end, allDay))
                        item.put("location", location)
                        item.put("calendarName", calDispName)
                        item.put("sourceKey", "$eventId:$begin:$end")
                        events.add(item)
                    }
                }
            }
        }
        return events
    }

    private fun listAvailableCalendars() {
        val calendarsUri = CalendarContract.Calendars.CONTENT_URI
        val projection = arrayOf(
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.ACCOUNT_NAME,
            CalendarContract.Calendars.OWNER_ACCOUNT
        )

        contentResolver.query(calendarsUri, projection, null, null, null)?.use { cursor ->
            Log.d("WebViewConsole", "Available calendars: ${cursor.count}")
            val idCol = cursor.getColumnIndex(CalendarContract.Calendars._ID)
            val nameCol = cursor.getColumnIndex(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME)
            val accountCol = cursor.getColumnIndex(CalendarContract.Calendars.ACCOUNT_NAME)
            
            while (cursor.moveToNext()) {
                val id = cursor.getLong(idCol)
                val name = cursor.getString(nameCol) ?: "Unknown"
                val account = cursor.getString(accountCol) ?: "Unknown"
                Log.d("WebViewConsole", "  Calendar[$id]: $name (Account: $account)")
            }
        } ?: run {
            Log.d("WebViewConsole", "No calendars query result (null cursor)")
        }
    }

    private fun queryByInstances(startMillis: Long, endMillis: Long): List<JSONObject> {
        val events = mutableListOf<JSONObject>()
        val uriBuilder = CalendarContract.Instances.CONTENT_URI.buildUpon()
        ContentUris.appendId(uriBuilder, startMillis)
        ContentUris.appendId(uriBuilder, endMillis)
        Log.d("WebViewConsole", "Querying Instances: ${uriBuilder.build()}")

        val projection = arrayOf(
            CalendarContract.Instances.EVENT_ID,
            CalendarContract.Instances.TITLE,
            CalendarContract.Instances.BEGIN,
            CalendarContract.Instances.END,
            CalendarContract.Instances.ALL_DAY,
            CalendarContract.Instances.EVENT_LOCATION,
            CalendarContract.Instances.CALENDAR_DISPLAY_NAME,
            CalendarContract.Instances.DESCRIPTION
        )

        contentResolver.query(
            uriBuilder.build(),
            projection,
            null,
            null,
            "${CalendarContract.Instances.BEGIN} ASC"
        )?.use { cursor ->
            Log.d("WebViewConsole", "Instances cursor count = ${cursor.count}")
            val eventIdColumn = cursor.getColumnIndexOrThrow(CalendarContract.Instances.EVENT_ID)
            val titleColumn = cursor.getColumnIndexOrThrow(CalendarContract.Instances.TITLE)
            val beginColumn = cursor.getColumnIndexOrThrow(CalendarContract.Instances.BEGIN)
            val endColumn = cursor.getColumnIndexOrThrow(CalendarContract.Instances.END)
            val locationColumn = cursor.getColumnIndexOrThrow(CalendarContract.Instances.EVENT_LOCATION)
            val calendarNameColumn = cursor.getColumnIndexOrThrow(CalendarContract.Instances.CALENDAR_DISPLAY_NAME)
            val allDayColumn = cursor.getColumnIndexOrThrow(CalendarContract.Instances.ALL_DAY)
            val descColumn = try {
                cursor.getColumnIndexOrThrow(CalendarContract.Instances.DESCRIPTION)
            } catch (e: Exception) {
                -1
            }

            while (cursor.moveToNext()) {
                val title = cursor.getString(titleColumn)?.trim().orEmpty()
                if (title.isBlank()) continue

                val beginMillis = cursor.getLong(beginColumn)
                val endMillisValue = cursor.getLong(endColumn)
                val eventId = cursor.getLong(eventIdColumn)
                val allDay = cursor.getInt(allDayColumn) == 1
                val location = cursor.getString(locationColumn)?.trim().orEmpty()
                val calendarName = cursor.getString(calendarNameColumn)?.trim().orEmpty()

                val startText = formatCalendarDateTime(beginMillis, allDay)
                val endText = formatCalendarDateTime(endMillisValue, allDay)
                if (startText.isBlank()) continue
                Log.d("WebViewConsole", "Adding event: $title ($startText ~ $endText)")

                val item = JSONObject()
                item.put("summary", title)
                item.put("start", startText)
                item.put("end", endText)
                item.put("location", location)
                item.put("calendarName", calendarName)
                if (descColumn >= 0) {
                    item.put("description", cursor.getString(descColumn) ?: "")
                } else {
                    item.put("description", "")
                }
                item.put("sourceKey", "$eventId:$beginMillis:$endMillisValue")
                events.add(item)
            }
        } ?: run {
            Log.d("WebViewConsole", "Instances query returned null cursor")
        }

        return events
    }

    private fun queryByEvents(startMillis: Long, endMillis: Long): List<JSONObject> {
        val events = mutableListOf<JSONObject>()
        Log.d("WebViewConsole", "Querying Events table as fallback for Huawei compatibility")

        val projection = arrayOf(
            CalendarContract.Events._ID,
            CalendarContract.Events.TITLE,
            CalendarContract.Events.DTSTART,
            CalendarContract.Events.DTEND,
            CalendarContract.Events.ALL_DAY,
            CalendarContract.Events.EVENT_LOCATION,
            CalendarContract.Events.CALENDAR_ID,
            CalendarContract.Events.DESCRIPTION
        )

        // Query events within time range
        val selection = "(((${CalendarContract.Events.DTSTART} <= ? AND ${CalendarContract.Events.DTEND} >= ?) OR ${CalendarContract.Events.ALL_DAY} = 1) AND ${CalendarContract.Events.DELETED} = 0)"
        val selectionArgs = arrayOf(endMillis.toString(), startMillis.toString())

        contentResolver.query(
            CalendarContract.Events.CONTENT_URI,
            projection,
            selection,
            selectionArgs,
            "${CalendarContract.Events.DTSTART} ASC"
        )?.use { cursor ->
            Log.d("WebViewConsole", "Events cursor count = ${cursor.count}")
            val idCol = cursor.getColumnIndexOrThrow(CalendarContract.Events._ID)
            val titleCol = cursor.getColumnIndexOrThrow(CalendarContract.Events.TITLE)
            val startCol = cursor.getColumnIndexOrThrow(CalendarContract.Events.DTSTART)
            val endCol = cursor.getColumnIndexOrThrow(CalendarContract.Events.DTEND)
            val locationCol = cursor.getColumnIndexOrThrow(CalendarContract.Events.EVENT_LOCATION)
            val allDayCol = cursor.getColumnIndexOrThrow(CalendarContract.Events.ALL_DAY)
            val descCol = try {
                cursor.getColumnIndexOrThrow(CalendarContract.Events.DESCRIPTION)
            } catch (e: Exception) {
                -1
            }

            while (cursor.moveToNext()) {
                val title = cursor.getString(titleCol)?.trim().orEmpty()
                if (title.isBlank()) continue

                val startMillis = cursor.getLong(startCol)
                val endMillisValue = cursor.getLong(endCol)
                val eventId = cursor.getLong(idCol)
                val allDay = cursor.getInt(allDayCol) == 1
                val location = cursor.getString(locationCol)?.trim().orEmpty()

                val startText = formatCalendarDateTime(startMillis, allDay)
                val endText = formatCalendarDateTime(endMillisValue, allDay)
                if (startText.isBlank()) continue
                Log.d("WebViewConsole", "Adding event from Events table: $title ($startText ~ $endText)")

                val item = JSONObject()
                item.put("summary", title)
                item.put("start", startText)
                item.put("end", endText)
                item.put("location", location)
                item.put("calendarName", "System Calendar")
                if (descCol >= 0) {
                    item.put("description", cursor.getString(descCol) ?: "")
                } else {
                    item.put("description", "")
                }
                item.put("sourceKey", "$eventId:$startMillis:$endMillisValue")
                events.add(item)
            }
        } ?: run {
            Log.d("WebViewConsole", "Events query returned null cursor")
        }

        return events
    }

    private fun formatCalendarDateTime(millis: Long, allDay: Boolean): String {
        val calendar = java.util.Calendar.getInstance()
        calendar.timeInMillis = millis
        val year = calendar.get(java.util.Calendar.YEAR)
        val month = (calendar.get(java.util.Calendar.MONTH) + 1).toString().padStart(2, '0')
        val day = calendar.get(java.util.Calendar.DAY_OF_MONTH).toString().padStart(2, '0')
        val hour = calendar.get(java.util.Calendar.HOUR_OF_DAY).toString().padStart(2, '0')
        val minute = calendar.get(java.util.Calendar.MINUTE).toString().padStart(2, '0')
        return if (allDay) {
            "${year}-${month}-${day}T00:00"
        } else {
            "${year}-${month}-${day}T${hour}:${minute}"
        }
    }

    private fun postCalendarSyncResult(success: Boolean, message: String?, events: List<JSONObject> = emptyList()) {
        val payload = JSONObject()
        payload.put("ok", success)
        if (message != null) payload.put("message", message)
        payload.put("imported", events.size)
        val eventArray = JSONArray()
        events.forEach { eventArray.put(it) }
        payload.put("events", eventArray)
        val script = "window.handleNativeCalendarSync(${JSONObject.quote(payload.toString())})"
        runOnUiThread {
            webView.evaluateJavascript(script, null)
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    companion object {
        private const val APP_URL = "file:///android_asset/www/index.html"
    }
}
