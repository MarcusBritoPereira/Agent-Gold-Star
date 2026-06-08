import requests
import re

session = requests.Session()
login_url = "https://embarcar-e83ea296df06.herokuapp.com/admin/users/sign_in"

# 1. Get authenticity token from sign in page
res = session.get(login_url)
csrf_match = re.search(r'name="authenticity_token" value="(.*?)"', res.text)
csrf_token = csrf_match.group(1) if csrf_match else ""

print("CSRF Token:", csrf_token)

# 2. Login
login_data = {
    "authenticity_token": csrf_token,
    "user[email]": "api@gmail.com",
    "user[password]": "12345678",
    "user[remember_me]": "1",
    "commit": "Login"
}

res_login = session.post(login_url, data=login_data)
print("Login status code:", res_login.status_code)
print("Logged in cookies:", session.cookies.get_dict())

# 3. Try creating order with a simple payload to see the error message (e.g. CSRF or validation)
# Let's get CSRF token for the session (often stored in meta tag)
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

# According to the JS controller, createOrder takes:
# route_id, route_round_trip_id, route_one_way_id, payment_method, search_trip, name, phone, documents, customers, birthdays, phones, document_types, data, date, return_date, trip_id
payload = {
    "route_id": 22,
    "trip_id": 397,
    "payment_method": "CREDIT_CARD",
    "search_trip": "one_way",
    "name": "João Teste",
    "phone": "93999999999",
    "date": "2026-06-05",
    "documents": ["111.444.777-35"],
    "customers": ["João Teste"],
    "birthdays": ["1990-01-01"],
    "phones": ["93999999999"],
    "document_types": ["CPF"],
    "data": [{"speed_boat_price": 1}],
}

res_order = session.post("https://embarcar-e83ea296df06.herokuapp.com/api/orders/create?format=json", json=payload, headers=headers)
print("Order status:", res_order.status_code)
print("Order response text:", res_order.text[:2000])
