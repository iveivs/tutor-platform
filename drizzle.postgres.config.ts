import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./drizzle-postgres",
  schema: "./db/postgres/schema.ts",
  dialect: "postgresql",
});
