import psycopg2

ports = [5432, 5433, 5435]
for port in ports:
    try:
        # try connection
        conn = psycopg2.connect(
            host="localhost",
            port=port,
            user="postgres",
            password="postgres",
            database="postgres"
        )
        cur = conn.cursor()
        cur.execute("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';")
        tables = [r[0] for r in cur.fetchall()]
        print(f"Port {port} (db: postgres): {tables}")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Port {port} (db: postgres) failed: {e}")

    try:
        # try connection with other db names
        db_name = "upscribe" if port == 5432 else ("ourico" if port == 5435 else "erp")
        conn = psycopg2.connect(
            host="localhost",
            port=port,
            user="postgres",
            password="postgres",
            database=db_name
        )
        cur = conn.cursor()
        cur.execute("SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname = 'public';")
        tables = [r[0] for r in cur.fetchall()]
        print(f"Port {port} (db: {db_name}): {tables}")
        cur.close()
        conn.close()
    except Exception as e:
        print(f"Port {port} (db: {db_name}) failed: {e}")
