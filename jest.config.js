module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  // expo/virtual/env: babel-preset-expo reads EXPO_PUBLIC_ variables through it.
  transformIgnorePatterns: ['/node_modules/(?!(@noble/hashes|expo/virtual)/)'],
};
