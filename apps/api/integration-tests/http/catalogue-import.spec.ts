import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { IProductModuleService } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

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
  },
});
