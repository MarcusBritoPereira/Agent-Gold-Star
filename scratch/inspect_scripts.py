import urllib.request
import re

url = "https://embarcar-e83ea296df06.herokuapp.com/"
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as res:
        html = res.read().decode('utf-8')
        
    scripts = re.findall(r'<script.*?(?:src=["\'](.*?)["\'])?.*?>.*?</script>', html, re.DOTALL)
    print("Found scripts:")
    for src in re.findall(r'<script.*?src=["\'](.*?)["\']', html):
        print("  External:", src)
        
    # Find inline scripts containing Angular
    inline_scripts = re.findall(r'<script(?![^>]*src).*?>(.*?)</script>', html, re.DOTALL)
    print(f"Found {len(inline_scripts)} inline scripts.")
    for i, script in enumerate(inline_scripts):
        if "angular" in script.lower() or "controller" in script.lower() or "origins" in script.lower():
            print(f"  Inline Script #{i}:")
            print(script[:1000])
except Exception as e:
    print("Error:", e)
