import LocalizedClientLink from '@/components/molecules/LocalizedLink/LocalizedLink';
import { Button } from '@/components/atoms';

/**
 * The buyer got here because the payment did not confirm.
 *
 * It never says "payment failed". They may well have paid — an unreachable
 * gateway, a pending wallet confirmation and a genuine refusal are
 * indistinguishable from this side, and telling someone who has paid that they
 * have not is the worst thing this page could do. It says we cannot confirm it
 * yet, and gives them the reference to quote.
 */
export default async function SifaloUnconfirmedPage(props: {
  searchParams: Promise<{ ref?: string; reason?: string }>;
}) {
  const { ref = '', reason = '' } = await props.searchParams;

  return (
    <main className="container">
      <div className="mx-auto max-w-xl py-16 text-center">
        <h1 className="heading-md uppercase mb-4">We could not confirm your payment yet</h1>
        <p className="text-secondary mb-2">
          If money left your account it is not lost, and you have not been charged twice. Quote this
          reference and we will finish the order for you.
        </p>
        <p className="my-6 font-mono text-lg">{ref || 'no reference returned'}</p>
        {reason ? <p className="text-secondary mb-6">{reason}</p> : null}
        <LocalizedClientLink href="/cart">
          <Button variant="tonal">Back to your basket</Button>
        </LocalizedClientLink>
      </div>
    </main>
  );
}
