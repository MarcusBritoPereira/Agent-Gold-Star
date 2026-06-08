CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users','conversational_sessions','bookings'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_set_updated_at ON %I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', table_name, table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION audit_conversation_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.current_state IS DISTINCT FROM NEW.current_state THEN
    INSERT INTO conversation_transitions(session_id, from_state, to_state, reason, metadata)
    VALUES (NEW.id, OLD.current_state::text, NEW.current_state::text, 'workflow transition', jsonb_build_object('intent', NEW.intent));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS conversational_sessions_audit_transition ON conversational_sessions;
CREATE TRIGGER conversational_sessions_audit_transition
AFTER UPDATE OF current_state ON conversational_sessions
FOR EACH ROW EXECUTE FUNCTION audit_conversation_transition();
