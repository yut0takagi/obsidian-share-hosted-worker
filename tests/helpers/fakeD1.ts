// A D1Database stand-in backed by node:sqlite, so route tests run the real
// schema.sql and every migration instead of string-matched SQL.
// @ts-expect-error -- node builtins are outside the Workers type set this repo compiles against
import { createRequire } from 'node:module'

interface SqliteStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined
  all(...params: unknown[]): Record<string, unknown>[]
  run(...params: unknown[]): { changes: number | bigint }
}
interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}

const nodeRequire = createRequire(import.meta.url)
// vitest 1.x cannot resolve `node:sqlite` through an import statement, so load it at runtime.
const { DatabaseSync } = nodeRequire('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase }
const fs = nodeRequire('node:fs') as {
  readFileSync(p: URL, enc: 'utf8'): string
  readdirSync(p: URL): string[]
  existsSync(p: URL): boolean
}

const SCHEMA_URL = new URL('../../src/db/schema.sql', import.meta.url)
const MIGRATIONS_URL = new URL('../../migrations/', import.meta.url)

class FakeStatement {
  constructor(private db: SqliteDatabase, private sql: string, private params: unknown[] = []) {}

  bind(...params: unknown[]): FakeStatement {
    return new FakeStatement(this.db, this.sql, params)
  }

  async first<T>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params)
    if (!row) return null
    return (column ? row[column] : { ...row }) as T
  }

  async all<T>(): Promise<{ success: true; results: T[]; meta: Record<string, unknown> }> {
    const rows = this.db.prepare(this.sql).all(...this.params)
    return { success: true, results: rows.map((r) => ({ ...r }) as T), meta: {} }
  }

  async run(): Promise<{ success: true; results: []; meta: { changes: number } }> {
    const r = this.db.prepare(this.sql).run(...this.params)
    return { success: true, results: [], meta: { changes: Number(r.changes) } }
  }
}

export class FakeD1 {
  readonly sqlite: SqliteDatabase

  constructor(opts: { migrations?: boolean } = {}) {
    this.sqlite = new DatabaseSync(':memory:')
    this.sqlite.exec('PRAGMA foreign_keys = ON')
    this.sqlite.exec(fs.readFileSync(SCHEMA_URL, 'utf8'))
    if (opts.migrations !== false) this.applyMigrations()
  }

  applyMigrations(): void {
    if (!fs.existsSync(MIGRATIONS_URL)) return
    for (const name of fs.readdirSync(MIGRATIONS_URL).filter((f) => f.endsWith('.sql')).sort()) {
      this.sqlite.exec(fs.readFileSync(new URL(name, MIGRATIONS_URL), 'utf8'))
    }
  }

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this.sqlite, sql)
  }

  async batch(stmts: FakeStatement[]): Promise<unknown[]> {
    this.sqlite.exec('BEGIN')
    try {
      const out = []
      for (const s of stmts) out.push(await s.run())
      this.sqlite.exec('COMMIT')
      return out
    } catch (e) {
      this.sqlite.exec('ROLLBACK')
      throw e
    }
  }

  /** Test helper: run a query directly and return plain rows. */
  rows<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    return this.sqlite.prepare(sql).all(...params).map((r) => ({ ...r }) as T)
  }
}
