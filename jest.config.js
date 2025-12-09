module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transformIgnorePatterns: [
    "node_modules/(?!ora)",
  ],
  moduleNameMapper: {
    'ora': '<rootDir>/__tests__/mocks/ora.ts'
  },
  testPathIgnorePatterns: [
    "<rootDir>/__tests__/mocks/"
  ]
};
