"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import SearchableSelect from "./SearchableSelect";

// Free Philippine Standard Geographic Code API (static JSON, CORS-open).
const PSGC_BASE = "https://psgc.gitlab.io/api";

interface PsgcItem {
  code: string;
  name: string;
  oldName?: string;
  regionName?: string;
}

export interface PsgcValue {
  region: string;
  province: string;
  city: string;
  barangay_name: string;
}

/** Best-effort place names from reverse geocoding a lat/lon (Nominatim's
 * `address` object) — not PSGC-formatted, just raw OSM naming, so matching
 * against the PSGC hierarchy has to be fuzzy (see `normalize`/`bestMatch`
 * below). One or more candidate strings per level since OSM's field choice
 * for "city" varies (city/town/municipality) depending on the place. */
export interface PsgcGeocodedHint {
  region?: string[];
  province?: string[];
  city?: string[];
  barangay?: string[];
}

interface Props {
  value: PsgcValue;
  onChange: (value: PsgcValue) => void;
  /** When set (and the operator hasn't picked a region yet), auto-resolves
   * and pre-selects all four cascade levels from a reverse-geocode result —
   * still fully editable afterward. */
  geocodedHint?: PsgcGeocodedHint | null;
}

// Region names come as "Region IV-A (CALABARZON)" — prefer the short form in parens.
function shortRegionName(name: string): string {
  const m = name.match(/\(([^)]+)\)/);
  return m ? m[1] : name;
}

function byName(a: PsgcItem, b: PsgcItem) {
  return a.name.localeCompare(b.name);
}

// Diacritics/case/whitespace-insensitive compare — "City of Biñan" vs
// "Binan", "NCR" vs "National Capital Region", etc.
const DIACRITIC_MARKS = /[̀-ͯ]/g;

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(DIACRITIC_MARKS, "")
    .toUpperCase()
    .replace(/^CITY OF\s+/, "")
    .replace(/\s+CITY$/, "")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

const REGION_ALIASES: Record<string, string> = {
  "METRO MANILA": "NCR",
  "NATIONAL CAPITAL REGION": "NCR",
};

/** Best match for any of `candidates` among `items`, checking name, oldName
 * and regionName. Exact normalized match first, then substring either way.
 * Returns null rather than guess wrong when nothing lines up. */
function bestMatch(items: PsgcItem[], candidates: (string | undefined)[]): PsgcItem | null {
  const wants = candidates
    .filter((c): c is string => !!c && c.trim() !== "")
    .map((c) => {
      const n = normalize(c);
      return REGION_ALIASES[n] ?? n;
    });
  if (wants.length === 0 || items.length === 0) return null;

  const keysOf = (item: PsgcItem) =>
    [item.name, item.oldName, item.regionName]
      .filter((v): v is string => !!v)
      .map((v) => REGION_ALIASES[normalize(v)] ?? normalize(v));

  for (const want of wants) {
    const exact = items.find((item) => keysOf(item).includes(want));
    if (exact) return exact;
  }
  for (const want of wants) {
    const partial = items.find((item) =>
      keysOf(item).some((k) => k.length > 2 && (k.includes(want) || want.includes(k))),
    );
    if (partial) return partial;
  }
  return null;
}

