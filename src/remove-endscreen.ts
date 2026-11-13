import { configRead } from './config';
import { addJsonFilter } from './hooks/json-parse';

addJsonFilter('endscreen', (r) => {
  if (!configRead('removeEndscreen')) return;
  const endscreen = r.endscreen;
  if (
    endscreen &&
    typeof endscreen === 'object' &&
    'endscreenRenderer' in endscreen
  ) {
    delete r.endscreen;
  }
});
