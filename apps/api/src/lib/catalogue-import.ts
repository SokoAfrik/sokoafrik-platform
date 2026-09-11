import type { IProductModuleService, MedusaContainer } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createProductsWorkflow } from "@mercurjs/core/workflows"

export type CatalogueImportItem = {
  sourceId: string
  title: string
}

const sourceHandle = (sourceId: string) => {
  const normalized = sourceId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  if (!normalized) {
    throw new Error("Catalogue source ID must contain a letter or number")
  }
  return `catalogue-${normalized}`
}

/** Imports each source product once, using its stable source ID as the identity. */
export async function importCatalogue(
  container: MedusaContainer,
  sellerId: string,
  items: CatalogueImportItem[]
): Promise<string[]> {
  const products = container.resolve<IProductModuleService>(Modules.PRODUCT)
  const imported: string[] = []
  const handles = items.map((item) => sourceHandle(item.sourceId))

  if (new Set(handles).size !== handles.length) {
    throw new Error("Catalogue feed contains duplicate source products")
  }

  for (const [index, item] of items.entries()) {
    const handle = handles[index]
    const existing = await products.listProducts({ handle })
    if (existing[0]) {
      imported.push(existing[0].id)
      continue
    }

    const { result } = await createProductsWorkflow(container).run({
      input: {
        products: [{
          title: item.title,
          handle,
          status: "draft",
          seller_ids: [sellerId],
        }],
        created_by: sellerId,
      },
    })
    imported.push((result as { id: string }[])[0].id)
  }

  return imported
}
