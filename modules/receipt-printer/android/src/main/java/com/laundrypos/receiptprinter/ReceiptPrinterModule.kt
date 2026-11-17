package com.laundrypos.receiptprinter

import android.annotation.SuppressLint
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.util.Base64
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.util.UUID

class PrinterException(message: String, cause: Throwable? = null) :
  CodedException("ERR_PRINTER", message, cause)

/**
 * Sends ESC/POS bytes to a paired Bluetooth thermal printer over the serial port profile.
 * Ported from the old app's PrintUtils.kt, including its connection fallbacks. The receipt
 * layout is built in TypeScript (src/printing/escpos.ts); this module only delivers the bytes.
 * JS must have the BLUETOOTH_CONNECT permission before calling (Android 12+).
 */
class ReceiptPrinterModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw PrinterException("App is not ready")

  override fun definition() = ModuleDefinition {
    Name("ReceiptPrinter")

    AsyncFunction("listPairedPrinters") {
      pairedPrinters().map { device ->
        mapOf("name" to (device.name ?: "Unknown printer"), "address" to device.address)
      }
    }

    AsyncFunction("print") { address: String, base64Bytes: String ->
      val device = pairedPrinters().firstOrNull { it.address == address }
        ?: throw PrinterException("The printer is not paired with this tablet. Pair it in Android Bluetooth settings.")
      val bytes = Base64.decode(base64Bytes, Base64.DEFAULT)
      send(device, bytes)
    }
  }

  @SuppressLint("MissingPermission")
  private fun pairedPrinters(): List<BluetoothDevice> {
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    val adapter = manager.adapter ?: throw PrinterException("This tablet has no Bluetooth.")
    if (!adapter.isEnabled) throw PrinterException("Bluetooth is off. Turn it on and try again.")
    return try {
      adapter.bondedDevices.filter { device ->
        // Skip headphones and phones; printers report as imaging or uncategorized.
        val major = device.bluetoothClass?.majorDeviceClass
        major == null || major == BluetoothClass.Device.Major.IMAGING ||
          major == BluetoothClass.Device.Major.UNCATEGORIZED
      }
    } catch (error: SecurityException) {
      throw PrinterException("Bluetooth permission was not granted.", error)
    }
  }

  @SuppressLint("MissingPermission")
  private fun connect(device: BluetoothDevice): BluetoothSocket {
    val attempts = listOf<() -> BluetoothSocket>(
      { device.createRfcommSocketToServiceRecord(SPP_UUID) },
      { device.createInsecureRfcommSocketToServiceRecord(SPP_UUID) },
      {
        // Some cheap printers only accept a direct channel-1 socket.
        val method = device.javaClass.getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
        method.invoke(device, 1) as BluetoothSocket
      },
    )
    var lastError: Exception? = null
    for (attempt in attempts) {
      var socket: BluetoothSocket? = null
      try {
        socket = attempt()
        socket.connect()
        return socket
      } catch (error: Exception) {
        lastError = error
        try {
          socket?.close()
        } catch (closeError: IOException) {
          // The socket never connected; try the next method.
        }
      }
    }
    throw PrinterException("Could not connect to the printer. Make sure it is on and nearby.", lastError)
  }

  @SuppressLint("MissingPermission")
  private fun send(device: BluetoothDevice, bytes: ByteArray) {
    val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    try {
      manager.adapter?.cancelDiscovery()
    } catch (error: SecurityException) {
      // Discovery was not running or not permitted; connecting still works without it.
    }
    val socket = connect(device)
    try {
      socket.outputStream.write(bytes)
      socket.outputStream.flush()
      // Give the printer time to drain its buffer before the link closes.
      Thread.sleep(PRINT_DRAIN_MS)
    } catch (error: IOException) {
      throw PrinterException("The printer disconnected while printing.", error)
    } finally {
      try {
        socket.close()
      } catch (error: IOException) {
        // Already closed by the printer.
      }
    }
  }

  companion object {
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    private const val PRINT_DRAIN_MS = 1500L
  }
}
