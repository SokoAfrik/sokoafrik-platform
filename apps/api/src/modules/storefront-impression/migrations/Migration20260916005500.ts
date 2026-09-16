import { Migration } from "@medusajs/framework/mikro-orm/migrations"

export class Migration20260916005500 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`create table if not exists "storefront_impression" ("id" text not null, "product_id" text not null, "position" integer not null, "request_id" text not null, "model_version" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "storefront_impression_pkey" primary key ("id"));`)
    this.addSql(`create index if not exists "IDX_storefront_impression_deleted_at" on "storefront_impression" ("deleted_at") where deleted_at is null;`)
    this.addSql(`create unique index if not exists "IDX_storefront_impression_request_position_unique" on "storefront_impression" ("request_id", "position") where deleted_at is null;`)
    this.addSql(`create index if not exists "IDX_storefront_impression_product_created" on "storefront_impression" ("product_id", "created_at") where deleted_at is null;`)
  }

  override async down(): Promise<void> {
    // Impression history is append-only operational evidence. A rollback leaves it
    // intact rather than silently deleting analytics data.
  }
}
