package com.laundrypos.machineserial

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException

/**
 * Serial link to the machine-lock Arduino over USB OTG. Built from the ArduinoPulser.kt draft.
 * JS side: src/machines/UsbSerialMachineController.ts. This module only moves bytes; the
 * protocol (P<n>, OK, ERR, READY) lives in TypeScript.
 */
class MachineSerialModule : Module() {
  private var port: UsbSerialPort? = null
  private var ioManager: SerialInputOutputManager? = null
  private var pendingPermission: Pair<UsbDevice, (Boolean) -> Unit>? = null

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context is not ready")

  private val usbManager: UsbManager
    get() = context.getSystemService(Context.USB_SERVICE) as UsbManager

  private val deviceReceiver = object : BroadcastReceiver() {
    override fun onReceive(receiverContext: Context, intent: Intent) {
      when (intent.action) {
        ACTION_USB_PERMISSION -> {
          val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
          val waiting = pendingPermission
          pendingPermission = null
          waiting?.second?.invoke(granted)
        }
        UsbManager.ACTION_USB_DEVICE_DETACHED -> {
          if (isOurDevice(intent)) {
            closePort()
            sendEvent("onDevice", mapOf("event" to "detached"))
          }
        }
        UsbManager.ACTION_USB_DEVICE_ATTACHED -> {
          if (isOurDevice(intent)) sendEvent("onDevice", mapOf("event" to "attached"))
        }
      }
    }
  }

  override fun definition() = ModuleDefinition {
    Name("MachineSerial")

    Events("onData", "onDevice")

    OnCreate {
      val filter = IntentFilter().apply {
        addAction(ACTION_USB_PERMISSION)
        addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
      }
      ContextCompat.registerReceiver(context, deviceReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    OnDestroy {
      closePort()
      try {
        context.unregisterReceiver(deviceReceiver)
      } catch (error: IllegalArgumentException) {
        // Already unregistered; nothing to clean up.
      }
    }

    // Plugging the Arduino in launches the activity through the USB intent filter.
    OnNewIntent { intent ->
      if (intent.action == UsbManager.ACTION_USB_DEVICE_ATTACHED) {
        sendEvent("onDevice", mapOf("event" to "attached"))
      }
    }

    AsyncFunction("open") { baudRate: Int, promise: Promise ->
      if (port != null) {
        promise.resolve("opened")
        return@AsyncFunction
      }
      val driver = findDriver()
      if (driver == null) {
        promise.resolve("no-device")
        return@AsyncFunction
      }
      if (usbManager.hasPermission(driver.device)) {
        promise.resolve(openDriver(driver, baudRate))
        return@AsyncFunction
      }
      requestPermission(driver.device) { granted ->
        promise.resolve(if (granted) openDriver(driver, baudRate) else "permission-denied")
      }
    }

    AsyncFunction("write") { text: String ->
      val current = port ?: throw IOException("The lock controller is not connected")
      current.write(text.toByteArray(Charsets.US_ASCII), WRITE_TIMEOUT_MS)
    }

    AsyncFunction("close") {
      closePort()
    }
  }

  private fun findDriver(): UsbSerialDriver? {
    val drivers = UsbSerialProber.getDefaultProber().findAllDrivers(usbManager)
    return drivers.firstOrNull { it.device.vendorId in KNOWN_VENDOR_IDS } ?: drivers.firstOrNull()
  }

  private fun isOurDevice(intent: Intent): Boolean {
    val device: UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
    }
    return device == null || device.vendorId in KNOWN_VENDOR_IDS || device == port?.driver?.device
  }

  private fun requestPermission(device: UsbDevice, onResult: (Boolean) -> Unit) {
    pendingPermission?.second?.invoke(false)
    pendingPermission = device to onResult
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
    val intent = Intent(ACTION_USB_PERMISSION).setPackage(context.packageName)
    val permissionIntent = PendingIntent.getBroadcast(context, 0, intent, flags)
    usbManager.requestPermission(device, permissionIntent)
  }

  private fun openDriver(driver: UsbSerialDriver, baudRate: Int): String {
    val connection = usbManager.openDevice(driver.device) ?: return "failed"
    val candidate = driver.ports.firstOrNull() ?: return "failed"
    return try {
      candidate.open(connection)
      candidate.setParameters(baudRate, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
      candidate.dtr = true
      candidate.rts = true
      port = candidate
      startReading(candidate)
      "opened"
    } catch (error: IOException) {
      try {
        candidate.close()
      } catch (closeError: IOException) {
        // The port never opened fully; the original error is what gets reported.
      }
      "failed"
    }
  }

  private fun startReading(openPort: UsbSerialPort) {
    val manager = SerialInputOutputManager(openPort, object : SerialInputOutputManager.Listener {
      override fun onNewData(data: ByteArray) {
        sendEvent("onData", mapOf("text" to String(data, Charsets.US_ASCII)))
      }

      override fun onRunError(error: Exception) {
        closePort()
        sendEvent("onDevice", mapOf("event" to "detached"))
      }
    })
    ioManager = manager
    manager.start()
  }

  private fun closePort() {
    ioManager?.listener = null
    ioManager?.stop()
    ioManager = null
    try {
      port?.close()
    } catch (error: IOException) {
      // Closing a port whose cable was pulled can fail; the port is gone either way.
    }
    port = null
  }

  companion object {
    private const val ACTION_USB_PERMISSION = "com.laundrypos.machineserial.USB_PERMISSION"
    private const val WRITE_TIMEOUT_MS = 1000

    // Arduino LLC, Arduino SRL, WCH (CH340 clones). Same list as plugins/withUsbDeviceFilter.js.
    private val KNOWN_VENDOR_IDS = setOf(0x2341, 0x2A03, 0x1A86)
  }
}
