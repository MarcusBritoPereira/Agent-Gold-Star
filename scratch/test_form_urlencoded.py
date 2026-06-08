import requests
import re

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
    "Accept": "application/json"
}

# Payload as form data (multipart or urlencoded)
form_data = {
    "order[route_id]": "22",
    "order[trip_id]": "397",
    "order[origin]": "Santana",
    "order[destination]": "Santarém",
    "order[date]": "2026-06-05",
    "order[payment_method]": "PIX",
    "order[price]": "524.0",
    "order[tax]": "0.0",
    "order[order_customers_attributes][0][customer_attributes][name]": "João Teste",
    "order[order_customers_attributes][0][customer_attributes][document]": "111.444.777-35",
    "order[order_customers_attributes][0][customer_attributes][document_type]": "CPF",
    "order[order_customers_attributes][0][customer_attributes][birthday]": "1990-01-01",
    "order[order_customers_attributes][0][customer_attributes][phone]": "93999999999",
    "order[order_customers_attributes][0][ticket_price]": "524.0",
    "order[order_customers_attributes][0][tax_price]": "0.0"
}

print("Posting form-urlencoded payload...")
res_order = session.post("https://embarcar-e83ea296df06.herokuapp.com/api/orders/create?format=json", data=form_data, headers=headers)
print("Status Code:", res_order.status_code)
print("Response JSON:", res_order.text)
