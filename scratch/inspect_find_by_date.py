import urllib.request
import re

url = "https://embarcar-e83ea296df06.herokuapp.com/assets/public-9182a614092aef9a99eeed81a6ac7815658e09eafbe870c359daf31aad32f71a.js"
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as res:
        js_content = res.read().decode('utf-8', errors='ignore')
        
    # Search for find_by_date and get surrounding 500 chars
    for m in re.finditer(r'find_by_date', js_content):
        start = max(0, m.start() - 200)
        end = min(len(js_content), m.end() + 800)
        print("--- MATCH FIND_BY_DATE ---")
        print(js_content[start:end])
        print("---------------------------")
        
except Exception as e:
    print("Error:", e)
