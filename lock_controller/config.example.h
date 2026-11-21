// Copy this file to config.h (which git ignores) and fill it in before uploading.

// The shop Wi-Fi the tablet uses. The ESP32 only supports 2.4 GHz networks.
#define WIFI_SSID "shop-wifi-name"
#define WIFI_PASSWORD "shop-wifi-password"

// Shared passphrase, at least 12 characters. Enter exactly the same text in the app under
// Manage > Machines > Key. Anyone who knows it can start machines, so keep it private.
#define LOCK_KEY "change-this-lock-key"

// Optional fixed address, so the address saved in the app never changes. Pick one no other
// device uses, ideally outside the router's DHCP range. Remove these three lines to let the
// router choose (then reserve the address in the router instead).
#define STATIC_IP "192.168.1.200"
#define STATIC_GATEWAY "192.168.1.1"
#define STATIC_SUBNET "255.255.255.0"
