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

# 2. Get new order form
res_form = session.get("https://embarcar-e83ea296df06.herokuapp.com/admin/orders/new")
print("Status:", res_form.status_code)

# Find all form input names
inputs = re.findall(r'name="([^"]+)"', res_form.text)
print("Input Names:")
for name in sorted(list(set(inputs))):
    print("  ", name)
    
# Let's print the HTML form body
form_match = re.search(r'<form.*?>.*?</form>', res_form.text, re.DOTALL)
if form_match:
    print("\n--- FORM HTML ---")
    print(form_match.group(0)[:3000])
else:
    print("No form found")
