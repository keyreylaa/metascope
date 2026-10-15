import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/globalSetup.ts"],
    environment: "node",
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: "forks",
    deps: {
      external: ["./src/core/detectors/mlPixel.js"],
    },
  },
  ssr: {
    external: ["./src/core/detectors/mlPixel.js"],
  },
});
