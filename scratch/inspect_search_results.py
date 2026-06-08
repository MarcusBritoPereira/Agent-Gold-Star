import urllib.request
import urllib.parse
import re

base_url = "https://embarcar-e83ea296df06.herokuapp.com"
query_params = urllib.parse.urlencode({
    "trip_search": "one_way",
    "q[origin_cont]": "Prainha",
    "q[destination_cont]": "Santarém",
    "date": "2026-06-04",
    "q[button]": ""
})

url = f"{base_url}/?{query_params}"
try:
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as res:
        html = res.read().decode('utf-8')
        
    # Let's write the HTML to a file in scratch so we can look at it
    with open("/Users/marcuspereira/Agente-Gold-Star/scratch/search_results.html", "w") as f:
        f.write(html)
        
    # Search for visible text in the container
    text_content = re.sub('<[^<]+?>', '', html)
    print("Visible text containing Prainha or Santarém:")
    for line in text_content.split('\n'):
        line = line.strip()
        if line and any(x in line for x in ["Prainha", "Santarém", "Lancha", "Horário", "R$", "Valor"]):
            print("  ", line)
except Exception as e:
    print("Error:", e)
