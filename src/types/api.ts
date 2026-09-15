export interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface ReverseGeocodeResult {
  address: string;
  country: string;
  countryCode?: string;
  city?: string;
  state?: string;
  district?: string;
  road?: string;
  houseNumber?: string;
  precisionMeters?: number;
  lat: number;
  lon: number;
}

export interface HistoricalWeatherResult {
  temperature: number;
  precipitation: number;
  cloudCover: number;
  windSpeed: number;
  pressure: number;
  /** IANA zone the hour was resolved in (Open-Meteo `timezone=auto`); absent for legacy UTC lookups. */
  timezone?: string;
}

export interface HolidayEntry {
  date: string;
  localName: string;
  name: string;
  global: boolean;
}

export interface HolidaysResult {
  isHoliday: boolean;
  holidays: HolidayEntry[];
}

export interface PoiResult {
  name: string;
  category: string;
  distance: number;
}

