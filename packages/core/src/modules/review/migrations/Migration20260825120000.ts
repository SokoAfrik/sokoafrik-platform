import { Migration } from "@medusajs/framework/mikro-orm/migrations"

/**
 * SokoAfrik: driver reviews, stored reference_id, and buyer photos.
 *
 * The `reference` check constraint has to be dropped and rebuilt — Postgres will
 * not widen a CHECK in place. Existing rows are all 'product' or 'seller', so the
 * new constraint accepts every row already in the table.
 */
export class Migration20260825120000 extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table if exists "review" add column if not exists "reference_id" text null;`
    )
    this.addSql(
      `alter table if exists "review" add column if not exists "images" jsonb null;`
    )
    // widen the reference enum to include 'driver'
    this.addSql(`alter table if exists "review" drop constraint if exists "review_reference_check";`)
    this.addSql(
      `alter table if exists "review" add constraint "review_reference_check" ` +
        `check ("reference" in ('product', 'seller', 'driver'));`
    )
    // every review of one thing, without a link traversal
    this.addSql(
      `CREATE INDEX IF NOT EXISTS "IDX_review_reference" ON "review" ("reference", "reference_id") WHERE deleted_at IS NULL;`
    )
  }

  override async down(): Promise<void> {
    this.addSql(`DROP INDEX IF EXISTS "IDX_review_reference";`)
    this.addSql(`alter table if exists "review" drop constraint if exists "review_reference_check";`)
    // narrowing back would orphan driver rows, so remove them first
    this.addSql(`delete from "review" where "reference" = 'driver';`)
    this.addSql(
      `alter table if exists "review" add constraint "review_reference_check" ` +
        `check ("reference" in ('product', 'seller'));`
    )
    this.addSql(`alter table if exists "review" drop column if exists "images";`)
    this.addSql(`alter table if exists "review" drop column if exists "reference_id";`)
  }
}
