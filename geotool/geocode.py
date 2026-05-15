from geopy.geocoders import Nominatim


def geocode(loc):
    try:
        geolocator = Nominatim(user_agent="telco_mapper_app")
        location = geolocator.geocode(loc)
        if location:
            return {
                "status": "success",
                "lat": location.latitude,
                "lon": location.longitude,
            }
        else:
            return {"status": "not_found"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
