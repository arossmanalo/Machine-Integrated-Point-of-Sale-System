// Lets Android hand the Arduino to this app when it is plugged in, and remember the
// "always open with Laundry POS" choice, so staff are not asked for USB permission every time.
const fs = require('fs');
const path = require('path');
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
} = require('expo/config-plugins');

const FILTER_NAME = 'usb_device_filter';
const ATTACHED = 'android.hardware.usb.action.USB_DEVICE_ATTACHED';

// Vendor IDs (decimal): Arduino LLC 0x2341, Arduino SRL 0x2A03, WCH CH340 clones 0x1A86.
const VENDOR_IDS = [9025, 10755, 6790];

function filterXml() {
  const devices = VENDOR_IDS.map((id) => `  <usb-device vendor-id="${id}" />`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${devices}\n</resources>\n`;
}

function withFilterFile(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${FILTER_NAME}.xml`), filterXml());
      return cfg;
    },
  ]);
}

function withAttachIntent(config) {
  return withAndroidManifest(config, (cfg) => {
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    activity['intent-filter'] = activity['intent-filter'] ?? [];
    const hasFilter = activity['intent-filter'].some((filter) =>
      (filter.action ?? []).some((action) => action.$['android:name'] === ATTACHED),
    );
    if (!hasFilter) {
      activity['intent-filter'].push({ action: [{ $: { 'android:name': ATTACHED } }] });
    }
    activity['meta-data'] = (activity['meta-data'] ?? []).filter(
      (item) => item.$['android:name'] !== ATTACHED,
    );
    activity['meta-data'].push({
      $: { 'android:name': ATTACHED, 'android:resource': `@xml/${FILTER_NAME}` },
    });
    return cfg;
  });
}

module.exports = function withUsbDeviceFilter(config) {
  return withAttachIntent(withFilterFile(config));
};
