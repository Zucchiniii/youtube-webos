/**
 * One declarative description of the YTAF settings, rendered both as native
 * categories inside YouTube's own Settings page and by the fallback overlay.
 */

import type { ConfigKey } from '../config';
import type { L10n } from '../i18n';
import type { IconName } from './icons';

export interface ToggleItem {
  kind: 'toggle';
  key: ConfigKey;
  title: L10n;
  summary: L10n;
  icon: IconName;
  color: string;
  /** Only meaningful while this other toggle is on (shown indented). */
  dependsOn?: ConfigKey;
}

export interface ActionItem {
  kind: 'action';
  id: 'reset' | 'about';
  title: L10n;
  summary: L10n;
  actionLabel: L10n;
  icon: IconName;
  color: string;
}

export type SettingsItem = ToggleItem | ActionItem;

export interface SettingsSection {
  id: string;
  title: L10n;
  /** Where the category goes in YouTube's Settings list. */
  placement: 'top' | 'bottom';
  items: SettingsItem[];
}

const SB = 'enableSponsorBlock' as const;

export const settingsSections: SettingsSection[] = [
  {
    id: 'YTAF_MAIN',
    title: { en: 'YouTube AdFree', sv: 'YouTube AdFree' },
    placement: 'top',
    items: [
      {
        kind: 'toggle',
        key: 'enableAdBlock',
        title: { en: 'Block ads', sv: 'Blockera annonser' },
        summary: {
          en: 'Removes video ads, the home page banner and sponsored tiles.',
          sv: 'Tar bort videoannonser, banner på startsidan och sponsrade rutor.'
        },
        icon: 'shield',
        color: '#1e9e6a'
      },
      {
        kind: 'toggle',
        key: 'upgradeThumbnails',
        title: { en: 'HD thumbnails', sv: 'HD-miniatyrer' },
        summary: {
          en: 'Loads 1280×720 thumbnails instead of the blurry 320×180 ones YouTube sends to TVs.',
          sv: 'Laddar miniatyrer i 1280×720 i stället för de suddiga 320×180 som YouTube skickar till TV-apparater.'
        },
        icon: 'image',
        color: '#1a73e8'
      },
      {
        kind: 'toggle',
        key: 'forceHighResVideo',
        title: { en: 'Always highest quality', sv: 'Alltid högsta kvalitet' },
        summary: {
          en: 'Starts every video in the best available resolution instead of switching up later.',
          sv: 'Startar varje video i bästa tillgängliga upplösning i stället för att byta upp senare.'
        },
        icon: 'quality',
        color: '#7b4ce0'
      },
      {
        kind: 'toggle',
        key: 'playbackWatchdog',
        title: { en: 'Fix stuck videos', sv: 'Laga videor som fastnar' },
        summary: {
          en: 'If a video hangs on a black loading screen, playback is restarted automatically.',
          sv: 'Om en video fastnar på en svart laddningsskärm startas uppspelningen om automatiskt.'
        },
        icon: 'pulse',
        color: '#e8710a'
      },
      {
        kind: 'toggle',
        key: SB,
        title: { en: 'SponsorBlock', sv: 'SponsorBlock' },
        summary: {
          en: 'Skips segments the community marked, using sponsor.ajay.app. Choose categories under SponsorBlock at the bottom of Settings.',
          sv: 'Hoppar över delar som communityn markerat, via sponsor.ajay.app. Välj kategorier under SponsorBlock längst ned i Inställningar.'
        },
        icon: 'skip',
        color: '#00a000'
      },
      {
        kind: 'toggle',
        key: 'removeShorts',
        title: { en: 'Hide Shorts in feeds', sv: 'Dölj Shorts i flöden' },
        summary: {
          en: 'Removes Shorts shelves and tiles from subscriptions, home and search.',
          sv: 'Tar bort Shorts-hyllor och -rutor från prenumerationer, startsidan och sök.'
        },
        icon: 'shorts',
        color: '#e62117'
      },
      {
        kind: 'toggle',
        key: 'removeEndscreen',
        title: { en: 'Remove end screens', sv: 'Ta bort slutskärmar' },
        summary: {
          en: 'Hides the video and channel cards creators put over the last seconds.',
          sv: 'Döljer video- och kanalkorten som visas över videons sista sekunder.'
        },
        icon: 'endscreen',
        color: '#5f6b7a'
      },
      {
        kind: 'toggle',
        key: 'autoAccountSelect',
        title: {
          en: 'Skip "Who\'s watching?"',
          sv: 'Hoppa över "Vem tittar?"'
        },
        summary: {
          en: 'Continues with the last account at start-up.',
          sv: 'Fortsätter med senaste kontot när appen startar.'
        },
        icon: 'account',
        color: '#00897b'
      },
      {
        kind: 'toggle',
        key: 'showWatch',
        title: { en: 'Show clock', sv: 'Visa klocka' },
        summary: {
          en: 'Shows the time in the top-right corner while browsing.',
          sv: 'Visar tiden uppe till höger när du bläddrar.'
        },
        icon: 'clock',
        color: '#3f51b5'
      },
      {
        kind: 'toggle',
        key: 'hideLogo',
        title: { en: 'Hide YouTube logo', sv: 'Dölj YouTube-loggan' },
        summary: {
          en: 'Hides the logo in the top-right corner.',
          sv: 'Döljer loggan uppe till höger.'
        },
        icon: 'eyeOff',
        color: '#616161'
      }
    ]
  },
  {
    id: 'YTAF_SPONSORBLOCK',
    title: { en: 'SponsorBlock categories', sv: 'SponsorBlock-kategorier' },
    placement: 'bottom',
    items: [
      {
        kind: 'toggle',
        key: 'enableSponsorBlockSponsor',
        dependsOn: SB,
        title: { en: 'Skip sponsors', sv: 'Hoppa över sponsorer' },
        summary: {
          en: 'Paid promotions and sponsor reads.',
          sv: 'Betalda reklaminslag och sponsorläsningar.'
        },
        icon: 'skip',
        color: '#00a000'
      },
      {
        kind: 'toggle',
        key: 'enableSponsorBlockSelfPromo',
        dependsOn: SB,
        title: { en: 'Skip self-promotion', sv: 'Hoppa över egenreklam' },
        summary: {
          en: 'Merch, Patreon and other unpaid promotion.',
          sv: 'Merch, Patreon och annan obetald marknadsföring.'
        },
        icon: 'skip',
        color: '#c9a800'
      },
      {
        kind: 'toggle',
        key: 'enableSponsorBlockInteraction',
        dependsOn: SB,
        title: {
          en: 'Skip interaction reminders',
          sv: 'Hoppa över påminnelser'
        },
        summary: {
          en: '"Like and subscribe" reminders.',
          sv: '"Gilla och prenumerera"-påminnelser.'
        },
        icon: 'skip',
        color: '#b000e0'
      },
      {
        kind: 'toggle',
        key: 'enableSponsorBlockIntro',
        dependsOn: SB,
        title: { en: 'Skip intros', sv: 'Hoppa över intron' },
        summary: {
          en: 'Intro animations and pauses without content.',
          sv: 'Introanimationer och pauser utan innehåll.'
        },
        icon: 'skip',
        color: '#00a8b5'
      },
      {
        kind: 'toggle',
        key: 'enableSponsorBlockOutro',
        dependsOn: SB,
        title: { en: 'Skip outros', sv: 'Hoppa över outron' },
        summary: {
          en: 'Credits and end cards.',
          sv: 'Eftertexter och slutkort.'
        },
        icon: 'skip',
        color: '#2638d6'
      },
      {
        kind: 'toggle',
        key: 'enableSponsorBlockMusicOfftopic',
        dependsOn: SB,
        title: { en: 'Skip non-music', sv: 'Hoppa över icke-musik' },
        summary: {
          en: 'Talking and skits in music videos.',
          sv: 'Prat och sketcher i musikvideor.'
        },
        icon: 'skip',
        color: '#e08600'
      },
      {
        kind: 'toggle',
        key: 'enableSponsorBlockPreview',
        dependsOn: SB,
        title: {
          en: 'Skip previews and recaps',
          sv: 'Hoppa över förhandstittar'
        },
        summary: {
          en: 'Previews of what is coming and recaps of earlier episodes.',
          sv: 'Förhandsvisningar av vad som kommer och sammanfattningar av tidigare avsnitt.'
        },
        icon: 'skip',
        color: '#008fd6'
      }
    ]
  },
  {
    id: 'YTAF_ABOUT',
    title: { en: 'YouTube AdFree – more', sv: 'YouTube AdFree – mer' },
    placement: 'bottom',
    items: [
      {
        kind: 'action',
        id: 'reset',
        title: { en: 'Reset AdFree', sv: 'Återställ AdFree' },
        summary: {
          en: 'Restores the default value of every AdFree option. YouTube settings are not affected.',
          sv: 'Återställer alla AdFree-val till standard. YouTubes egna inställningar påverkas inte.'
        },
        icon: 'reset',
        color: '#5f6b7a',
        actionLabel: { en: 'Reset', sv: 'Återställ' }
      },
      {
        kind: 'action',
        id: 'about',
        title: { en: 'About AdFree', sv: 'Om AdFree' },
        summary: {
          en: 'Version {version}. The quick panel holds the same options and also opens with the green button – handy while a video plays.',
          sv: 'Version {version}. Snabbpanelen har samma val och öppnas även med den gröna knappen – smidigt medan en video spelas.'
        },
        icon: 'info',
        color: '#5f6b7a',
        actionLabel: { en: 'Open quick panel', sv: 'Öppna snabbpanel' }
      }
    ]
  }
];

export const SETTING_PREFIX = 'YTAF_';
