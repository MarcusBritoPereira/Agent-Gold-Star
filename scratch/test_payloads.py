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
    "user[email]": "api@gmail.com",
    "user[password]": "12345678",
    "user[remember_me]": "1",
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

# Test Cases
test_cases = []

# Case 1: Array starting with null (since Angular index is 1..10)
test_cases.append({
    "name": "Case 1: Arrays starting with null",
    "payload": {
        "route_id": 22,
        "trip_id": 397,
        "payment_method": "CREDIT_CARD",
        "search_trip": "one_way",
        "name": "João Teste",
        "phone": "93999999999",
        "date": "2026-06-05",
        "documents": [None, "111.444.777-35"],
        "customers": [None, "João Teste"],
        "birthdays": [None, "01/01/1990"],
        "phones": [None, "93999999999"],
        "document_types": [None, "CPF"],
        "data": json.dumps([{"speed_boat_price": 1}, {"hammock_price": 0}, {"suite_price1": 0}, {"suite_price2": 0}]),
    }
})

# Case 2: Hashes instead of arrays for passenger details
test_cases.append({
    "name": "Case 2: Hashes for passenger details",
    "payload": {
        "route_id": 22,
        "trip_id": 397,
        "payment_method": "CREDIT_CARD",
        "search_trip": "one_way",
        "name": "João Teste",
        "phone": "93999999999",
        "date": "2026-06-05",
        "documents": {"1": "111.444.777-35"},
        "customers": {"1": "João Teste"},
        "birthdays": {"1": "1990-01-01"},
        "phones": {"1": "93999999999"},
        "document_types": {"1": "CPF"},
        "data": [{"speed_boat_price": 1}, {"hammock_price": 0}, {"suite_price1": 0}, {"suite_price2": 0}],
    }
})

# Case 3: Hashes + stringified data
test_cases.append({
    "name": "Case 3: Hashes + stringified data",
    "payload": {
        "route_id": 22,
        "trip_id": 397,
        "payment_method": "CREDIT_CARD",
        "search_trip": "one_way",
        "name": "João Teste",
        "phone": "93999999999",
        "date": "2026-06-05",
        "documents": {"1": "111.444.777-35"},
        "customers": {"1": "João Teste"},
        "birthdays": {"1": "01/01/1990"},
        "phones": {"1": "93999999999"},
        "document_types": {"1": "CPF"},
        "data": json.dumps([{"speed_boat_price": 1}, {"hammock_price": 0}, {"suite_price1": 0}, {"suite_price2": 0}]),
    }
})

for tc in test_cases:
    print(f"\nRunning {tc['name']}...")
    res = session.post("https://embarcar-e83ea296df06.herokuapp.com/api/orders/create?format=json", json=tc['payload'], headers=headers)
    print("Status:", res.status_code)
    print("Response:", res.text[:2000])
