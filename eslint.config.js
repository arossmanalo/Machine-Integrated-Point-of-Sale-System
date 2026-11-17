// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const nativeModuleImports = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['**/modules/machine-serial', '**/modules/machine-serial/**'],
          message: 'Only src/machines/UsbSerialMachineController.ts may use the USB module.',
        },
        {
          group: ['**/modules/receipt-printer', '**/modules/receipt-printer/**'],
          message: 'Only src/printing/BluetoothReceiptPrinter.ts may use the printer module.',
        },
      ],
    },
  ],
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'drizzle/*'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/machines/UsbSerialMachineController.ts',
      'src/printing/BluetoothReceiptPrinter.ts',
    ],
    rules: nativeModuleImports,
  },
]);
