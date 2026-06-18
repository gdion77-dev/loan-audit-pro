/**
 * Loan Audit PRO — src/services/ecbRateService.ts
 * ------------------------------------------------------------------
 * Fetches reference-index values (Euribor 1M/3M/6M/12M, ECB main
 * refinancing rate) from the ECB Data Portal SDMX 2.1 REST API.
 *
 * IMPORTANT — design constraints
 *   • This module performs NETWORK I/O and therefore lives OUTSIDE the
 *     locked, deterministic calculation engines. Engines never call it;
 *     callers feed its output into the domain `rateHistory`.
 *   • Browser CORS is NOT guaranteed for the ECB endpoint. Every failure
 *     mode (network/CORS, non-200, empty, parse) is mapped to a discrete
 *     status so the UI can fall back to manual entry. We never throw past
 *     the public boundary and never invent values.
 *   • For an audit tool, fetched values are meant to be REVIEWED and
 *     LOCKED into the case by the user (see the UI layer). This module
 *     only retrieves; it does not persist or decide.
 *
 * SDMX-JSON shape (data-api.ecb.europa.eu .../service/data/FM/<key>?format=jsondata):
 *   structure.dimensions.observation[0].values[] -> the TIME_PERIOD list
 *   dataSets[0].series["0:0:..."].observations    -> { obsIndex: [value, ...] }
 */

export type EcbIndexCode =
  | 'EURIBOR_1M'
  | 'EURIBOR_3M'
  | 'EURIBOR_6M'
  | 'EURIBOR_12M'
  | 'ECB';

/** A single fetched observation: ISO date + value in percent. */
export interface EcbObservation {
  readonly date: string; // ISO yyyy-mm-dd (or yyyy-mm for monthly series)
  readonly valuePercent: number;
}

export type EcbFetchStatus =
  | 'success'
  | 'network_error' // fetch rejected (offline / CORS / DNS)
  | 'http_error' // server responded non-2xx
  | 'empty' // 2xx but no observations
  | 'parse_error'; // body present but unparseable

export interface EcbFetchResult {
  readonly status: EcbFetchStatus;
  readonly indexCode: EcbIndexCode;
  readonly seriesKey: string;
  readonly observations: readonly EcbObservation[];
  /** Human-readable detail for diagnostics / UI messaging. */
  readonly message: string;
  /** HTTP status code when a response was received. */
  readonly httpStatus: number | null;
}

const ECB_BASE = 'https://data-api.ecb.europa.eu/service/data';

/**
 * SDMX series keys (dataflow FM). Daily ('D') business-daily series are
 * used for Euribor so a contract fixing date can be matched precisely.
 * The ECB main refinancing rate is published as a level series.
 *
 * Verified key shapes:
 *   FM.D.U2.EUR.RT.MM.EURIBOR3MD_.HSTA  (daily 3M Euribor)
 *   FM.B.U2.EUR.4F.KR.MRR_FR.LEV        (ECB main refinancing, fixed rate)
 */
const SERIES: Record<EcbIndexCode, { flow: string; key: string; freqLabel: string }> = {
  EURIBOR_1M: { flow: 'FM', key: 'D.U2.EUR.RT.MM.EURIBOR1MD_.HSTA', freqLabel: 'ημερήσια' },
  EURIBOR_3M: { flow: 'FM', key: 'D.U2.EUR.RT.MM.EURIBOR3MD_.HSTA', freqLabel: 'ημερήσια' },
  EURIBOR_6M: { flow: 'FM', key: 'D.U2.EUR.RT.MM.EURIBOR6MD_.HSTA', freqLabel: 'ημερήσια' },
  EURIBOR_12M: { flow: 'FM', key: 'D.U2.EUR.RT.MM.EURIBOR1YD_.HSTA', freqLabel: 'ημερήσια' },
  ECB: { flow: 'FM', key: 'B.U2.EUR.4F.KR.MRR_FR.LEV', freqLabel: 'ανά μεταβολή' },
};

/** Build the full SDMX-JSON request URL for an index and optional date window. */
export function buildEcbUrl(
  indexCode: EcbIndexCode,
  opts?: { startPeriod?: string; endPeriod?: string },
): string {
  const s = SERIES[indexCode];
  const params: string[] = ['format=jsondata'];
  if (opts?.startPeriod) params.push(`startPeriod=${encodeURIComponent(opts.startPeriod)}`);
  if (opts?.endPeriod) params.push(`endPeriod=${encodeURIComponent(opts.endPeriod)}`);
  return `${ECB_BASE}/${s.flow}/${s.key}?${params.join('&')}`;
}

