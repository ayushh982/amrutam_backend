export default {
  testEnvironment: 'node',
  transform: {},
  setupFiles: ['./tests/helpers/setup.js'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/tests/**/*.test.js'],
  verbose: true,
  testTimeout: 10000,
};
