const numberFormat = new Intl.NumberFormat();
const dateTimeFormat = new Intl.DateTimeFormat([], {
  dateStyle: 'short',
  timeStyle: 'medium',
});
const usd = { style: 'currency', currency: 'USD' } as const;
const moneyFormat = new Intl.NumberFormat([], usd);
const dollarsFormat = new Intl.NumberFormat([], { ...usd, maximumFractionDigits: 0 });
const shortTimeFormat = new Intl.DateTimeFormat([], {
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
});
const shortDateFormat = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric' });

/** A number with locale grouping, e.g. "1,200". */
export const num = (n: number) => numberFormat.format(n);
/** Full local date and time. */
export const dateTime = (ts: number) => dateTimeFormat.format(ts);
/** US dollars with cents, e.g. "$1,234.50". */
export const formatMoney = (n: number) => moneyFormat.format(n);
/** Whole US dollars, e.g. "$1,235". */
export const formatDollars = (n: number) => dollarsFormat.format(n);
/** Weekday and time, e.g. "Tue 3:45 PM". */
export const formatShortTime = (ts: number) => shortTimeFormat.format(ts);
/** Month and day, e.g. "Oct 22". */
export const formatShortDate = (ts: number) => shortDateFormat.format(ts);
