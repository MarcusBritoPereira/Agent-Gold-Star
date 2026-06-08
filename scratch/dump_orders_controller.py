import urllib.request

url = "https://embarcar-e83ea296df06.herokuapp.com/assets/public-9182a614092aef9a99eeed81a6ac7815658e09eafbe870c359daf31aad32f71a.js"
try:
    print("Downloading JS asset...")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as res:
        js_content = res.read().decode('utf-8', errors='ignore')
        
    idx = js_content.find('controller("OrdersController"')
    if idx != -1:
        # Find next controller block to limit search
        next_idx = js_content.find('.controller(', idx + 30)
        if next_idx == -1:
            next_idx = idx + 25000
        controller_code = js_content[idx:next_idx]
        with open("/Users/marcuspereira/Agente-Gold-Star/scratch/orders_controller_dump.js", "w") as f:
            f.write(controller_code)
        print("Successfully written to scratch/orders_controller_dump.js")
    else:
        print("Not found")

except Exception as e:
    print("Error:", e)
