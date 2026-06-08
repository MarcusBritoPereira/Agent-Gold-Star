import requests
import re
import json

session = requests.Session()
# Fetch home page to get CSRF token and session cookies
res_home = session.get("https://embarcar-e83ea296df06.herokuapp.com/")
csrf_token_meta = ""
meta_match = re.search(r'meta name="csrf-token" content="(.*?)"', res_home.text)
if meta_match:
    csrf_token_meta = meta_match.group(1)
print("Meta CSRF Token:", csrf_token_meta)

headers = {
    "X-CSRF-Token": csrf_token_meta,
    "Content-Type": "application/json",
    "Accept": "application/json"
}

# Payload with index 1 (as in the Angular code)
payload = {
    "route_id": 22,
    "route_round_trip_id": None,
    "route_one_way_id": None,
    "payment_method": "PIX",
    "search_trip": "one_way",
    "name": "João Teste",
    "phone": "93999999999",
    "documents": {"1": "111.444.777-35"},
    "customers": {"1": "João Teste"},
    "birthdays": {"1": "1990-01-01"},
    "phones": {"1": "93999999999"},
    "document_types": {"1": "CPF"},
    "data": [{"speed_boat_price": 1}, {"hammock_price": 0}, {"suite_price1": 0}, {"suite_price2": 0}],
    "date": "2026-06-05",
    "return_date": None,
    "trip_id": 397
}

print("Posting payload without admin session...")
res_order = session.post("https://embarcar-e83ea296df06.herokuapp.com/api/orders/create?format=json", json=payload, headers=headers)
print("Status Code:", res_order.status_code)
print("Response:", res_order.text)
