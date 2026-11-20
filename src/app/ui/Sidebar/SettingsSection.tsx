import {
  DEFAULT_SYNC_MINUTES,
  DEFAULT_TITLE_LINES,
  MIN_SYNC_MINUTES,
} from '../../../shared/constants';
import { KEYS } from '../../../shared/keys';
import { parseNum } from '../../logic/util';
import { useSetting } from '../../server/settings';
import { AccountSettings } from '../Auth';
import { Collapsible } from './Collapsible';
import { NumberInput } from './NumberInput';

/** Pickup location, full-refresh interval, title lines and the account. */
export function SettingsSection() {
  const [minutes, setMinutes] = useSetting(KEYS.syncMinutes);
  const [titleLines, setTitleLines] = useSetting(KEYS.titleLines);
  return (
    <section class="panel">
      <Collapsible id="settings" title={<h2>Settings</h2>}>
        <NumberInput
          label={`Full catalog refresh at most every (minutes, min ${MIN_SYNC_MINUTES})`}
          value={minutes}
          parse={text =>
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
          parse={text => Math.max(0, Math.round(parseNum(text) ?? DEFAULT_TITLE_LINES))}
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
