from geopy.geocoders import Nominatim


def _query_candidates(loc: str) -> list[str]:
    base = (loc or "").strip()
    if not base:
        return []

    candidates: list[str] = []

    def push(value: str) -> None:
        text = value.strip()
        if text and text not in candidates:
            candidates.append(text)

    push(base)

    lowered = base.lower()
    if "philippines" not in lowered:
        push(f"{base}, Philippines")

    if "," not in base:
        push(f"{base}, Metro Manila, Philippines")
        push(f"{base}, Quezon City, Philippines")

    return candidates


def geocode(loc):
    try:
        geolocator = Nominatim(user_agent="telco_mapper_app", timeout=10)

        for candidate in _query_candidates(loc):
            locations = geolocator.geocode(
                candidate,
                exactly_one=False,
                addressdetails=True,
                country_codes="ph",
            )
            if not locations:
                continue

            best = locations[0]
            return {
                "status": "success",
                "lat": best.latitude,
                "lon": best.longitude,
                "query": candidate,
            }

        return {"status": "not_found"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