export default function PsgcCascader({ value, onChange, geocodedHint }: Props) {
  const [regions, setRegions] = useState<PsgcItem[]>([]);
  const [provinces, setProvinces] = useState<PsgcItem[]>([]);
  const [cities, setCities] = useState<PsgcItem[]>([]);
  const [barangays, setBarangays] = useState<PsgcItem[]>([]);

  const [regionCode, setRegionCode] = useState("");
  const [provinceCode, setProvinceCode] = useState("");
  const [cityCode, setCityCode] = useState("");
  const [barangayCode, setBarangayCode] = useState("");

  const [busy, setBusy] = useState<null | "regions" | "provinces" | "cities" | "barangays">(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  const fetchJson = useCallback(async (path: string): Promise<PsgcItem[]> => {
    const res = await fetch(`${PSGC_BASE}${path}`);
    if (!res.ok) throw new Error(`PSGC ${res.status}`);
    const data = (await res.json()) as PsgcItem[];
    return Array.isArray(data) ? data.slice().sort(byName) : [];
  }, []);

  // Load regions on mount
  useEffect(() => {
    let alive = true;
    setBusy("regions");
    fetchJson("/regions/")
      .then((d) => alive && setRegions(d))
      .catch(() => alive && setError("Hindi ma-load ang PSGC regions (kailangan ng internet)."))
      .finally(() => alive && setBusy(null));
    return () => {
      alive = false;
    };
  }, [fetchJson]);

  // Auto-resolve all four levels from a reverse-geocoded hint, once regions
  // are loaded and the operator hasn't already picked one by hand — a
  // manual choice always wins, this only fills the blank starting state.
  const resolvedHintRef = useRef<string | null>(null);
  useEffect(() => {
    if (!geocodedHint || regions.length === 0 || regionCode) return;
    const hintKey = JSON.stringify(geocodedHint);
    if (resolvedHintRef.current === hintKey) return;
    resolvedHintRef.current = hintKey;

    let alive = true;
    (async () => {
      const region = bestMatch(regions, geocodedHint.region ?? []);
      if (!region || !alive) return;
      setRegionCode(region.code);
      setBusy("provinces");
      let provs: PsgcItem[] = [];
      let cms: PsgcItem[] = [];
      try {
        provs = await fetchJson(`/regions/${region.code}/provinces/`);
        if (!alive) return;
        setProvinces(provs);
        if (provs.length === 0) {
          setBusy("cities");
          cms = await fetchJson(`/regions/${region.code}/cities-municipalities/`);
          if (!alive) return;
          setCities(cms);
        }
      } catch {
        if (alive) setError("Hindi ma-load ang provinces.");
      } finally {
        if (alive) setBusy(null);
      }

      let province: PsgcItem | null = null;
      if (provs.length > 0) {
        province = bestMatch(provs, geocodedHint.province ?? []);
        if (province && alive) {
          setProvinceCode(province.code);
          setBusy("cities");
          try {
            cms = await fetchJson(`/provinces/${province.code}/cities-municipalities/`);
            if (!alive) return;
            setCities(cms);
          } catch {
            if (alive) setError("Hindi ma-load ang cities/municipalities.");
          } finally {
            if (alive) setBusy(null);
          }
        }
      }

      const city = bestMatch(cms, geocodedHint.city ?? []);
      let barangays_: PsgcItem[] = [];
      if (city && alive) {
        setCityCode(city.code);
        setBusy("barangays");
        try {
          barangays_ = await fetchJson(`/cities-municipalities/${city.code}/barangays/`);
          if (!alive) return;
          setBarangays(barangays_);
        } catch {
          if (alive) setError("Hindi ma-load ang barangays.");
        } finally {
          if (alive) setBusy(null);
        }
      }

      const barangay = bestMatch(barangays_, geocodedHint.barangay ?? []);
      if (barangay && alive) setBarangayCode(barangay.code);

      if (alive) {
        onChange({
          region: region ? shortRegionName(region.name) : value.region,
          province: province?.name ?? value.province,
          city: city?.name ?? value.city,
          barangay_name: barangay?.name ?? value.barangay_name,
        });
      }
    })();

    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geocodedHint, regions, regionCode, fetchJson]);

  const handleRegion = async (code: string) => {
    const region = regions.find((r) => r.code === code);
    setRegionCode(code);
    setProvinceCode("");
    setCityCode("");
    setBarangayCode("");
    setProvinces([]);
    setCities([]);
    setBarangays([]);
    onChange({
      region: region ? shortRegionName(region.name) : "",
      province: "",
      city: "",
      barangay_name: "",
    });
    if (!code) return;

    setBusy("provinces");
    setError(null);
    try {
      const provs = await fetchJson(`/regions/${code}/provinces/`);
      setProvinces(provs);
      // NCR and a few regions have no provinces — load their cities directly.
      if (provs.length === 0) {
        setBusy("cities");
        const cms = await fetchJson(`/regions/${code}/cities-municipalities/`);
        setCities(cms);
      }
    } catch {
      setError("Hindi ma-load ang provinces.");
    } finally {
      setBusy(null);
    }
  };

  const handleProvince = async (code: string) => {
    const province = provinces.find((p) => p.code === code);
    setProvinceCode(code);
    setCityCode("");
    setBarangayCode("");
    setCities([]);
    setBarangays([]);
    onChange({ ...value, province: province?.name ?? "", city: "", barangay_name: "" });
    if (!code) return;

    setBusy("cities");
    setError(null);
    try {
      const cms = await fetchJson(`/provinces/${code}/cities-municipalities/`);
      setCities(cms);
    } catch {
      setError("Hindi ma-load ang cities/municipalities.");
    } finally {
      setBusy(null);
    }
  };

  const handleCity = async (code: string) => {
    const city = cities.find((c) => c.code === code);
    setCityCode(code);
    setBarangayCode("");
    setBarangays([]);
    onChange({ ...value, city: city?.name ?? "", barangay_name: "" });
    if (!code) return;

    setBusy("barangays");
    setError(null);
    try {
      const brgys = await fetchJson(`/cities-municipalities/${code}/barangays/`);
      setBarangays(brgys);
    } catch {
      setError("Hindi ma-load ang barangays.");
    } finally {
      setBusy(null);
    }
  };

  const handleBarangay = (code: string) => {
    const brgy = barangays.find((b) => b.code === code);
    setBarangayCode(code);
    onChange({ ...value, barangay_name: brgy?.name ?? "" });
  };

  const noProvinces = regionCode !== "" && provinces.length === 0;

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-xs text-[#dc2626] bg-[#fef2f2] border border-[#fecaca] rounded-md px-2 py-1">
          {error}
        </p>
      )}

      {/* 2-column rows, same format as Node ID / Node Name */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SearchableSelect
          label="Region"
          value={regionCode}
          options={regions}
          loading={busy === "regions"}
          onChange={(code) => handleRegion(code)}
          placeholder="— Select region —"
        />
        <SearchableSelect
          label="Province"
          value={provinceCode}
          options={provinces}
          disabled={!regionCode || noProvinces}
          loading={busy === "provinces"}
          onChange={(code) => handleProvince(code)}
          placeholder={noProvinces ? "— No province (NCR) —" : "— Select province —"}
        />
        <SearchableSelect
          label="City / Municipality"
          value={cityCode}
          options={cities}
          disabled={!provinceCode && !noProvinces}
          loading={busy === "cities"}
          onChange={(code) => handleCity(code)}
          placeholder="— Select city / municipality —"
        />
        <SearchableSelect
          label="Barangay"
          value={barangayCode}
          options={barangays}
          disabled={!cityCode}
          loading={busy === "barangays"}
          onChange={(code) => handleBarangay(code)}
          placeholder="— Select barangay —"
        />
      </div>
    </div>
  );
}
