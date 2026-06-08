import urllib.request
import re

url = "https://embarcar-e83ea296df06.herokuapp.com/assets/public-9182a614092aef9a99eeed81a6ac7815658e09eafbe870c359daf31aad32f71a.js"
try:
    print("Downloading JS asset...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as res:
        js_content = res.read().decode('utf-8', errors='ignore')
        
    idx = js_content.find('controller("OrdersController"')
    if idx != -1:
        orders_controller_code = js_content[idx:idx+6000]
        # Search for any string containing "data"
        for match in re.finditer(r'\bdata\b', orders_controller_code):
            start = max(0, match.start() - 100)
            end = min(len(orders_controller_code), match.end() + 200)
            print(f"--- MATCH data at {match.start()} ---")
            print(orders_controller_code[start:end])
            print("-------------------------------------")
    else:
        print("Not found")

except Exception as e:
    print("Error:", e)
