'use server';

import { StoreCardShippingMethod } from '@/components/sections/CartShippingMethodsSection/CartShippingMethodsSection';
import { sdk } from '@/lib/client';

import { getAuthHeaders, getCacheOptions } from './cookies';

export const listCartShippingMethods = async (cartId: string, is_return: boolean = false) => {
  const next = {
    ...(await getCacheOptions('fulfillment'))
  };

  return (sdk.store.shippingOptions
    .query({
      cart_id: cartId,
      fields: '+service_zone.fulfillment_set.type,*service_zone.fulfillment_set.location.address',
      fetchOptions: {
        headers: { ...(await getAuthHeaders()) },
        next,
        cache: 'no-cache'
      }
    } as never) as unknown as Promise<{
      // Core returns the options already grouped by seller
      // (`Record<sellerId, ShippingOption[]>`), not a flat array.
      shipping_options:
        | Record<string, StoreCardShippingMethod[]>
        | StoreCardShippingMethod[]
        | null;
    }>)
    .then(({ shipping_options }) => flattenSellerShippingOptions(shipping_options))
    .catch(err => {
      // A SILENCED ERROR HERE IS INDISTINGUISHABLE FROM "THIS CART HAS NO
      // DELIVERY OPTIONS", and the buyer sees an empty Delivery section either
      // way. That cost a full afternoon of diagnosis: the API was returning two
      // options the whole time and this catch was turning whatever went wrong
      // into silence. Failing to fetch is not the same as having nothing, and
      // the log line is what lets anyone tell the difference.
      console.error('[fulfillment] could not list shipping options for cart', cartId, err);
      return null;
    });
};

/**
 * The seller-scoped shipping-options endpoint groups its result by seller id.
 * The delivery section expects a flat list where each option carries
 * `seller_id` / `seller_name`, so lift those off the nested `seller` and
 * flatten. Falls back gracefully if the endpoint ever returns a bare array.
 */
function flattenSellerShippingOptions(
  shipping_options:
    | Record<string, StoreCardShippingMethod[]>
    | StoreCardShippingMethod[]
    | null
): StoreCardShippingMethod[] | null {
  if (!shipping_options) {
    return null;
  }

  // THE SELLER ID IS THE KEY, NOT A FIELD. The endpoint answers with
  // { shipping_options: { "sel_01...": [option, option] } } and the options
  // themselves carry no seller object at all. Object.values() threw the keys
  // away, so every option came out with seller_id and seller_name undefined —
  // and the delivery section drops any group whose first option has no
  // seller_name. Two real options were fetched, flattened, and then filtered
  // into nothing, which the buyer saw as an empty Delivery step with no way to
  // pay. Keep the key.
  const groups: Array<[string | undefined, StoreCardShippingMethod[]]> =
    Array.isArray(shipping_options)
      ? [[undefined, shipping_options]]
      : Object.entries(shipping_options);

  return groups.flatMap(([sellerIdFromKey, options]) =>
    (options ?? []).map(option => {
      const seller = (option as { seller?: { id?: string; name?: string } }).seller;
      return {
        ...option,
        seller_id:
          (option as { seller_id?: string }).seller_id ??
          seller?.id ??
          sellerIdFromKey,
        seller_name:
          (option as { seller_name?: string }).seller_name ?? seller?.name
      } as StoreCardShippingMethod;
    })
  );
}

export const calculatePriceForShippingOption = async (
  optionId: string,
  cartId: string,
  data?: Record<string, unknown>
) => {
  const next = {
    ...(await getCacheOptions('fulfillment'))
  };

  return sdk.store.shippingOptions.$id.calculate
    .mutate({
      $id: optionId,
      cart_id: cartId,
      ...(data ? { data } : {}),
      fetchOptions: {
        headers: { ...(await getAuthHeaders()) },
        next
      }
    })
    .then(({ shipping_option }) => shipping_option)
    .catch(() => {
      return null;
    });
};
