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
    "user[remember_me]": "1",
    "commit": "Login"
}
session.post(login_url, data=login_data)

# 2. Get /admin/orders
res_orders = session.get("https://embarcar-e83ea296df06.herokuapp.com/admin/orders")
print("Orders Page Status:", res_orders.status_code)
# Find any order ID or links in the page
order_ids = re.findall(r'/admin/orders/(\d+)', res_orders.text)
print("Order IDs found:", set(order_ids))

# Let's print the table headers or some table rows to see columns
rows = re.findall(r'<tr class="row row-\w+">(.*?)</tr>', res_orders.text, re.DOTALL)
print(f"Found {len(rows)} order rows.")
if rows:
    print("Example Row:")
    print(rows[0][:1000])
