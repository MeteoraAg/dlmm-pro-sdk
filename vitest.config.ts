import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    isolate: false,
    // One worker. The linux x64 LiteSVM addon is unsafe to run in parallel.
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
