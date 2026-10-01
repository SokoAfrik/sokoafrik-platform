import { medusaIntegrationTestRunner } from "@medusajs/test-utils";

import {
  adminHeaders,
  createAdminUser,
  generatePublishableKey,
  generateStoreHeaders,
} from "../../../../integration-tests/helpers/create-admin-user";
import {
  assignProductsToSeller,
  createVendorProduct,
} from "../../../../integration-tests/helpers/create-product";
import { createSellerUser } from "../../../../integration-tests/helpers/create-seller-user";

jest.setTimeout(120000);

medusaIntegrationTestRunner({
  inApp: true,
  env: { MEDUSA_FF_PRODUCT_REQUEST: "false" },
  testSuite: ({ api, dbConnection, getContainer }) => {
    it("filters_narrow_on_category_attributes_not_free_text_test", async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer());
      const publishableKey = await generatePublishableKey(getContainer());
      const storeHeaders = generateStoreHeaders({ publishableKey });

      const categoryResponse = await api.post(
        "/admin/product-categories",
        { name: "Filterable clothing" },
        adminHeaders,
      );
      expect(categoryResponse.status).toBe(200);
      const categoryId = categoryResponse.data.product_category.id as string;

      const attributeResponse = await api.post(
        "/admin/product-attributes",
        {
          name: "Color",
          type: "multi_select",
          is_filterable: true,
          is_variant_axis: true,
          category_ids: [categoryId],
          values: [{ name: "Red" }, { name: "Blue" }],
        },
        adminHeaders,
      );
      expect(attributeResponse.status).toBe(200);
      const colorAttribute = attributeResponse.data.product_attribute;
      const colorValueId = new Map(
        colorAttribute.values.map((value: { id: string; name: string }) => [
          value.name,
          value.id,
        ]),
      );

      const createProduct = async (
        title: string,
        handle: string,
        color: "Red" | "Blue",
      ) => {
        const response = await api.post(
          "/admin/products",
          {
            title,
            handle,
            status: "published",
            categories: [{ id: categoryId }],
            attributes: [
              {
                id: colorAttribute.id,
                value_ids: [colorValueId.get(color)],
              },
            ],
            variants: [
              {
                title: `${color} variant`,
                options: { Color: color },
              },
            ],
          },
          adminHeaders,
        );

        expect([200, 201]).toContain(response.status);
        return response.data.product.id as string;
      };

      const redAttributeProduct = await createProduct(
        "Plain Linen Dirac",
        "plain-linen-dirac",
        "Red",
      );
      const redTextOnlyProduct = await createProduct(
        "Red Marketing Blue Sandals",
        "red-marketing-blue-sandals",
        "Blue",
      );

      const freeText = await api.get("/store/products", {
        params: { q: "Red" },
        ...storeHeaders,
      });
      expect(freeText.status).toBe(200);
      expect(
        freeText.data.products.map((product: { id: string }) => product.id),
      ).toContain(redTextOnlyProduct);

      const structured = await api.get("/store/products", {
        params: { "attributes[color]": "Red" },
        ...storeHeaders,
      });
      expect(structured.status).toBe(200);
      expect(
        structured.data.products.map((product: { id: string }) => product.id),
      ).toEqual([redAttributeProduct]);
      expect(
        structured.data.products.map((product: { id: string }) => product.id),
      ).not.toContain(redTextOnlyProduct);
    });

    it("structured attribute filters bind a value to the requested attribute handle", async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer());
      const publishableKey = await generatePublishableKey(getContainer());
      const storeHeaders = generateStoreHeaders({ publishableKey });

      const categoryResponse = await api.post(
        "/admin/product-categories",
        { name: "Handle-bound filters" },
        adminHeaders,
      );
      expect(categoryResponse.status).toBe(200);
      const categoryId = categoryResponse.data.product_category.id as string;

      const createAttribute = async (name: "Color" | "Size") => {
        const response = await api.post(
          "/admin/product-attributes",
          {
            name,
            type: "multi_select",
            is_filterable: true,
            is_variant_axis: true,
            category_ids: [categoryId],
            values: [{ name: "Red" }],
          },
          adminHeaders,
        );

        expect(response.status).toBe(200);
        return response.data.product_attribute as {
          id: string;
          values: Array<{ id: string; name: string }>;
        };
      };

      const colorAttribute = await createAttribute("Color");
      const sizeAttribute = await createAttribute("Size");

      const createProduct = async (
        title: string,
        handle: string,
        attributeTitle: "Color" | "Size",
      ) => {
        const attribute =
          attributeTitle === "Color" ? colorAttribute : sizeAttribute;
        const response = await api.post(
          "/admin/products",
          {
            title,
            handle,
            status: "published",
            categories: [{ id: categoryId }],
            attributes: [
              {
                id: attribute.id,
                value_ids: [attribute.values[0].id],
              },
            ],
            variants: [
              {
                title: `${attributeTitle} variant`,
                options: { [attributeTitle]: "Red" },
              },
            ],
          },
          adminHeaders,
        );

        expect([200, 201]).toContain(response.status);
        return response.data.product.id as string;
      };

      const redColorProduct = await createProduct(
        "Red Color Dirac",
        "red-color-dirac",
        "Color",
      );
      const redSizeProduct = await createProduct(
        "Red Size Sandals",
        "red-size-sandals",
        "Size",
      );

      for (const [productId, expectedHandle] of [
        [redColorProduct, "color"],
        [redSizeProduct, "size"],
      ]) {
        const persisted = await api.get(`/store/products/${productId}`, {
          ...storeHeaders,
        });
        expect(persisted.status).toBe(200);
        expect(
          persisted.data.product.product_attribute_values.map(
            (value: { attribute: { handle: string } }) =>
              value.attribute.handle,
          ),
        ).toEqual([expectedHandle]);
      }

      const response = await api.get("/store/products", {
        params: { "attributes[color]": "Red" },
        ...storeHeaders,
      });

      expect(response.status).toBe(200);
      expect(
        response.data.products.map((product: { id: string }) => product.id),
      ).toEqual([redColorProduct]);
      expect(
        response.data.products.map((product: { id: string }) => product.id),
      ).not.toContain(redSizeProduct);
    });

    it("search_matches_somali_words_in_vendor_written_content_test", async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer());
      const seller = await createSellerUser(getContainer(), {
        email: "somali-search-vendor@example.com",
        name: "Somali Search Vendor",
      });
      const publishableKey = await generatePublishableKey(getContainer());
      const storeHeaders = generateStoreHeaders({ publishableKey });

      const matching = await createVendorProduct(api, seller.headers, {
        title: "Shaati Soomaaliyeed",
        sku: "SOMALI-SEARCH-MATCH",
        extra: {
          handle: "shaati-soomaaliyeed",
          description: "Shaati gacmo-dheer ah oo suuf laga sameeyay",
        },
      });
      const distractor = await createVendorProduct(api, seller.headers, {
        title: "Plain cotton shirt",
        sku: "SOMALI-SEARCH-DISTRACTOR",
        extra: {
          handle: "plain-cotton-shirt",
          description: "A short-sleeved everyday shirt",
        },
      });

      await assignProductsToSeller(getContainer(), seller.seller.id, [
        matching.id,
        distractor.id,
      ]);

      for (const q of ["Soomaaliyeed", "gacmo-dheer"]) {
        const response = await api.get("/store/products", {
          params: { q },
          ...storeHeaders,
        });

        expect(response.status).toBe(200);
        expect(
          response.data.products.map((product: { id: string }) => product.id),
        ).toEqual([matching.id]);
      }
    });

    it("Somali vendor-written content search accepts lowercase customer input", async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer());
      const seller = await createSellerUser(getContainer(), {
        email: "somali-lowercase-search-vendor@example.com",
        name: "Somali Lowercase Search Vendor",
      });
      const publishableKey = await generatePublishableKey(getContainer());
      const storeHeaders = generateStoreHeaders({ publishableKey });

      const matching = await createVendorProduct(api, seller.headers, {
        title: "Kabo Soomaaliyeed",
        sku: "SOMALI-LOWERCASE-MATCH",
        extra: {
          handle: "kabo-soomaaliyeed",
          description: "Kabo maqaar ah oo gacanta lagu sameeyay",
        },
      });
      await assignProductsToSeller(getContainer(), seller.seller.id, [
        matching.id,
      ]);

      for (const q of ["soomaaliyeed", "gacanta"]) {
        const response = await api.get("/store/products", {
          params: { q },
          ...storeHeaders,
        });

        expect(response.status).toBe(200);
        expect(
          response.data.products.map((product: { id: string }) => product.id),
        ).toContain(matching.id);
      }
    });

    it("every_impression_carries_all_three_fields_test", async () => {
      await createAdminUser(dbConnection, adminHeaders, getContainer());
      const publishableKey = await generatePublishableKey(getContainer());
      const storeHeaders = generateStoreHeaders({ publishableKey });

      const first = await api.post(
        "/admin/products",
        {
          title: "Impression One",
          handle: "impression-one",
          status: "published",
        },
        adminHeaders,
      );
      const second = await api.post(
        "/admin/products",
        {
          title: "Impression Two",
          handle: "impression-two",
          status: "published",
        },
        adminHeaders,
      );

      expect([200, 201]).toContain(first.status);
      expect([200, 201]).toContain(second.status);

      const response = await api.get("/store/products", {
        params: { id: [first.data.product.id, second.data.product.id] },
        ...storeHeaders,
      });
      expect(response.status).toBe(200);

      const requestId = response.headers["x-soko-request-id"];
      expect(requestId).toEqual(expect.any(String));
      const persisted = await dbConnection.raw(
        `SELECT product_id, position, request_id, model_version
           FROM storefront_impression
          WHERE request_id = ?
          ORDER BY position ASC`,
        [requestId],
      );
      const impressions = persisted.rows;

      expect(impressions).toEqual(
        response.data.products.map(
          (product: { id: string }, index: number) => ({
            product_id: product.id,
            position: index + 1,
            request_id: requestId,
            model_version: "medusa-products-v1",
          }),
        ),
      );
      expect(impressions).toHaveLength(2);
    });

    it("capture_flow_collects_attributes_in_the_same_pass_as_media_test", async () => {
      const seller = await createSellerUser(getContainer(), {
        email: "capture-attributes-media-vendor@example.com",
        name: "Capture Attributes And Media Vendor",
      });
      const images = [
        { url: "https://example.com/capture-front.jpg" },
        { url: "https://example.com/capture-detail.jpg" },
      ];

      const created = await api.post(
        "/vendor/products",
        {
          status: "published",
          title: "Captured Linen Dirac",
          thumbnail: images[0].url,
          images,
          attributes: [
            {
              title: "Material",
              type: "text",
              value: "Linen",
            },
          ],
          variants: [{ title: "Default", sku: "CAPTURE-ATTR-MEDIA" }],
        },
        seller.headers,
      );

      expect([200, 201]).toContain(created.status);
      const product = created.data.product;
      expect(
        product.images.map((image: { url: string }) => image.url).sort(),
      ).toEqual(images.map((image) => image.url).sort());
      expect(product.scoped_attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Material", type: "text" }),
        ]),
      );
      expect(product.product_attribute_values).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "Linen" })]),
      );

      const persisted = await api.get(
        `/vendor/products/${product.id}?fields=images.id,images.url,images.rank,scoped_attributes.*,product_attribute_values.*`,
        seller.headers,
      );

      expect(persisted.status).toBe(200);
      expect(
        persisted.data.product.images
          .map((image: { url: string }) => image.url)
          .sort(),
      ).toEqual(images.map((image) => image.url).sort());
      expect(persisted.data.product.scoped_attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: "Material", type: "text" }),
        ]),
      );
      expect(persisted.data.product.product_attribute_values).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "Linen" })]),
      );
    });
  },
});
