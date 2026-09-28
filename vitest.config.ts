import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    isolate: false,
    // One worker. Parallel LiteSVM processes abort on the linux CI runner.
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    disableConsoleIntercept: true,
    include: ["tests/**/*.test.ts"],
    sequence: {
      concurrent: false,
      shuffle: false,
    },
  },
});
