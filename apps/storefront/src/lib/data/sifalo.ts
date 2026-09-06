'use server';

import { getCartId } from './cookies';
import { placeOrder } from './cart';

/**
 * The buyer has come back from Sifalo's hosted checkout.
 *
 * Two steps, in this order, and the order matters:
 *   1. record the session id against the cart's payment session, server-side;
 *   2. complete the cart, which is what makes Medusa call authorizePayment,
 *      which is what makes OUR SERVER call verify.php.
 *
 * The browser is never the authority here. It carries a reference back and
 * nothing more — the customer controls this URL, and an order becomes paid only
 * because our own call to Sifalo said "success" at the amount we asked for.
 *
 * This uses a plain fetch rather than the sdk: the sdk in this app is generated
 * per route and has no entry for a custom one, and casting it loose to reach a
 * route it does not know about would hide exactly the kind of drift that casting
 * is supposed to prevent.
 */
export async function completeSifaloReturn(sid: string) {
  const cartId = await getCartId();
  if (!cartId) {
    return {
      ok: false,
      error:
        'Your basket has expired. Nothing has been charged twice — if money left your account, contact us with your payment reference.'
    };
  }
  if (!sid) {
    return {
      ok: false,
      error: 'Sifalo did not send a payment reference back, so this payment cannot be confirmed yet.'
    };
  }

  const backend = process.env.MEDUSA_BACKEND_URL;
  const key = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY;
  if (!backend) {
    return { ok: false, error: 'The shop is misconfigured and cannot confirm payments right now.' };
  }

  try {
    const res = await fetch(`${backend}/store/sifalo/return`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(key ? { 'x-publishable-api-key': key } : {})
      },
      body: JSON.stringify({ cart_id: cartId, sid }),
      cache: 'no-store'
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `That payment reference could not be recorded (${res.status}). ${body.slice(0, 200)}` };
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'That payment reference could not be recorded.' };
  }

  // placeOrder redirects on success, so anything returned here is a failure.
  return await placeOrder(cartId);
}
