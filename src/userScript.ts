// Order matters: storage guard and response/style hooks must be installed
// before YouTube starts loading data and rendering tiles.
import 'whatwg-fetch';
import './domrect-polyfill';

import './config';
import './hooks/json-parse';
import './hooks/json-stringify';
import './hooks';
import './thumbnail-quality';
import './player-animation';
import './app_api/index';

import { handleLaunch } from './utils';

document.addEventListener(
  'webOSRelaunch',
  (evt) => {
    console.info('RELAUNCH:', evt, window.launchParams);
    handleLaunch(evt.detail);
  },
  true
);

import './adblock';
import './shorts';
import './remove-endscreen';
import './preview-adoption';
import './settings/native';
import './ui';
import './font-fix.css';
import './yt-fixes.css';
import './sponsorblock.js';
import './screensaver-fix';
import './watch.js';
import './video-quality';
import './playback-watchdog';
import './launch-transition';
import './preview-zoom';
import './lang-settings-fix';
import './block-webos-cast';
import './auto-account-select';
