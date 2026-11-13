/**
 * The quick panel: an overlay with every AdFree option.
 *
 * Opened with the green button (useful during playback, where YouTube's
 * Settings page is out of reach), from "About AdFree" in YouTube's Settings,
 * and as the fallback if the native Settings integration is unavailable.
 *
 * Replaces upstream's panel, which needed a 1.7k-line spatial-navigation
 * polyfill; a vertical list only needs up/down.
 */

import {
  configAddChangeListener,
  configRead,
  configWrite,
  type ConfigKey
} from '../config';
import { t, tf } from '../i18n';
import { settingsSections, type ToggleItem } from './definitions';
import { iconUri } from './icons';
import './panel.css';

const KEY = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  ENTER: 13,
  BACK: 461,
  ESC: 27,
  BACKSPACE: 8,
  PAGE_UP: 33,
  PAGE_DOWN: 34
} as const;

interface Row {
  el: HTMLElement;
  item: ToggleItem;
}

let root: HTMLElement | null = null;
let list: HTMLElement | null = null;
let rows: Row[] = [];
let focusIndex = 0;
let visible = false;
let previousFocus: Element | null = null;

function updateRow(row: Row) {
  const on = configRead(row.item.key) as boolean;
  row.el.classList.toggle('ytaf-on', on);
  row.el.setAttribute('aria-checked', String(on));
  const parent = row.item.dependsOn;
  row.el.classList.toggle(
    'ytaf-dim',
    parent !== undefined && !(configRead(parent) as boolean)
  );
}

function setFocus(index: number, scroll = true) {
  if (rows.length === 0) return;
  focusIndex = Math.max(0, Math.min(rows.length - 1, index));
  rows.forEach((r, i) =>
    r.el.classList.toggle('ytaf-focused', i === focusIndex)
  );
  const el = rows[focusIndex]!.el;
  el.focus({ preventScroll: true });
  if (scroll) el.scrollIntoView({ block: 'nearest' });
}

function toggle(row: Row, value?: boolean) {
  const next = value ?? !(configRead(row.item.key) as boolean);
  configWrite(row.item.key, next as never);
}

function buildRow(item: ToggleItem, index: number): Row {
  const el = document.createElement('div');
  el.className = 'ytaf-row' + (item.dependsOn ? ' ytaf-indent' : '');
  el.tabIndex = -1;
  el.setAttribute('role', 'switch');

  const icon = document.createElement('div');
  icon.className = 'ytaf-row-icon';
  icon.style.backgroundImage = `url("${iconUri(item.icon, item.color)}")`;

  const text = document.createElement('div');
  text.className = 'ytaf-row-text';
  const title = document.createElement('div');
  title.className = 'ytaf-row-title';
  title.textContent = t(item.title);
  const summary = document.createElement('div');
  summary.className = 'ytaf-row-summary';
  summary.textContent = t(item.summary);
  text.append(title, summary);

  const sw = document.createElement('div');
  sw.className = 'ytaf-switch';
  sw.appendChild(document.createElement('div')).className = 'ytaf-knob';

  el.append(icon, text, sw);

  const row: Row = { el, item };
  el.addEventListener('mouseenter', () => setFocus(index, false));
  el.addEventListener('click', (evt) => {
    evt.preventDefault();
    evt.stopPropagation();
    setFocus(index, false);
    toggle(row);
  });
  return row;
}

function build() {
  root = document.createElement('div');
  root.className = 'ytaf-panel-backdrop';
  root.addEventListener('click', (evt) => {
    if (evt.target === root) showSettingsPanel(false);
  });

  const panel = document.createElement('div');
  panel.className = 'ytaf-panel';
  panel.setAttribute('role', 'dialog');

  const header = document.createElement('div');
  header.className = 'ytaf-panel-header';
  const h = document.createElement('div');
  h.className = 'ytaf-panel-title';
  h.textContent = 'YouTube AdFree';
  const sub = document.createElement('div');
  sub.className = 'ytaf-panel-sub';
  sub.textContent = tf(
    {
      en: 'v{version} · Also in YouTube Settings · Back closes',
      sv: 'v{version} · Finns även i YouTubes Inställningar · Tillbaka stänger'
    },
    { version: __YTAF_VERSION__ }
  );
  header.append(h, sub);

  list = document.createElement('div');
  list.className = 'ytaf-panel-list';

  rows = [];
  for (const section of settingsSections) {
    const toggles = section.items.filter(
      (i): i is ToggleItem => i.kind === 'toggle'
    );
    if (toggles.length === 0) continue;
    const heading = document.createElement('div');
    heading.className = 'ytaf-section';
    heading.textContent = t(section.title);
    list.appendChild(heading);
    for (const item of toggles) {
      const row = buildRow(item, rows.length);
      rows.push(row);
      list.appendChild(row.el);
    }
  }

  const keys = new Set<ConfigKey>();
  rows.forEach((r) => {
    keys.add(r.item.key);
    if (r.item.dependsOn) keys.add(r.item.dependsOn);
  });
  for (const key of keys) {
    configAddChangeListener(key, () => rows.forEach(updateRow));
  }

  panel.append(header, list);
  root.appendChild(panel);
  document.body.appendChild(root);
}

/**
 * Handle a (trusted) keydown while the panel is open. The key router in
 * ui.ts swallows every key event while the panel is visible, so YouTube's UI
 * behind it never reacts.
 */
export function handlePanelKey(evt: KeyboardEvent) {
  const row = rows[focusIndex];
  switch (evt.keyCode) {
    case KEY.UP:
      setFocus(focusIndex - 1);
      break;
    case KEY.DOWN:
      setFocus(focusIndex + 1);
      break;
    case KEY.PAGE_UP:
      setFocus(focusIndex - 5);
      break;
    case KEY.PAGE_DOWN:
      setFocus(focusIndex + 5);
      break;
    case KEY.LEFT:
      if (row) toggle(row, false);
      break;
    case KEY.RIGHT:
      if (row) toggle(row, true);
      break;
    case KEY.ENTER:
      if (row) toggle(row);
      break;
    case KEY.BACK:
    case KEY.ESC:
    case KEY.BACKSPACE:
      showSettingsPanel(false);
      break;
  }
}

export function isSettingsPanelVisible() {
  return visible;
}

/** Show or hide the quick panel. */
export function showSettingsPanel(show = true) {
  if (show === visible) return;
  if (show) {
    if (!root) build();
    rows.forEach(updateRow);
    previousFocus = document.activeElement;
    root!.classList.add('ytaf-visible');
    visible = true;
    setFocus(focusIndex);
  } else {
    root?.classList.remove('ytaf-visible');
    visible = false;
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }
}

export function toggleSettingsPanel() {
  showSettingsPanel(!visible);
}
