import { defineConfig } from "vitest/config";

// The repo's vitest suite lives in test/. The sdk/ packages ship their own
// runners (Python pytest, Node `node --test`), so scope collection to test/**
// to keep them out of the vitest run.
export default defineConfig({
  test: {
    include: ["test/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
});
