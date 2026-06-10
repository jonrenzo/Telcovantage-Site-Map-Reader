"use client";

import { useEffect, useState, useCallback } from "react";

// Free Philippine Standard Geographic Code API (static JSON, CORS-open).
const PSGC_BASE = "https://psgc.gitlab.io/api";

interface PsgcItem {
  code: string;
  name: string;
}

export interface PsgcValue {
  region: string;
  province: string;
  city: string;
  barangay_name: string;
}

interface Props {
  value: PsgcValue;
  onChange: (value: PsgcValue) => void;
}

const selectClass =
  "w-full px-3 py-2 rounded-lg border border-border bg-white text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 disabled:bg-slate-50";

// Region names come as "Region IV-A (CALABARZON)" — prefer the short form in parens.
function shortRegionName(name: string): string {
  const m = name.match(/\(([^)]+)\)/);
  return m ? m[1] : name;
}

function byName(a: PsgcItem, b: PsgcItem) {
  return a.name.localeCompare(b.name);
}

export default function PsgcCascader({ value, onChange }: Props) {
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

      <div>
        <label className="block text-xs font-medium text-muted mb-1">Region</label>
        <select
          className={selectClass}
          value={regionCode}
          disabled={busy === "regions"}
          onChange={(e) => handleRegion(e.target.value)}
        >
          <option value="">
            {busy === "regions" ? "Loading regions…" : "— Select region —"}
          </option>
          {regions.map((r) => (
            <option key={r.code} value={r.code}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted mb-1">Province</label>
        <select
          className={selectClass}
          value={provinceCode}
          disabled={!regionCode || noProvinces || busy === "provinces"}
          onChange={(e) => handleProvince(e.target.value)}
        >
          <option value="">
            {busy === "provinces"
              ? "Loading provinces…"
              : noProvinces
                ? "— Walang province (NCR) —"
                : "— Select province —"}
          </option>
          {provinces.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted mb-1">
          City / Municipality
        </label>
        <select
          className={selectClass}
          value={cityCode}
          disabled={(!provinceCode && !noProvinces) || busy === "cities"}
          onChange={(e) => handleCity(e.target.value)}
        >
          <option value="">
            {busy === "cities" ? "Loading cities…" : "— Select city / municipality —"}
          </option>
          {cities.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-muted mb-1">Barangay</label>
        <select
          className={selectClass}
          value={barangayCode}
          disabled={!cityCode || busy === "barangays"}
          onChange={(e) => handleBarangay(e.target.value)}
        >
          <option value="">
            {busy === "barangays" ? "Loading barangays…" : "— Select barangay —"}
          </option>
          {barangays.map((b) => (
            <option key={b.code} value={b.code}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
