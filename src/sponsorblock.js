import sha256 from 'tiny-sha256';
import { configRead } from './config';
import { showNotification } from './notifications';
import { t } from './i18n';

// Copied from https://github.com/ajayyy/SponsorBlock/blob/9392d16617d2d48abb6125c00e2ff6042cb7bebe/src/config.ts#L179-L233
const barTypes = {
  sponsor: {
    color: '#00d400',
    opacity: '0.7',
    name: 'sponsored segment',
    sv: 'sponsorinslag'
  },
  intro: {
    color: '#00ffff',
    opacity: '0.7',
    name: 'intro',
    sv: 'intro'
  },
  outro: {
    color: '#0202ed',
    opacity: '0.7',
    name: 'outro',
    sv: 'outro'
  },
  interaction: {
    color: '#cc00ff',
    opacity: '0.7',
    name: 'interaction reminder',
    sv: 'påminnelse'
  },
  selfpromo: {
    color: '#ffff00',
    opacity: '0.7',
    name: 'self-promotion',
    sv: 'egenreklam'
  },
  music_offtopic: {
    color: '#ff9900',
    opacity: '0.7',
    name: 'non-music part',
    sv: 'icke-musikdel'
  },
  preview: {
    color: '#008fd6',
    opacity: '0.7',
    name: 'recap or preview',
    sv: 'förhandstitt'
  }
};

const sponsorblockAPI = 'https://sponsorblock.inf.re/api';

// Per-timeupdate logging is costly on TV CPUs; enable with
// `window.__ytaf_debug__ = true` when needed.
const debug = (...args) => {
  if (window.__ytaf_debug__) console.debug('[sponsorblock]', ...args);
};

let segmentStyle = null;

function setSegmentStyle(css) {
  if (!segmentStyle) {
    if (!css) return;
    segmentStyle = document.createElement('style');
    segmentStyle.id = 'ytaf-sponsorblock-segments';
    document.head.appendChild(segmentStyle);
  }
  segmentStyle.textContent = css;
}

class SponsorBlockHandler {
  video = null;
  active = true;

  attachVideoTimeout = null;
  nextSkipTimeout = null;

  overlayBuilt = false;

  scheduleSkipHandler = null;
  durationChangeHandler = null;
  segments = null;

  constructor(videoID) {
    this.videoID = videoID;
  }

  async init() {
    try {
      await this.load();
    } catch (err) {
      console.warn(
        this.videoID,
        '[sponsorblock] could not load segments:',
        err
      );
    }
  }

  async load() {
    const videoHash = sha256(this.videoID).substring(0, 4);
    const categories = [
      'sponsor',
      'intro',
      'outro',
      'interaction',
      'selfpromo',
      'music_offtopic',
      'preview'
    ];
    const resp = await fetch(
      `${sponsorblockAPI}/skipSegments/${videoHash}?categories=${encodeURIComponent(
        JSON.stringify(categories)
      )}`
    );
    // 404 simply means no segments for any video with this hash prefix.
    if (!resp.ok) return;
    const results = await resp.json();
    if (!this.active || !Array.isArray(results)) return;

    const result = results.find((v) => v.videoID === this.videoID);
    debug(this.videoID, 'Got it:', result);

    if (!result || !result.segments || !result.segments.length) {
      debug(this.videoID, 'No segments found.');
      return;
    }

    this.segments = result.segments;

    this.scheduleSkipHandler = () => this.scheduleSkip();
    this.durationChangeHandler = () => this.buildOverlay();

    this.attachVideo();
    this.buildOverlay();
  }

  getSkippableCategories() {
    const skippableCategories = [];
    if (configRead('enableSponsorBlockSponsor')) {
      skippableCategories.push('sponsor');
    }
    if (configRead('enableSponsorBlockIntro')) {
      skippableCategories.push('intro');
    }
    if (configRead('enableSponsorBlockOutro')) {
      skippableCategories.push('outro');
    }
    if (configRead('enableSponsorBlockInteraction')) {
      skippableCategories.push('interaction');
    }
    if (configRead('enableSponsorBlockSelfPromo')) {
      skippableCategories.push('selfpromo');
    }
    if (configRead('enableSponsorBlockMusicOfftopic')) {
      skippableCategories.push('music_offtopic');
    }
    if (configRead('enableSponsorBlockPreview')) {
      skippableCategories.push('preview');
    }
    return skippableCategories;
  }

  attachVideo() {
    clearTimeout(this.attachVideoTimeout);
    this.attachVideoTimeout = null;

    this.video = document.querySelector('video');
    if (!this.video) {
      debug(this.videoID, 'No video yet...');
      this.attachVideoTimeout = setTimeout(() => this.attachVideo(), 100);
      return;
    }

    debug(this.videoID, 'Video found, binding...');

    this.video.addEventListener('play', this.scheduleSkipHandler);
    this.video.addEventListener('pause', this.scheduleSkipHandler);
    this.video.addEventListener('timeupdate', this.scheduleSkipHandler);
    this.video.addEventListener('durationchange', this.durationChangeHandler);
  }

