import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { IProductModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";

import { createSellerUser } from "../../../../integration-tests/helpers/create-seller-user";
import { importCatalogue } from "../../src/lib/catalogue-import";

jest.setTimeout(120000);

medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ getContainer }) => {
    it("catalogue_import_is_idempotent_test", async () => {
      const container = getContainer();
      const { seller } = await createSellerUser(container, {
        email: "catalogue-import@sokoafrik.test",
        name: "Catalogue Import Vendor",
      });
      const feed = [
        { sourceId: "BAK-001", title: "Blue Dirac" },
        { sourceId: "BAK-002", title: "Leather Sandals" },
      ];

      const first = await importCatalogue(container, seller.id, feed);
      const replay = await importCatalogue(container, seller.id, feed);

      expect(replay).toEqual(first);
      expect(new Set(first).size).toBe(feed.length);

      const products = container.resolve<IProductModuleService>(
        Modules.PRODUCT,
      );
      const persisted = await products.listProducts({
        handle: feed.map(
          ({ sourceId }) => `catalogue-${sourceId.toLowerCase()}`,
        ),
      });
      expect(persisted.map(({ id }) => id).sort()).toEqual([...first].sort());
    });

    it("catalogue replay preserves source identity across feed order", async () => {
      const container = getContainer();
      const { seller } = await createSellerUser(container, {
        email: "catalogue-reordered-replay@sokoafrik.test",
        name: "Catalogue Reordered Replay Vendor",
      });
      const feed = [
        { sourceId: "ORDER-001", title: "Blue Dirac" },
        { sourceId: "ORDER-002", title: "Leather Sandals" },
      ];

      const first = await importCatalogue(container, seller.id, feed);
      const replay = await importCatalogue(container, seller.id, [...feed].reverse());

      expect(replay).toEqual([...first].reverse());

      const products = container.resolve<IProductModuleService>(
        Modules.PRODUCT,
      );
      const persisted = await products.listProducts({
        handle: feed.map(
          ({ sourceId }) => `catalogue-${sourceId.toLowerCase()}`,
        ),
      });
      expect(persisted).toHaveLength(feed.length);
      expect(persisted.map(({ id }) => id).sort()).toEqual([...first].sort());
    });

    it("duplicate_products_refused_test", async () => {
      const container = getContainer();
      const { seller } = await createSellerUser(container, {
        email: "catalogue-duplicate@sokoafrik.test",
        name: "Catalogue Duplicate Vendor",
      });
      const products = container.resolve<IProductModuleService>(
        Modules.PRODUCT,
      );

      await expect(importCatalogue(container, seller.id, [
        { sourceId: "BAK-001", title: "Blue Dirac" },
        { sourceId: " bak 001 ", title: "Duplicate Blue Dirac" },
      ])).rejects.toThrow("Catalogue feed contains duplicate source products");

      const persisted = await products.listProducts({
        handle: ["catalogue-bak-001"],
      });
      expect(persisted).toHaveLength(0);
    });

    it("vendor_product_counts_reconcile_test", async () => {
      const container = getContainer();
      const { seller: firstSeller } = await createSellerUser(container, {
        email: "catalogue-count-first@sokoafrik.test",
        name: "Catalogue Count First Vendor",
      });
      const { seller: secondSeller } = await createSellerUser(container, {
        email: "catalogue-count-second@sokoafrik.test",
        name: "Catalogue Count Second Vendor",
      });
      const feeds = new Map([
        [firstSeller.id, [
          { sourceId: "COUNT-A-001", title: "First Vendor Dirac" },
          { sourceId: "COUNT-A-002", title: "First Vendor Sandals" },
          { sourceId: "COUNT-A-003", title: "First Vendor Basket" },
        ]],
        [secondSeller.id, [
          { sourceId: "COUNT-B-001", title: "Second Vendor Dirac" },
          { sourceId: "COUNT-B-002", title: "Second Vendor Sandals" },
        ]],
      ]);

      const importedBySeller = new Map<string, string[]>();
      for (const [sellerId, feed] of feeds) {
        importedBySeller.set(
          sellerId,
          await importCatalogue(container, sellerId, feed),
        );
      }

      const query = container.resolve(ContainerRegistrationKeys.QUERY);
      const { data: links } = await query.graph({
        entity: "product_seller",
        fields: ["product_id", "seller_id"],
        filters: { seller_id: [...feeds.keys()] },
      });

      for (const [sellerId, feed] of feeds) {
        const linkedProductIds = links
          .filter((link: { seller_id: string }) => link.seller_id === sellerId)
          .map((link: { product_id: string }) => link.product_id)
          .sort();
        expect(linkedProductIds).toEqual(
          [...(importedBySeller.get(sellerId) ?? [])].sort(),
        );
        expect(linkedProductIds).toHaveLength(feed.length);
      }
    });
  },
});
