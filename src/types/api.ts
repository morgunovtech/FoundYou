export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface ReverseGeocodeResult {
  /**
   * Nominatim's `display_name`. Absent, together with `country`, when it answered «Unable to
   * geocode» — open sea, the poles — because the endpoint invents nothing: the page falls back to
   * its own «unknown place» line in the reader's language.
   */
  address?: string;
  country?: string;
  countryCode?: string;
  city?: string;
  state?: string;
  district?: string;
  /**
   * The finest administrative level OSM records for the point — `neighbourhood`, `quarter`,
   * `residential` or `city_block`. In Tashkent that is the mahalla, a far smaller circle around
   * someone than the district, which is why it is worth its own field.
   */
  neighbourhood?: string;
  /** Nominatim's own `place_rank`: roughly 4 (continent) to 30 (a single building). */
  placeRank?: number;
  /** `building:levels` from the matched object's OSM tags. */
  buildingLevels?: number;
  /** The object's name in the country's own language, when OSM holds one and it differs. */
  localName?: string;
  road?: string;
  houseNumber?: string;
  /** Nominatim `category` / `type` / `addresstype` / `name` of the matched object (e.g. tourism / hotel / tourism / «Lotus Hotel»). */
  category?: string;
  type?: string;
  addressType?: string;
  name?: string;
  precisionMeters?: number;
  /** Distance from the point asked about to the matched object; absent when upstream gave none. */
  distanceMeters?: number;
  lat: number;
  lon: number;
}

export interface HistoricalWeatherResult {
  temperature: number;
  precipitation: number;
  cloudCover: number;
  windSpeed: number;
  pressure: number;
  /** WMO 4677 weather code (Open-Meteo `weather_code`); absent in answers cached before it was requested. */
  weatherCode?: number | null;
  /** IANA zone the hour was resolved in (Open-Meteo `timezone=auto`); absent for legacy UTC lookups. */
  timezone?: string;
}

export interface ElevationResult {
  /** Terrain height in metres above sea level at the rounded point (Copernicus DEM, 90 m). */
  elevation: number;
  resolutionMeters: number;
}

export interface HolidayEntry {
  date: string;
  localName: string;
  name: string;
  global: boolean;
  /**
   * True when the date was computed from the lunar calendar rather than taken from an official
   * announcement (Ramazon hayit, Qurbon hayit outside the years already announced). The card says
   * so: the day is set by the Muslim Board, and the tabular calendar is good to about a day.
   */
  approximate?: boolean;
}

export interface HolidaysResult {
  isHoliday: boolean;
  holidays: HolidayEntry[];
}

export interface LandmarkResult {
  /** Wikipedia article title, in the edition it was found in. */
  title: string;
  /** Metres from the rounded point to the article's coordinates. */
  distance: number;
  /** Wikipedia edition the article came from: `uz`, `ru`, `en`… */
  lang: string;
}

export interface PlaceContextItem {
  /** OSM value that made it interesting: `school`, `hospital`, `military`, `railway:station`… */
  kind: string;
  name: string;
  distance: number;
}

export interface PlaceContextResult {
  /** OSM `landuse` at the point: residential, industrial, farmland, forest… */
  landuse?: string;
  /** Neighbours that say something about a person whether or not they went in. */
  sensitive: PlaceContextItem[];
  /** What explains a stranger being at the point: a station, a stop, an airport. */
  transport: PlaceContextItem[];
  placeName?: string;
  placeKind?: string;
  /** Population of the nearest settlement that records one, from OSM's own `population` tag. */
  population?: number;
}

export interface PoiResult {
  name: string;
  category: string;
  distance: number;
  /**
   * Direction from the shot to the object, degrees clockwise from north. The endpoint sends a
   * bearing rather than the object's coordinates: it is what «камера смотрела на …» needs and
   * it says strictly less.
   */
  bearing?: number;
}

