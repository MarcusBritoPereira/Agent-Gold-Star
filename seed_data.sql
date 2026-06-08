-- Optional development fixtures. Run after db/migrations/001_schema.sql.
BEGIN;
INSERT INTO routes (id, origin, destination, duration_minutes) VALUES
('a0e2b85e-f00d-4074-b223-9588bf3a1111', 'Manaus', 'Careiro', 40),
('b0e2b85e-f00d-4074-b223-9588bf3a2222', 'Careiro', 'Manaus', 40),
('c0e2b85e-f00d-4074-b223-9588bf3a3333', 'Manaus', 'Parintins', 360)
ON CONFLICT (id) DO UPDATE SET origin=EXCLUDED.origin,destination=EXCLUDED.destination,duration_minutes=EXCLUDED.duration_minutes;

INSERT INTO trips (id, route_id, departure_time, price_cents, total_seats, available_seats, status) VALUES
('d0e2b85e-f00d-4074-b223-9588bf3a4441','a0e2b85e-f00d-4074-b223-9588bf3a1111',date_trunc('day',now()+interval '1 day')+interval '8 hours',5000,20,20,'SCHEDULED'),
('d0e2b85e-f00d-4074-b223-9588bf3a4442','a0e2b85e-f00d-4074-b223-9588bf3a1111',date_trunc('day',now()+interval '1 day')+interval '14 hours',5000,20,20,'SCHEDULED'),
('d0e2b85e-f00d-4074-b223-9588bf3a4445','c0e2b85e-f00d-4074-b223-9588bf3a3333',date_trunc('day',now()+interval '2 days')+interval '7 hours',15000,20,20,'SCHEDULED')
ON CONFLICT (id) DO UPDATE SET departure_time=EXCLUDED.departure_time,available_seats=EXCLUDED.available_seats,status=EXCLUDED.status;

INSERT INTO seats(trip_id,seat_number,status)
SELECT trip.id, number || side, 'AVAILABLE'
FROM trips trip CROSS JOIN generate_series(1,10) number CROSS JOIN (VALUES('A'),('B')) sides(side)
ON CONFLICT (trip_id,seat_number) DO NOTHING;
COMMIT;
