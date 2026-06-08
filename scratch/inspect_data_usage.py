import re

with open("/Users/marcuspereira/Agente-Gold-Star/scratch/orders_controller_dump.js", "r") as f:
    code = f.read()

# Let's search for "data" case-insensitively, or specifically "t.data"
for m in re.finditer(r'\bdata\b', code):
    print(f"Match at {m.start()}:")
    print(code[max(0, m.start()-100):min(len(code), m.end()+100)])
    print("="*40)
