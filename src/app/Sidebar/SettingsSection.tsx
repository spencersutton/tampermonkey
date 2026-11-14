import {
  DEFAULT_SYNC_MINUTES,
  DEFAULT_TITLE_LINES,
  KEYS,
  MIN_SYNC_MINUTES,
} from '../../shared/keys';
import { AccountSettings } from '../auth';
import { getSetting, setSetting } from '../settings';
import { parseNum } from '../util';
import { Collapsible } from './Collapsible';
import { NumberInput } from './NumberInput';

/** Pickup location, full-refresh interval, title lines and the account. */
export function SettingsSection() {
  const minutes = getSetting(KEYS.syncMinutes);
  const setMinutes = (value: ReturnType<typeof getSetting<typeof KEYS.syncMinutes>>) =>
    setSetting(KEYS.syncMinutes, value);
  const titleLines = getSetting(KEYS.titleLines);
  const setTitleLines = (value: ReturnType<typeof getSetting<typeof KEYS.titleLines>>) =>
    setSetting(KEYS.titleLines, value);
  return (
    <section class="panel">
      <Collapsible id="settings" title={<h2>Settings</h2>}>
        <NumberInput
          label={`Full catalog refresh at most every (minutes, min ${MIN_SYNC_MINUTES})`}
          value={minutes}
          parse={(text) =>
            Math.max(MIN_SYNC_MINUTES, Math.round(parseNum(text) ?? DEFAULT_SYNC_MINUTES))
          }
          onChange={setMinutes}
          type="number"
          min={MIN_SYNC_MINUTES}
          step={1}
        />
        <NumberInput
          label="Lot title lines in the grid (0 = show in full)"
          value={titleLines}
          parse={(text) => Math.max(0, Math.round(parseNum(text) ?? DEFAULT_TITLE_LINES))}
          onChange={setTitleLines}
          type="number"
          min={0}
          step={1}
        />
        <AccountSettings />
      </Collapsible>
    </section>
  );
}
