import "server-only";

import type { PoolClient, QueryResultRow } from "pg";
import { getPostgresPool } from "./postgres";

const timestampColumns = new Set([
  "access_expires_at", "last_activity_at", "created_at", "updated_at", "expires_at", "claimed_at",
  "accepted_at", "starts_at", "ends_at", "completed_at", "cancelled_at", "previous_starts_at",
  "occurred_at", "proposed_starts_at", "proposed_ends_at", "cancellation_deadline_at", "resolved_at", "read_at",
]);
const booleanColumns = ["is_platform_admin", "is_trial_contact", "can_view_availability", "is_active"];

type QueryExecutor = Pick<PoolClient, "query">;

type ConvertedQuery = { text: string; values: unknown[] };

function questionMarkPositions(sql: string) {
  const positions: number[] = [];
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      if (character === quote && sql[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"') quote = character;
    else if (character === "?") positions.push(index);
  }
  return positions;
}

function splitSqlList(value: string) {
  const result: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index + 1] === quote) index += 1;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      result.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  result.push(value.slice(start).trim());
  return result;
}

function insertPlaceholderColumns(sql: string) {
  const mapping = new Map<number, string>();
  const match = /insert(?:\s+or\s+ignore)?\s+into\s+[\w"]+\s*\(([^)]+)\)\s*values\s*\(/i.exec(sql);
  if (!match || match.index === undefined) return mapping;
  const columns = splitSqlList(match[1]).map((column) => column.replaceAll('"', "").trim());
  const valuesStart = match.index + match[0].length;
  let depth = 1;
  let quote: "'" | '"' | null = null;
  let valuesEnd = valuesStart;
  for (; valuesEnd < sql.length; valuesEnd += 1) {
    const character = sql[valuesEnd];
    if (quote) {
      if (character === quote && sql[valuesEnd + 1] === quote) valuesEnd += 1;
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"') quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")" && --depth === 0) break;
  }
  const beforeCount = questionMarkPositions(sql.slice(0, valuesStart)).length;
  let ordinal = beforeCount;
  splitSqlList(sql.slice(valuesStart, valuesEnd)).forEach((expression, columnIndex) => {
    for (let count = 0; count < questionMarkPositions(expression).length; count += 1) mapping.set(ordinal++, columns[columnIndex]);
  });
  return mapping;
}

function inferredColumn(sql: string, position: number) {
  const before = sql.slice(Math.max(0, position - 120), position);
  const left = /(?:\b[\w"]+\.)?["`]?(\w+)["`]?\s*(?:=|!=|<>|<=|>=|<|>)\s*$/.exec(before);
  if (left) return left[1].toLowerCase();
  const after = sql.slice(position + 1, position + 121);
  const right = /^\s*(?:=|!=|<>|<=|>=|<|>)\s*(?:\b[\w"]+\.)?["`]?([a-zA-Z_]\w*)["`]?/.exec(after);
  return right?.[1].toLowerCase();
}

function normalizeSql(sql: string) {
  const ignore = /^\s*insert\s+or\s+ignore\s+/i.test(sql);
  let normalized = sql.replace(/^\s*insert\s+or\s+ignore\s+/i, (value) => value.replace(/or\s+ignore\s+/i, ""));
  normalized = normalized.replace(/\bauth_subject\b/g, "legacy_auth_subject");
  normalized = normalized.replace(/lower\s*\(\s*hex\s*\(\s*randomblob\s*\(\s*16\s*\)\s*\)\s*\)/gi, "replace(gen_random_uuid()::text, '-', '')");
  for (const column of booleanColumns) {
    const pattern = new RegExp(`\\b${column}\\s*(=|!=|<>)\\s*([01])\\b`, "gi");
    normalized = normalized.replace(pattern, (_whole, operator, value) => `${column} ${operator} ${value === "1" ? "true" : "false"}`);
  }
  if (ignore) normalized = `${normalized.trim().replace(/;$/, "")} ON CONFLICT DO NOTHING`;
  return normalized;
}

export function convertD1Query(sql: string, bindings: unknown[]): ConvertedQuery {
  const insertColumns = insertPlaceholderColumns(sql);
  const positions = questionMarkPositions(sql);
  const values = bindings.map((value, index) => {
    const column = insertColumns.get(index) ?? inferredColumn(sql, positions[index] ?? 0);
    return timestampColumns.has(column ?? "") && typeof value === "number" ? new Date(value) : value;
  });
  let ordinal = 0;
  let quote: "'" | '"' | null = null;
  let text = "";
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      text += character;
      if (character === quote && sql[index + 1] === quote) text += sql[++index];
      else if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
      text += character;
    } else if (character === "?") {
      const placeholder = `$${++ordinal}`;
      text += /^\s+IS\s+NULL\b/i.test(sql.slice(index + 1)) ? `${placeholder}::text` : placeholder;
    }
    else text += character;
  }
  if (ordinal !== values.length) throw new Error(`SQL binding mismatch: expected ${ordinal}, received ${values.length}`);
  return { text: normalizeSql(text), values };
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function normalizeRow<Row extends QueryResultRow>(row: Row) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])) as Row;
}

class PostgresPreparedStatement {
  readonly bindings: unknown[];

  constructor(readonly sql: string, bindings: unknown[] = []) {
    this.bindings = bindings;
  }

  bind(...values: unknown[]) {
    return new PostgresPreparedStatement(this.sql, values);
  }

  private async execute(executor: QueryExecutor = getPostgresPool()) {
    const query = convertD1Query(this.sql, this.bindings);
    return executor.query(query.text, query.values);
  }

  async first<T extends Record<string, unknown>>() {
    const result = await this.execute();
    return result.rows[0] ? normalizeRow(result.rows[0]) as T : null;
  }

  async all<T extends Record<string, unknown>>() {
    const result = await this.execute();
    return { success: true, results: result.rows.map((row) => normalizeRow(row) as T), meta: {} };
  }

  async run(executor?: QueryExecutor) {
    const result = await this.execute(executor);
    return { success: true, results: [], meta: { changes: result.rowCount ?? 0 } };
  }
}

class PostgresD1Database {
  prepare(sql: string) {
    return new PostgresPreparedStatement(sql);
  }

  async batch(statements: PostgresPreparedStatement[]) {
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const results = [];
      for (const statement of statements) results.push(await statement.run(client));
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

const postgresD1 = new PostgresD1Database();

export function getD1(): D1Database {
  if (process.env.NODE_ENV === "production" && process.env.TUTOR_DATA_BACKEND !== "postgres") {
    throw new Error("TUTOR_DATA_BACKEND=postgres is required for the Node production runtime");
  }
  return postgresD1 as unknown as D1Database;
}
