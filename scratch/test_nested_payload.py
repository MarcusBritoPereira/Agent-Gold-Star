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

# Construct the nested payload
payload = {
    "order": {
        "route_id": 22,
        "trip_id": 397,
        "origin": "Santana",
        "destination": "Santarém",
        "date": "2026-06-05",
        "payment_method": "PIX", # Let's use PIX
        "price": "524.0", # Let's set some price/tax
        "tax": "0.0",
        "order_customers_attributes": [
            {
                "customer_attributes": {
                    "name": "João Teste",
                    "document": "111.444.777-35",
                    "document_type": "CPF",
                    "birthday": "1990-01-01",
                    "phone": "93999999999"
                },
                "ticket_price": "524.0",
                "tax_price": "0.0"
            }
        ]
    }
}

res_order = session.post("https://embarcar-e83ea296df06.herokuapp.com/api/orders/create?format=json", json=payload, headers=headers)
print("Status Code:", res_order.status_code)
print("Response JSON:", res_order.text)
