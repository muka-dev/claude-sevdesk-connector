import { defineConfig } from "vitest/config";

// Thresholds per file group (docs/TESTING.md, section 4): critical modules 90 %, rest 70 %.
const critical = { lines: 90, branches: 90, functions: 90, statements: 90 };
const rest = { lines: 70, branches: 70, functions: 70, statements: 70 };

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/main.ts"], // thin start-up wiring, covered by the stdio smoke test below
      thresholds: {
        "src/analytics/**": critical,
        "src/redact/**": critical,
        "src/sevdesk/client.ts": rest,
        "src/tools.ts": rest,
        "src/server.ts": rest,
      },
    },
  },
});
