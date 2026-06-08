-- ==========================================
-- GOLD STAR HYDROVIA TICKETING SYSTEM
-- Mock Data Seeding Script (PostgreSQL)
-- ==========================================

-- Clean existing operational data (if any)
TRUNCATE TABLE tickets, bookings, seats, trips, routes, users CASCADE;

-- 1. Insert Core Routes
INSERT INTO routes (id, origin, destination, duration_minutes) VALUES
('a0e2b85e-f00d-4074-b223-9588bf3a1111', 'Manaus', 'Careiro', 40),
('b0e2b85e-f00d-4074-b223-9588bf3a2222', 'Careiro', 'Manaus', 40),
('c0e2b85e-f00d-4074-b223-9588bf3a3333', 'Manaus', 'Parintins', 360);

-- 2. Insert Trips (Departures for tomorrow and the day after)
-- We use relative dates to ensure trips are always in the future relative to execution
INSERT INTO trips (id, route_id, departure_time, price_cents, total_seats, available_seats, status) VALUES
-- Manaus -> Careiro Trips
('d0e2b85e-f00d-4074-b223-9588bf3a4441', 'a0e2b85e-f00d-4074-b223-9588bf3a1111', NOW() + INTERVAL '1 day' + INTERVAL '8 hours', 5000, 20, 20, 'SCHEDULED'),
('d0e2b85e-f00d-4074-b223-9588bf3a4442', 'a0e2b85e-f00d-4074-b223-9588bf3a1111', NOW() + INTERVAL '1 day' + INTERVAL '14 hours', 5000, 20, 20, 'SCHEDULED'),
-- Careiro -> Manaus Trips
('d0e2b85e-f00d-4074-b223-9588bf3a4443', 'b0e2b85e-f00d-4074-b223-9588bf3a2222', NOW() + INTERVAL '1 day' + INTERVAL '10 hours', 5000, 20, 20, 'SCHEDULED'),
('d0e2b85e-f00d-4074-b223-9588bf3a4444', 'b0e2b85e-f00d-4074-b223-9588bf3a2222', NOW() + INTERVAL '1 day' + INTERVAL '16 hours', 5000, 20, 20, 'SCHEDULED'),
-- Manaus -> Parintins Trips
('d0e2b85e-f00d-4074-b223-9588bf3a4445', 'c0e2b85e-f00d-4074-b223-9588bf3a3333', NOW() + INTERVAL '2 days' + INTERVAL '7 hours', 15000, 20, 20, 'SCHEDULED');

-- 3. Generate Seats for each Trip
-- We create seats 1A to 10B (20 seats per trip) for all trips
DO $$
DECLARE
    t_id RECORD;
    i INT;
    seat_num VARCHAR(10);
BEGIN
    FOR t_id IN SELECT id FROM trips LOOP
        FOR i IN 1..10 LOOP
            -- Seat A
            seat_num := i || 'A';
            INSERT INTO seats (trip_id, seat_number, status) VALUES (t_id.id, seat_num, 'AVAILABLE');
            
            -- Seat B
            seat_num := i || 'B';
            INSERT INTO seats (trip_id, seat_number, status) VALUES (t_id.id, seat_num, 'AVAILABLE');
        END LOOP;
    END LOOP;
END $$;

-- 4. Create one mock User for testing
INSERT INTO users (id, phone_number, full_name, cpf) VALUES
('e0e2b85e-f00d-4074-b223-9588bf3a9999', '+5511999999999', 'Marcus Pereira Teste', '123.456.789-00');
