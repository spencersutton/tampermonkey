// What each condition means, as the site explains it ("About conditions" on
// its catalog). Fetched once per page load and shared.
import { signal } from '@preact/signals';
import { fetchConditions, type ConditionInfo } from './api';

let loading = false;

/** The conditions by value; fetched the first time something reads it (and again on a later read if that fails). */
const conditions = signal(new Map<number, ConditionInfo>(), {
  watched() {
    if (!loading && !this.peek().size) {
      loading = true;
      fetchConditions().then(
        (list) => (this.value = new Map(list.map((c) => [c.value, c]))),
        () => (loading = false),
      );
    }
  },
});

/** The site's conditions by value (empty until fetched, or if that fails). */
export const siteConditions = () => conditions.value;
