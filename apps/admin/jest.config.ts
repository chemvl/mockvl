import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'jsdom',
  testEnvironmentOptions: {
    url: 'http://localhost:8000',
  },
  testPathIgnorePatterns: ['/node_modules/', '/.worktrees/'],
  // @ant-design/colors v8 ships ESM only — let ts-jest downlevel it. The two
  // alternations cover bun's isolated store path and the plain symlink path.
  transformIgnorePatterns: [
    'node_modules/(?!\\.bun/@ant-design\\+colors|@ant-design/colors/)',
  ],
  moduleNameMapper: {
    '\\.md$': '<rootDir>/tests/__mocks__/raw.js',
    '^mermaid$': '<rootDir>/tests/__mocks__/mermaid.js',
    '^@/(.*)$': '<rootDir>/src/$1',
    // Workspace package ships raw TS — point jest at the source entry.
    '^@starter/schemas$': '<rootDir>/../../packages/schemas/src/index.ts',
  },
  transform: {
    // The app tsconfig targets ESNext/bundler (Vite); jest needs CommonJS.
    '^.+\\.(t|j)sx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          moduleResolution: 'node',
          allowJs: true,
          // node10 resolution cannot read the exports-only workspace package;
          // mirror the runtime moduleNameMapper for the type-checker.
          baseUrl: '.',
          paths: {
            '@/*': ['./src/*'],
            '@root/*': ['./*'],
            '@starter/schemas': ['../../packages/schemas/src/index.ts'],
          },
        },
      },
    ],
  },
  setupFiles: ['./tests/setupTests.jsx'],
  globals: {
    __APP_VERSION__: 'test',
    __UMI_VERSION__: '',
    __UTOO_VERSION__: '',
  },
};

export default config;
