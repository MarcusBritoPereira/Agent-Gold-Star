import urllib.request

url = "https://embarcar-e83ea296df06.herokuapp.com/assets/public-9182a614092aef9a99eeed81a6ac7815658e09eafbe870c359daf31aad32f71a.js"
try:
    print("Downloading JS asset...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as res:
        js_content = res.read().decode('utf-8', errors='ignore')
        
    idx = js_content.find('createOrder=function')
    if idx != -1:
        print("Found createOrder at:", idx)
        snippet = js_content[idx-4000:idx]
        print("--- 4000 CHARS BEFORE createOrder ---")
        print(snippet)
    else:
        print("createOrder not found")

except Exception as e:
    print("Error:", e)
