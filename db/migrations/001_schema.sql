CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE conversation_state AS ENUM (
    'START', 'COLLECTING_TRIP', 'COLLECTING_PASSENGER', 'CONFIRMING_ORDER',
    'CREATING_PAYMENT', 'EXPECTING_PAYMENT', 'PAID', 'ALLOCATING_SEATS',
    'COMPLETED', 'PAYMENT_EXPIRED', 'HUMAN_HANDOFF', 'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number varchar(32) NOT NULL UNIQUE,
  full_name text,
  cpf varchar(14),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversational_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  current_state conversation_state NOT NULL DEFAULT 'START',
  intent varchar(32),
  state_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_message_id text,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_active_idx ON conversational_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS sessions_order_id_idx ON conversational_sessions ((state_payload->>'order_id'));

CREATE TABLE IF NOT EXISTS inbound_events (
  event_id text PRIMARY KEY,
  phone_number varchar(32) NOT NULL,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE TABLE IF NOT EXISTS payment_events (
  gateway_event_id text PRIMARY KEY,
  order_id text,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processing_status text NOT NULL DEFAULT 'RECEIVED' CHECK (processing_status IN ('RECEIVED','PROCESSED','IGNORED','FAILED')),
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS payment_events_order_idx ON payment_events(order_id);

CREATE TABLE IF NOT EXISTS conversation_transitions (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES conversational_sessions(id) ON DELETE CASCADE,
  from_state text,
  to_state text NOT NULL,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin text NOT NULL,
  destination text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(origin, destination)
);
CREATE TABLE IF NOT EXISTS trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  departure_time timestamptz NOT NULL,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  total_seats integer NOT NULL CHECK (total_seats > 0),
  available_seats integer NOT NULL CHECK (available_seats BETWEEN 0 AND total_seats),
  status text NOT NULL DEFAULT 'SCHEDULED',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS seats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seat_number varchar(10) NOT NULL,
  status text NOT NULL DEFAULT 'AVAILABLE' CHECK (status IN ('AVAILABLE','HELD','SOLD')),
  held_until timestamptz,
  UNIQUE(trip_id, seat_number)
);
CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  trip_id uuid NOT NULL REFERENCES trips(id),
  external_order_id text UNIQUE,
  status text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  seat_id uuid REFERENCES seats(id),
  voucher_url text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(booking_id, seat_id)
);
