"use client";

import { useEffect, useState, useCallback } from "react";
import SearchableSelect from "./SearchableSelect";

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
