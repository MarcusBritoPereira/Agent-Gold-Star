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
    "user[email]": "api@gmail.com",
    "user[password]": "12345678",
    "commit": "Login"
}
session.post(login_url, data=login_data)

res_orders = session.get("https://embarcar-e83ea296df06.herokuapp.com/admin/orders")
with open("/Users/marcuspereira/Agente-Gold-Star/scratch/orders_admin.html", "w") as f:
    f.write(res_orders.text)
print("Saved to scratch/orders_admin.html")
