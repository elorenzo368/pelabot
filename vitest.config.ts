import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "scripts/**/*.test.mjs",
      "scripts/**/*.test.ts",
    ],
    exclude: ["tests/live/**", "node_modules/**", "dist/**"],
    coverage: {
      provider: "v8",
      include: ["src/music/**"],
      thresholds: {
        lines: 80,
        statements: 80,
      },
    },
  },
});
