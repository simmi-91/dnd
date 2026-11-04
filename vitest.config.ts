import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'server',
          root: 'apps/server',
          environment: 'node',
          include: ['**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'web',
          root: 'apps/web',
          environment: 'jsdom',
          include: ['**/*.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'packages',
          root: '.',
          environment: 'node',
          include: ['packages/*/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
});
