export const defaultStoreRetrieveOrderGroupFields = [
    "id",
    "customer_id",
    "cart_id",
    "seller_count",
    "total",
    "created_at",
    "updated_at",
    // The ids of the orders this cart split into. A GUEST cannot read
    // /store/order-groups/:id (it authenticates a customer) but CAN read
    // /store/orders/:id, so without at least one order id the storefront has
    // no page it is able to show someone who has just paid.
    "orders.id",
]

export const storeCompleteCartQueryConfig = {
    defaults: defaultStoreRetrieveOrderGroupFields,
    isList: false,
}
