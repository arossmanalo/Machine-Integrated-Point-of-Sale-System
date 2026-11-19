// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

const printerModule = {
  group: ['**/modules/receipt-printer', '**/modules/receipt-printer/**'],
  message: 'Only src/printing/BluetoothReceiptPrinter.ts may use the printer module.',
};

const lockController = {
  group: ['**/machines/WifiMachineController'],
  message: 'Only src/state/AppProvider.tsx creates the lock controller. Use the MachineController from useApp().',
};

const restrict = (...patterns) => ({ 'no-restricted-imports': ['error', { patterns }] });

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', 'android/*', 'drizzle/*'],
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/printing/BluetoothReceiptPrinter.ts', 'src/state/AppProvider.tsx', 'src/**/__tests__/**'],
    rules: restrict(printerModule, lockController),
  },
  {
    files: ['src/printing/BluetoothReceiptPrinter.ts'],
    rules: restrict(lockController),
  },
  {
    files: ['src/state/AppProvider.tsx'],
    rules: restrict(printerModule),
  },
]);
