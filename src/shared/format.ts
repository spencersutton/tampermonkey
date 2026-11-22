const numberFormat = new Intl.NumberFormat();
const dateTimeFormat = new Intl.DateTimeFormat([], {
  dateStyle: 'short',
  timeStyle: 'medium',
});
const moneyFormat = new Intl.NumberFormat([], { style: 'currency', currency: 'USD' });
const dollarsFormat = new Intl.NumberFormat([], {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
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
export const money = (n: number) => moneyFormat.format(n);
/** Whole US dollars, e.g. "$1,235". */
export const dollars = (n: number) => dollarsFormat.format(n);
/** Weekday and time, e.g. "Tue 3:45 PM". */
export const shortTime = (ts: number) => shortTimeFormat.format(ts);
/** Month and day, e.g. "Oct 22". */
export const shortDate = (ts: number) => shortDateFormat.format(ts);
