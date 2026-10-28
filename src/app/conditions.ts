// What each condition means, as the site explains it ("About conditions" on
// its catalog). Fetched once per page load and shared.
import { useEffect, useState } from 'preact/hooks';
import { fetchConditions, type ConditionInfo } from './api';

let loaded: Map<number, ConditionInfo> | null = null;
let loading: Promise<Map<number, ConditionInfo>> | null = null;

function load(): Promise<Map<number, ConditionInfo>> {
  loading ??= fetchConditions().then(
    (list) => (loaded = new Map(list.map((c) => [c.value, c]))),
    (e) => {
      loading = null; // try again next time
      throw e;
    },
  );
  return loading;
}

/** Preact hook: the site's conditions by value (empty until fetched, or if that fails). */
export function useConditions(): Map<number, ConditionInfo> {
  const [map, setMap] = useState(() => loaded ?? new Map<number, ConditionInfo>());
  useEffect(() => {
    if (!loaded) {
      load().then(setMap, () => {});
    }
  }, []);
  return map;
}
