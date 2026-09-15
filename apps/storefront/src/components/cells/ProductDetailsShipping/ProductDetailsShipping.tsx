import { ProductPageAccordion } from '@/components/molecules';

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

const isWeekend = (date: Date) => date.getUTCDay() === 0 || date.getUTCDay() === 6;

const nextBusinessDay = (date: Date) => {
  const next = new Date(date);
  do {
    next.setUTCDate(next.getUTCDate() + 1);
  } while (isWeekend(next));
  return next;
};

const deliveryPromise = (now = new Date()) => {
  const localNow = new Date(now.getTime() + EAT_OFFSET_MS);
  let orderBy = new Date(localNow);
  orderBy.setUTCHours(14, 0, 0, 0);

  if (localNow >= orderBy || isWeekend(orderBy)) {
    orderBy = nextBusinessDay(orderBy);
  }

  const deliveryDay = nextBusinessDay(orderBy);
  const formatDay = (date: Date) => {
    const parts = new Intl.DateTimeFormat('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
    }).formatToParts(date);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find(item => item.type === type)?.value;

    return `${part('weekday')}, ${part('day')} ${part('month')}`;
  };

  return `Order by ${formatDay(orderBy)} at 14:00 EAT for delivery on ${formatDay(deliveryDay)}.`;
};

export const ProductDetailsShipping = () => {
  return (
    <ProductPageAccordion
      heading='Shipping & Returns'
      defaultOpen={false}
    >
      <div className='product-details'>
        <ul>
          <li data-testid='delivery-promise'>
            {deliveryPromise()}
          </li>
          <li>
            Returns are accepted within 30 days when the item
            is in its original condition and packaging.
          </li>
        </ul>
      </div>
    </ProductPageAccordion>
  );
};