interface SdmxJson {
  dataSets?: Array<{ series?: Record<string, { observations?: Record<string, Array<number | null>> }> }>;
  structure?: {
    dimensions?: {
      observation?: Array<{ id?: string; values?: Array<{ id?: string; name?: string }> }>;
    };
  };
}

/**
 * Parse an SDMX-JSON body into a sorted list of observations.
 * Returns [] when the structure is present but contains no usable points.
 */
export function parseSdmxJson(body: unknown): EcbObservation[] {
  const data = body as SdmxJson;
  const dataSet = data?.dataSets?.[0];
  const obsDim = data?.structure?.dimensions?.observation?.[0];
  const periodValues = obsDim?.values;
  if (!dataSet?.series || !Array.isArray(periodValues)) return [];

  // Single requested series -> take the first (and only) series object.
  const seriesObjects = Object.values(dataSet.series);
  const firstSeries = seriesObjects[0];
  if (!firstSeries?.observations) return [];

  const out: EcbObservation[] = [];
  for (const [idxStr, arr] of Object.entries(firstSeries.observations)) {
    const idx = Number(idxStr);
    const period = periodValues[idx]?.id ?? periodValues[idx]?.name;
    const raw = Array.isArray(arr) ? arr[0] : null;
    if (period == null || raw == null || typeof raw !== 'number' || !Number.isFinite(raw)) {
      continue; // skip missing / non-numeric points — never coerce to 0
    }
    out.push({ date: period, valuePercent: raw });
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

/**
 * Fetch index observations from the ECB. Resolves to a discriminated
 * result; never throws. The caller decides what to do with each status
 * (success -> review & lock; any error -> manual entry fallback).
 */
export async function fetchEcbIndex(
  indexCode: EcbIndexCode,
  opts?: { startPeriod?: string; endPeriod?: string; fetchImpl?: typeof fetch },
): Promise<EcbFetchResult> {
  const seriesKey = `${SERIES[indexCode].flow}.${SERIES[indexCode].key}`;
  const url = buildEcbUrl(indexCode, opts);
  const doFetch = opts?.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!doFetch) {
    return {
      status: 'network_error',
      indexCode,
      seriesKey,
      observations: [],
      message: 'Δεν υπάρχει διαθέσιμη μέθοδος δικτύου (fetch) σε αυτό το περιβάλλον.',
      httpStatus: null,
    };
  }

  let resp: Response;
  try {
    resp = await doFetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    return {
      status: 'network_error',
      indexCode,
      seriesKey,
      observations: [],
      message:
        'Αποτυχία σύνδεσης με την ΕΚΤ (πιθανώς λόγω περιορισμού CORS του browser ή απουσίας σύνδεσης). Καταχωρήστε τιμές χειροκίνητα.',
      httpStatus: null,
    };
  }

  if (!resp.ok) {
    return {
      status: 'http_error',
      indexCode,
      seriesKey,
      observations: [],
      message: `Η ΕΚΤ απάντησε με κωδικό ${resp.status}. Καταχωρήστε τιμές χειροκίνητα.`,
      httpStatus: resp.status,
    };
  }

  let json: unknown;
  try {
    json = await resp.json();
  } catch {
    return {
      status: 'parse_error',
      indexCode,
      seriesKey,
      observations: [],
      message: 'Η απάντηση της ΕΚΤ δεν ήταν αναγνώσιμη (μη έγκυρο JSON).',
      httpStatus: resp.status,
    };
  }

  let observations: EcbObservation[];
  try {
    observations = parseSdmxJson(json);
  } catch {
    return {
      status: 'parse_error',
      indexCode,
      seriesKey,
      observations: [],
      message: 'Δεν ήταν δυνατή η ανάγνωση των παρατηρήσεων από την απάντηση της ΕΚΤ.',
      httpStatus: resp.status,
    };
  }

  if (observations.length === 0) {
    return {
      status: 'empty',
      indexCode,
      seriesKey,
      observations: [],
      message: 'Η ΕΚΤ δεν επέστρεψε παρατηρήσεις για το ζητούμενο διάστημα.',
      httpStatus: resp.status,
    };
  }

  return {
    status: 'success',
    indexCode,
    seriesKey,
    observations,
    message: `Αντλήθηκαν ${observations.length} τιμές (${SERIES[indexCode].freqLabel}) από την ΕΚΤ.`,
    httpStatus: resp.status,
  };
}
