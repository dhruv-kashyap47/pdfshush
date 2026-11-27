-- The Dodo customer id, so the dashboard can open the hosted customer portal
-- and list payments without asking the customer to find a receipt email.
--
-- It is written by the verified webhook, never by the client, and it is not an
-- entitlement: the plan column stays the only source of access.

ALTER TABLE accounts ADD COLUMN dodo_customer_id TEXT;
