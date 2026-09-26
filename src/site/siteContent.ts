import { formatMessage, type Language, type MessageKey } from '../i18n/messages.ts';

/**
 * The copy of the page that is not about one photo: the hero, the sections under the upload
 * zone (what the service reads, how it works, the two cleanup presets, geotags, questions,
 * who made it) and the «how to check» block. One model, two renderers: `renderStatic.ts` turns
 * it into the HTML a crawler or an AI assistant reads without JavaScript, and
 * `components/SiteContent.tsx` renders the same model in React once the app mounts. Both read
 * the dictionary, so the static copy cannot drift from the live one.
 *
 * Before this the page was ~350 words to a reader without JavaScript — the hero — while the
 * dictionary held ~5 100 words of explanation that rendered only after a photo was loaded.
 */
export const SITE_ORIGIN = 'https://foundyou.morgunov.tech';
export const REPO_URL = 'https://github.com/morgunovtech/meta-data';
export const AUTHOR_URL = 'https://s.morgunov.tech';

export interface SiteTerm {
  term: string;
  text: string;
}

export interface SiteTable {
  columns: readonly [string, string, string];
  rows: ReadonlyArray<readonly [string, string, string]>;
}

export interface SiteQuestion {
  question: string;
  answer: string;
}

export interface SiteSection {
  /** DOM id of the section; `${id}-title` is the heading's. */
  id: string;
  title: string;
  lead?: string;
  terms?: SiteTerm[];
  steps?: string[];
  table?: SiteTable;
  list?: string[];
  questions?: SiteQuestion[];
  paragraphs?: string[];
  link?: { href: string; label: string };
}

export interface HeroCopy {
  title: string;
  lead: string;
  points: string[];
  action: string;
}

export interface VerifyCopy {
  title: string;
  lead: string;
  stepNetwork: string;
  stepOffline: string;
  stepGuard: string;
  repoLink: string;
}

const WHAT_ITEMS: ReadonlyArray<readonly [MessageKey, MessageKey]> = [
  ['siteWhatLocationTerm', 'siteWhatLocationText'],
  ['siteWhatTimeTerm', 'siteWhatTimeText'],
  ['siteWhatDeviceTerm', 'siteWhatDeviceText'],
  ['siteWhatPeopleTerm', 'siteWhatPeopleText'],
  ['siteWhatTextTerm', 'siteWhatTextText'],
  ['siteWhatOriginTerm', 'siteWhatOriginText'],
  ['siteWhatLeakTerm', 'siteWhatLeakText']
];

const MODE_ROWS: ReadonlyArray<readonly [MessageKey, MessageKey, MessageKey]> = [
  ['siteModesRow1Name', 'siteModesRow1Meta', 'siteModesRow1All'],
  ['siteModesRow2Name', 'siteModesRow2Meta', 'siteModesRow2All'],
  ['siteModesRow3Name', 'siteModesRow3Meta', 'siteModesRow3All'],
  ['siteModesRow4Name', 'siteModesRow4Meta', 'siteModesRow4All'],
  ['siteModesRow5Name', 'siteModesRow5Meta', 'siteModesRow5All'],
  ['siteModesRow6Name', 'siteModesRow6Meta', 'siteModesRow6All'],
  ['siteModesRow7Name', 'siteModesRow7Meta', 'siteModesRow7All']
];

/** The device recipes of the «Как выключить геометки» card, in the order they are listed here. */
const GEOTAG_KEYS: readonly MessageKey[] = [
  'geotagTipApple',
  'geotagTipSamsung',
  'geotagTipGoogle',
  'geotagTipXiaomi',
  'geotagTipHuawei',
  'geotagTipBbk',
  'geotagTipAndroid',
  'geotagTipCamera'
];

const FAQ_KEYS: ReadonlyArray<readonly [MessageKey, MessageKey]> = [
  ['siteFaq1Q', 'siteFaq1A'],
  ['siteFaq2Q', 'siteFaq2A'],
  ['siteFaq3Q', 'siteFaq3A'],
  ['siteFaq4Q', 'siteFaq4A'],
  ['siteFaq5Q', 'siteFaq5A'],
  ['siteFaq6Q', 'siteFaq6A']
];

export function heroCopy(lang: Language): HeroCopy {
  const t = (key: MessageKey) => formatMessage(lang, key);
  return {
    title: t('appTitle'),
    lead: t('introLead'),
    points: [t('introPoint1'), t('introPoint2'), t('introPoint3'), t('introPoint4')],
    action: t('introAction')
  };
}

export function verifyCopy(lang: Language): VerifyCopy {
  const t = (key: MessageKey) => formatMessage(lang, key);
  return {
    title: t('verifyTitle'),
    lead: t('verifyLead'),
    stepNetwork: t('verifyStepNetwork'),
    stepOffline: t('verifyStepOffline'),
    stepGuard: t('verifyStepGuard'),
    repoLink: t('verifyRepoLink')
  };
}

export function siteSections(lang: Language): SiteSection[] {
  const t = (key: MessageKey) => formatMessage(lang, key);
  return [
    {
      id: 'sec-what',
      title: t('siteWhatTitle'),
      lead: t('siteWhatLead'),
      terms: WHAT_ITEMS.map(([term, text]) => ({ term: t(term), text: t(text) }))
    },
    {
      id: 'sec-how',
      title: t('siteHowTitle'),
      steps: [t('siteHowStep1'), t('siteHowStep2'), t('siteHowStep3')]
    },
    {
      id: 'sec-modes',
      title: t('siteModesTitle'),
      lead: t('siteModesLead'),
      table: {
        columns: [t('siteModesColWhat'), t('siteModesColMeta'), t('siteModesColAll')],
        rows: MODE_ROWS.map(([name, meta, all]) => [t(name), t(meta), t(all)] as const)
      }
    },
    {
      id: 'sec-geotags',
      title: t('geotagTipTitle'),
      lead: t('siteGeotagsLead'),
      list: GEOTAG_KEYS.map((key) => t(key))
    },
    {
      id: 'sec-faq',
      title: t('siteFaqTitle'),
      questions: FAQ_KEYS.map(([question, answer]) => ({ question: t(question), answer: t(answer) }))
    },
    {
      id: 'sec-about',
      title: t('siteAboutTitle'),
      paragraphs: [t('siteAboutText')],
      link: { href: AUTHOR_URL, label: t('siteAboutLink') }
    }
  ];
}
