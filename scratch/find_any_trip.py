import requests
import datetime

origins = ["Prainha", "Monte Alegre", "Santarém", "Almeirim", "Santana"]
destinations = ["Santarém", "Monte Alegre", "Prainha", "Almeirim", "Santana"]

session = requests.Session()

# Let's check dates from today to 10 days in the future
today = datetime.date.today()
dates = [(today + datetime.timedelta(days=i)).isoformat() for i in range(15)]

print("Scanning for web-available trips...")
found = False

# 1. Get all routes
res = session.get("https://embarcar-e83ea296df06.herokuapp.com/api/routes?format=json")
routes = []
try:
    routes_data = res.json()
    # Let's query routes by origin
    for origin in origins:
        show_res = session.get(f"https://embarcar-e83ea296df06.herokuapp.com/api/routes/show?q[origin_cont]={origin}")
        if show_res.status_code == 200:
            routes.extend(show_res.json().get("routes", []))
except Exception as e:
    print("Error getting routes:", e)

print(f"Checking {len(routes)} routes over the next 15 days...")
checked = 0
for r in routes:
    route_id = r["id"]
    origin = r["origin"]
    destination = r["destination"]
    for date in dates:
        checked += 1
        # Query available seats with web=true
        seats_url = f"https://embarcar-e83ea296df06.herokuapp.com/api/routes/available_seats?web=true&route_id={route_id}&date={date}"
        try:
            res_seats = session.get(seats_url)
            if res_seats.status_code == 200:
                seats_data = res_seats.json()
                avail = seats_data.get("available_seats", 0)
                if avail > 0:
                    print(f"FOUND! Route ID {route_id} ({origin} -> {destination}) on {date} has {avail} web available seats!")
                    found = True
                    break
        except Exception:
            pass
    if found:
        break

if not found:
    print(f"Checked {checked} combinations. No web-available trips found.")
