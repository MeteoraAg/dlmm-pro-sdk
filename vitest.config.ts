import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    isolate: false,
    fileParallelism: false,
    maxConcurrency: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    include: ["tests/**/*.test.ts"],
    sequence: {
      concurrent: false,
      shuffle: false,
    },
  },
});
