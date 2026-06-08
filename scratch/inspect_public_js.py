import urllib.request
import re

url = "https://embarcar-e83ea296df06.herokuapp.com/assets/public-9182a614092aef9a99eeed81a6ac7815658e09eafbe870c359daf31aad32f71a.js"
try:
    print("Downloading JS asset...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as res:
        js_content = res.read().decode('utf-8', errors='ignore')
        
    print(f"JS downloaded. Size: {len(js_content)} characters.")
    
    # Search for all strings starting with /api/
    api_calls = re.findall(r'["\'](/api/.*?)["\']', js_content)
    print("Found potential API paths:")
    for path in set(api_calls):
        print("  ", path)
        
except Exception as e:
    print("Error:", e)
