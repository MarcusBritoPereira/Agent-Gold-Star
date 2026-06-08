import urllib.request
import re

url = "https://embarcar-e83ea296df06.herokuapp.com/assets/public-9182a614092aef9a99eeed81a6ac7815658e09eafbe870c359daf31aad32f71a.js"
try:
    print("Downloading JS asset...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as res:
        js_content = res.read().decode('utf-8', errors='ignore')
        
    print(f"JS downloaded. Size: {len(js_content)} characters.")
    
    # Search for occurrences of "/api/orders/create" and print surrounding context (300 chars before and after)
    for match in re.finditer(r'/api/orders/create', js_content):
        start = max(0, match.start() - 500)
        end = min(len(js_content), match.end() + 500)
        print(f"--- MATCH AT {match.start()} ---")
        print(js_content[start:end])
        print("-------------------------------")
        
    # Search for "factory(\"Order\"" or "controller(\"Checkout" or similar
    for match in re.finditer(r'factory\(\s*["\']Order["\']', js_content):
        start = max(0, match.start() - 200)
        end = min(len(js_content), match.end() + 800)
        print(f"--- MATCH FACTORY ORDER AT {match.start()} ---")
        print(js_content[start:end])
        print("---------------------------------------------")

    for match in re.finditer(r'CheckoutController', js_content):
        start = max(0, match.start() - 200)
        end = min(len(js_content), match.end() + 2000)
        print(f"--- MATCH CHECKOUT CONTROLLER AT {match.start()} ---")
        print(js_content[start:end])
        print("---------------------------------------------")

except Exception as e:
    print("Error:", e)
