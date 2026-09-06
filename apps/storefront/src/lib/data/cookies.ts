import 'server-only';
import { cookies as nextCookies } from 'next/headers';

export const getAuthHeaders = async (): Promise<
  { authorization: string } | {}
> => {
  const cookies = await nextCookies();
  const token = cookies.get('_medusa_jwt')?.value;

  if (!token) {
    return {};
  }

  return { authorization: `Bearer ${token}` };
};

export const getCacheTag = async (
  tag: string
): Promise<string> => {
  try {
    const cookies = await nextCookies();
    const cacheId = cookies.get('_medusa_cache_id')?.value;

    if (!cacheId) {
      return '';
    }

    return `${tag}-${cacheId}`;
  } catch (error) {
    return '';
  }
};

export const getCacheOptions = async (
  tag: string
): Promise<{ tags: string[] } | {}> => {
  if (typeof window !== 'undefined') {
    return {};
  }

  const cacheTag = await getCacheTag(tag);

  if (!cacheTag) {
    return {};
  }

  return { tags: [`${cacheTag}`] };
};

export const setAuthToken = async (token: string) => {
  const cookies = await nextCookies();
  cookies.set('_medusa_jwt', token, {
    maxAge: 60 * 60 * 24 * 7,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
};

export const removeAuthToken = async () => {
  const cookies = await nextCookies();
  cookies.set('_medusa_jwt', '', {
    maxAge: -1,
  });
};

export const getCartId = async () => {
  const cookies = await nextCookies();
  return cookies.get('_medusa_cart_id')?.value;
};

export const setCartId = async (cartId: string) => {
  const cookies = await nextCookies();
  cookies.set('_medusa_cart_id', cartId, {
    maxAge: 60 * 60 * 24 * 7,
    httpOnly: true,
    // 'lax', NOT 'strict'. A Strict cookie is not sent on a cross-site top-level
    // navigation — which is exactly what returning from a hosted payment page is.
    // With Strict, a buyer who went to Sifalo, paid, and came back arrived with
    // NO CART: the shop told them their basket had expired moments after taking
    // their money. Found by walking the redirect in a browser, 2026-09-06.
    //
    // Lax still refuses to send this cookie on cross-site POSTs and subresource
    // requests, and it is httpOnly, so the CSRF posture is materially unchanged —
    // and it matches _medusa_jwt, which was already 'lax'. A redirect payment
    // rail is impossible with Strict, and Sifalo is a redirect rail.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
};

export const removeCartId = async () => {
  const cookies = await nextCookies();
  cookies.set('_medusa_cart_id', '', {
    maxAge: -1,
  });
};
