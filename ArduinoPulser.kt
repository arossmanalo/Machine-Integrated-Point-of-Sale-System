package com.yourshop.pos.machines // change to your app's package

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbManager
import android.os.Build
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * Sends pulse commands to the Arduino over USB (OTG).
 * Command format: "P<machineNumber>\n"  ->  Arduino pulses that machine's LED.
 *
 * Usage:
 *   val pulser = ArduinoPulser(context)
 *   lifecycleScope.launch {
 *       if (pulser.connect() == ArduinoPulser.ConnectResult.Connected) {
 *           pulser.pulse(3)   // pulse machine 3
 *       }
 *   }
 */
class ArduinoPulser(private val context: Context) {

    enum class ConnectResult { Connected, NoDevice, PermissionRequested, Failed }

    private val usbManager = context.getSystemService(Context.USB_SERVICE) as UsbManager
    private var port: UsbSerialPort? = null

    val isConnected: Boolean get() = port != null

    /** Finds the Arduino, asks for USB permission if needed, and opens the port. */
    suspend fun connect(): ConnectResult = withContext(Dispatchers.IO) {
        if (port != null) return@withContext ConnectResult.Connected

        val driver = UsbSerialProber.getDefaultProber()
            .findAllDrivers(usbManager)
            .firstOrNull() ?: return@withContext ConnectResult.NoDevice

        if (!usbManager.hasPermission(driver.device)) {
            // Shows the system "Allow access to USB device?" dialog.
            // After the user taps OK, call connect() again.
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)
                PendingIntent.FLAG_MUTABLE else 0
            val intent = Intent(ACTION_USB_PERMISSION).setPackage(context.packageName)
            val permissionIntent = PendingIntent.getBroadcast(context, 0, intent, flags)
            usbManager.requestPermission(driver.device, permissionIntent)
            return@withContext ConnectResult.PermissionRequested
        }

        val connection = usbManager.openDevice(driver.device)
            ?: return@withContext ConnectResult.Failed

        try {
            val p = driver.ports[0]
            p.open(connection)
            p.setParameters(9600, 8, UsbSerialPort.STOPBITS_1, UsbSerialPort.PARITY_NONE)
            delay(2000) // Arduino Uno/Nano resets when the port opens; wait for it to boot
            port = p
            ConnectResult.Connected
        } catch (e: IOException) {
            ConnectResult.Failed
        }
    }

    /** Pulses the LED for the given machine (1-based). Returns false if not sent. */
    suspend fun pulse(machineNumber: Int): Boolean = withContext(Dispatchers.IO) {
        val p = port ?: return@withContext false
        try {
            p.write("P$machineNumber\n".toByteArray(), WRITE_TIMEOUT_MS)
            true
        } catch (e: IOException) {
            disconnect() // cable unplugged etc.; call connect() again
            false
        }
    }

    fun disconnect() {
        try { port?.close() } catch (_: IOException) { }
        port = null
    }

    companion object {
        private const val ACTION_USB_PERMISSION = "com.yourshop.pos.USB_PERMISSION"
        private const val WRITE_TIMEOUT_MS = 1000
    }
}
