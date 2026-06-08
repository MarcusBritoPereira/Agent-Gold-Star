import requests

url = "https://embarcar-e83ea296df06.herokuapp.com/api/routes/available_seats"
params = {
    "web": "false",
    "route_id": "22",
    "date": "2026-06-05"
}

res = requests.get(url, params=params)
print("Status:", res.status_code)
try:
    data = res.json()
    print("Trip ID:", data.get("trip", {}).get("id"))
    print("Available Seats:", data.get("available_seats"))
    print("Booked Seats:", len(data.get("booked_seats", [])))
    print("Blocked Seats:", len(data.get("blocked_seats", [])))
except Exception as e:
    print("Error parsing JSON:", e)
    print("Response text:", res.text[:500])
