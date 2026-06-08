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

# 2. Get ticket details of order 2440
res_ticket = session.get("https://embarcar-e83ea296df06.herokuapp.com/admin/orders/2440?ticket=true")
print("Ticket Details Status:", res_ticket.status_code)

print("--- TICKET DETAILS HTML ---")
print(res_ticket.text[:3000])
