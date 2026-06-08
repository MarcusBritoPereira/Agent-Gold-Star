import urllib.request
import re

url = "https://embarcar-e83ea296df06.herokuapp.com/assets/public-9182a614092aef9a99eeed81a6ac7815658e09eafbe870c359daf31aad32f71a.js"
try:
    print("Downloading JS asset...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as res:
        js_content = res.read().decode('utf-8', errors='ignore')
        
    print(f"JS downloaded. Size: {len(js_content)} characters.")
    
    # Let's search for occurrences of .controller( and see what we get
    controllers = re.findall(r'\.controller\(\s*["\'](.*?)["\']', js_content)
    print("Found controllers:", controllers)
    
    # Search for code that calls Order.create or Order.save
    for match in re.finditer(r'Order\.', js_content):
        start = max(0, match.start() - 200)
        end = min(len(js_content), match.end() + 2000)
        print(f"--- MATCH Order. AT {match.start()} ---")
        print(js_content[start:end])
        print("---------------------------------------")

except Exception as e:
    print("Error:", e)
