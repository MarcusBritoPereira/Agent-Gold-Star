import urllib.request
import re

url = "https://embarcar-e83ea296df06.herokuapp.com/assets/public-9182a614092aef9a99eeed81a6ac7815658e09eafbe870c359daf31aad32f71a.js"
try:
    print("Downloading JS asset...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as res:
        js_content = res.read().decode('utf-8', errors='ignore')
        
    idx = js_content.find('createOrder=function')
    if idx != -1:
        print("Found createOrder at:", idx)
        # Search backward from idx for "data"
        snippet = js_content[idx-6000:idx]
        print("--- SNIPPET BEFORE createOrder ---")
        # Find all occurrences of "data" or "customers" or "documents"
        for match in re.finditer(r'\b(?:data|customers|documents|birthdays|phones|document_types)\b', snippet):
            start = max(0, match.start() - 50)
            end = min(len(snippet), match.end() + 100)
            print(f"Match '{match.group(0)}' at {match.start()}:")
            print(snippet[start:end])
            print("-"*30)
    else:
        print("createOrder not found")

except Exception as e:
    print("Error:", e)
