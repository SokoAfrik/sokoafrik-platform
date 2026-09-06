import { NextRequest, NextResponse } from 'next/server';
import { completeSifaloReturn } from '@/lib/data/sifalo';

/**
 * Where Sifalo sends the buyer after the hosted checkout.
 *
 * This is a ROUTE HANDLER, not a page, and deliberately so: finishing the order
 * revalidates cached data, and Next.js forbids revalidation during a render.
 * The first version was a page and failed with exactly that — after the buyer
 * had paid, which is the worst place to discover a framework rule.
 *
 * It decides nothing about the payment. It hands the session id to the server,
 * which verifies it with Sifalo; on success placeOrder redirects to the order
 * confirmation and the buyer never sees this route at all.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ locale: string }> }) {
  const { locale } = await ctx.params;
  const sid = req.nextUrl.searchParams.get('sid') ?? '';
  const ref = req.nextUrl.searchParams.get('ref') ?? '';

  const result = await completeSifaloReturn(sid);

  // Getting here at all means the order was not placed — placeOrder redirects on
  // success. Send the buyer somewhere that tells the truth and gives them the
  // reference, rather than leaving them on a blank URL.
  const reason =
    result && typeof result === 'object' && 'error' in result && result.error
      ? String(result.error)
      : 'The payment could not be confirmed.';

  const url = new URL(`/${locale}/checkout/sifalo-return/unconfirmed`, req.nextUrl.origin);
  url.searchParams.set('ref', sid || ref);
  url.searchParams.set('reason', reason.slice(0, 300));
  return NextResponse.redirect(url);
}
