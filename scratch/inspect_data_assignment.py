import urllib.request
import re

url = "https://embarcar-e83ea296df06.herokuapp.com/assets/public-9182a614092aef9a99eeed81a6ac7815658e09eafbe870c359daf31aad32f71a.js"
try:
    print("Downloading JS asset...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as res:
        js_content = res.read().decode('utf-8', errors='ignore')
        
    idx = js_content.find('controller("RoutesController"')
    if idx != -1:
        controller_code = js_content[idx:idx+15000]
        for match in re.finditer(r'\bdata\b', controller_code):
            start = max(0, match.start() - 50)
            end = min(len(controller_code), match.end() + 100)
            print(f"Match 'data' at {match.start()}:")
            print(controller_code[start:end])
            print("-"*30)
    else:
        print("RoutesController not found")

except Exception as e:
    print("Error:", e)
