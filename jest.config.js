module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transformIgnorePatterns: ['/node_modules/(?!(@noble/hashes)/)'],
};
