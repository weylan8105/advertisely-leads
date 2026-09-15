import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

// Vitest runs pure unit/characterization tests (Node env, mocked prisma + Meta).
// It never touches a real database or production. The "@/..." alias mirrors
// tsconfig so route handlers resolve their imports.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
});
