import requests
import re
import json

session = requests.Session()
login_url = "https://embarcar-e83ea296df06.herokuapp.com/admin/users/sign_in"

# 1. Login
res = session.get(login_url)
csrf_match = re.search(r'name="authenticity_token" value="(.*?)"', res.text)
csrf_token = csrf_match.group(1) if csrf_match else ""

login_data = {
    "authenticity_token": csrf_token,
    "admin_user[email]": "api@gmail.com",
    "admin_user[password]": "12345678",
    "commit": "Login"
}
session.post(login_url, data=login_data)

res_home = session.get("https://embarcar-e83ea296df06.herokuapp.com/")
csrf_token_meta = ""
meta_match = re.search(r'meta name="csrf-token" content="(.*?)"', res_home.text)
if meta_match:
    csrf_token_meta = meta_match.group(1)

headers = {
    "X-CSRF-Token": csrf_token_meta,
    "Content-Type": "application/json",
    "Accept": "application/json"
}

# Test Cases with index "0"
test_cases = [
    {
        "name": "Case A: Flat payload with index 0 and real data list",
        "payload": {
            "route_id": 22,
            "trip_id": 397,
            "payment_method": "PIX",
            "search_trip": "one_way",
            "name": "João Teste",
            "phone": "93999999999",
            "date": "2026-06-05",
            "documents": {"0": "111.444.777-35"},
            "customers": {"0": "João Teste"},
            "birthdays": {"0": "1990-01-01"},
            "phones": {"0": "93999999999"},
            "document_types": {"0": "CPF"},
            "data": [{"speed_boat_price": 1}, {"hammock_price": 0}, {"suite_price1": 0}, {"suite_price2": 0}]
        }
    },
    {
        "name": "Case B: Flat payload with index 0 and stringified data list",
        "payload": {
            "route_id": 22,
            "trip_id": 397,
            "payment_method": "PIX",
            "search_trip": "one_way",
            "name": "João Teste",
            "phone": "93999999999",
            "date": "2026-06-05",
            "documents": {"0": "111.444.777-35"},
            "customers": {"0": "João Teste"},
            "birthdays": {"0": "1990-01-01"},
            "phones": {"0": "93999999999"},
            "document_types": {"0": "CPF"},
            "data": json.dumps([{"speed_boat_price": 1}, {"hammock_price": 0}, {"suite_price1": 0}, {"suite_price2": 0}])
        }
    }
]

for tc in test_cases:
    print(f"\nRunning {tc['name']}...")
    res = session.post("https://embarcar-e83ea296df06.herokuapp.com/api/orders/create?format=json", json=tc['payload'], headers=headers)
    print("Status:", res.status_code)
    print("Response:", res.text)