  /**
   * Show the segments on the progress bar.
   *
   * Upstream appended a <div> into YouTube's progress bar. YouTube renders
   * with incremental DOM, which recycled that <div> as its own `cue-ranges`
   * element and threw our segments away, so they never showed (#445). Now the
   * segments are a CSS gradient on a `::after` of the bar: nothing YouTube can
   * recycle, no polling, and it follows every rebuild of the bar for free.
   */
  buildOverlay() {
    if (this.overlayBuilt) return;
    const duration = this.video && this.video.duration;
    if (!duration || !Number.isFinite(duration)) {
      debug('No video duration yet');
      return;
    }
    this.overlayBuilt = true;

    const pct = (t) => Math.min(100, Math.max(0, (t / duration) * 100));
    const stops = [];
    let cursor = 0;
    [...this.segments]
      .sort((a, b) => a.segment[0] - b.segment[0])
      .forEach((segment) => {
        const color = (barTypes[segment.category] || { color: '#3ea6ff' })
          .color;
        const start = Math.max(cursor, pct(segment.segment[0]));
        const end = Math.max(start, pct(segment.segment[1]));
        if (end - start <= 0) return;
        stops.push(
          `transparent ${start.toFixed(3)}%`,
          `${color} ${start.toFixed(3)}%`,
          `${color} ${end.toFixed(3)}%`,
          `transparent ${end.toFixed(3)}%`
        );
        cursor = end;
      });
    if (!stops.length) return;

    setSegmentStyle(
      'ytlr-progress-bar [idomkey="slider"]::after,' +
        'ytlr-progress-bar [idomkey="player-bar-renderer"]::after{' +
        "content:'';position:absolute;inset:0;pointer-events:none;" +
        'opacity:.75;border-radius:9999px;' +
        `background:linear-gradient(to right,transparent 0%,${stops.join(',')},transparent 100%)}`
    );
  }

  scheduleSkip() {
    clearTimeout(this.nextSkipTimeout);
    this.nextSkipTimeout = null;

    if (!this.active) {
      debug(this.videoID, 'No longer active, ignoring...');
      return;
    }

    if (this.video.paused) {
      debug(this.videoID, 'Currently paused, ignoring...');
      return;
    }

    // Sometimes timeupdate event (that calls scheduleSkip) gets fired right before
    // already scheduled skip routine below. Let's just look back a little bit
    // and, in worst case, perform a skip at negative interval (immediately)...
    const nextSegments = this.segments.filter(
      (seg) =>
        seg.segment[0] > this.video.currentTime - 0.3 &&
        seg.segment[1] > this.video.currentTime - 0.3
    );
    nextSegments.sort((s1, s2) => s1.segment[0] - s2.segment[0]);

    if (!nextSegments.length) {
      debug(this.videoID, 'No more segments');
      return;
    }

    const [segment] = nextSegments;
    const [start, end] = segment.segment;
    debug(
      this.videoID,
      'Scheduling skip of',
      segment,
      'in',
      start - this.video.currentTime
    );

    this.nextSkipTimeout = setTimeout(
      () => {
        if (this.video.paused) {
          debug(this.videoID, 'Currently paused, ignoring...');
          return;
        }
        if (
          !configRead('enableSponsorBlock') ||
          !this.getSkippableCategories().includes(segment.category)
        ) {
          debug(
            this.videoID,
            'Segment',
            segment.category,
            'is not skippable, ignoring...'
          );
          return;
        }

        const bar = barTypes[segment.category];
        const skipName = bar?.name || segment.category;
        const skipNameSv = bar?.sv || skipName;
        debug(this.videoID, 'Skipping', segment);
        showNotification(
          t({ en: `Skipped ${skipName}`, sv: `Hoppade över ${skipNameSv}` }),
          2000,
          'indigo'
        );
        this.video.currentTime = end;
        this.scheduleSkip();
      },
      (start - this.video.currentTime) * 1000
    );
  }

  destroy() {
    debug(this.videoID, 'Destroying');

    this.active = false;

    if (this.nextSkipTimeout) {
      clearTimeout(this.nextSkipTimeout);
      this.nextSkipTimeout = null;
    }

    if (this.attachVideoTimeout) {
      clearTimeout(this.attachVideoTimeout);
      this.attachVideoTimeout = null;
    }

    setSegmentStyle('');

    if (this.video) {
      this.video.removeEventListener('play', this.scheduleSkipHandler);
      this.video.removeEventListener('pause', this.scheduleSkipHandler);
      this.video.removeEventListener('timeupdate', this.scheduleSkipHandler);
      this.video.removeEventListener(
        'durationchange',
        this.durationChangeHandler
      );
    }
  }
}

// When this global variable was declared using let and two consecutive hashchange
// events were fired (due to bubbling? not sure...) the second call handled below
// would not see the value change from first call, and that would cause multiple
// SponsorBlockHandler initializations... This has been noticed on Chromium 38.
// This either reveals some bug in chromium/webpack/babel scope handling, or
// shows my lack of understanding of javascript. (or both)
window.sponsorblock = null;

function uninitializeSponsorblock() {
  if (!window.sponsorblock) {
    return;
  }
  try {
    window.sponsorblock.destroy();
  } catch (err) {
    console.warn('window.sponsorblock.destroy() failed!', err);
  }
  window.sponsorblock = null;
}

window.addEventListener(
  'hashchange',
  () => {
    const newURL = new URL(location.hash.substring(1), location.href);
    // uninitialize sponsorblock when not on `/watch` path, to prevent
    // it from attaching to playback preview video element loaded on
    // home page
    if (newURL.pathname !== '/watch' && window.sponsorblock) {
      debug('uninitializing sponsorblock on a non-video page');
      uninitializeSponsorblock();
      return;
    }

    const videoID = newURL.searchParams.get('v');
    const needsReload =
      videoID &&
      (!window.sponsorblock || window.sponsorblock.videoID != videoID);

    debug(
      'hashchange',
      videoID,
      window.sponsorblock,
      window.sponsorblock ? window.sponsorblock.videoID : null,
      needsReload
    );

    if (needsReload) {
      uninitializeSponsorblock();

      if (configRead('enableSponsorBlock')) {
        window.sponsorblock = new SponsorBlockHandler(videoID);
        window.sponsorblock.init();
      } else {
        console.info('SponsorBlock disabled, not loading');
      }
    }
  },
  false
);
