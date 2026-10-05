-- SAAKSHI dashboard database. Run once in the Supabase SQL editor.
-- Each organisation sees only its own nodes. The sync script uses the service key, which bypasses RLS.
-- No private keys belong in this database (wallet key, broker CA key, broker passwords).

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  primary key (org_id, user_id)
);

create table nodes (
  node_id text primary key,
  org_id uuid references orgs(id),          -- null until an admin links the node to a company
  pubkey text,                              -- 130 hex chars, public; enables live reads from Polygon
  name text,
  product text,
  log_interval_s int not null default 600,
  temp_lo numeric,
  temp_hi numeric,
  excursion_min int not null default 10,    -- minutes outside the band before an alert
  unanchored_hours int not null default 6,
  offline_min int,                          -- null means 3 x log interval
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create table chains (
  node_id text not null references nodes(node_id) on delete cascade,
  chain_id text not null,
  first_seq int not null default 0,
  last_seq int not null default 0,
  started_at timestamptz,
  ended_at timestamptz,
  label text,
  primary key (node_id, chain_id)
);

create table readings (
  node_id text not null,
  chain_id text not null,
  seq int not null,
  boot int,
  uptime_s bigint,
  unix_time bigint,                         -- UTC seconds, 0 = clock not set
  temp_c numeric,
  rh_pct numeric,
  pressure_hpa numeric,
  gas_kohm numeric,
  rtc_temp_c numeric,
  mpu_temp_c numeric,
  peak_g numeric,
  moves int,
  sensor_id text,
  flags int not null default 0,
  signed boolean not null default true,
  hash text,
  primary key (node_id, chain_id, seq),
  foreign key (node_id, chain_id) references chains(node_id, chain_id) on delete cascade
);

create table anchors (
  node_id text not null,
  chain_id text not null,
  seq int not null,
  record_hash text not null,
  tx text,
  block bigint,
  anchored_at timestamptz,
  primary key (node_id, chain_id, seq)
);

create table alerts (
  id bigserial primary key,
  dedupe_key text unique,                   -- lets the sync script re-run without duplicating alerts
  node_id text not null,
  chain_id text,
  seq int,
  type text not null,
  severity text not null check (severity in ('high','medium','low')),
  message text not null,
  created_at timestamptz not null default now(),
  acked_by uuid references auth.users(id),
  acked_at timestamptz
);

-- The buyer-link decryption key for each node. Visible only to the owning organisation.
create table share_links (
  node_id text primary key references nodes(node_id) on delete cascade,
  view_key text not null,
  created_at timestamptz not null default now()
);

create table order_requests (
  id bigserial primary key,
  name text, company text, phone text, email text,
  nodes int, product text,
  created_at timestamptz not null default now()
);

create index on readings (node_id, chain_id, seq);
create index on alerts (node_id, created_at desc);

-- Row level security ---------------------------------------------------------------------------

create function public.my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from members where user_id = auth.uid()
$$;

create function public.can_see_node(n text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from nodes where node_id = n and org_id in (select public.my_org_ids()))
$$;

alter table orgs enable row level security;
alter table members enable row level security;
alter table nodes enable row level security;
alter table chains enable row level security;
alter table readings enable row level security;
alter table anchors enable row level security;
alter table alerts enable row level security;
alter table share_links enable row level security;
alter table order_requests enable row level security;

create policy orgs_read on orgs for select using (id in (select public.my_org_ids()));
create policy members_read on members for select using (user_id = auth.uid());

create policy nodes_read on nodes for select using (org_id in (select public.my_org_ids()));
-- Owners may rename a node and tune thresholds. They cannot move a node to another org.
create policy nodes_update on nodes for update
  using (org_id in (select public.my_org_ids()))
  with check (org_id in (select public.my_org_ids()));

create policy chains_read on chains for select using (public.can_see_node(node_id));
create policy readings_read on readings for select using (public.can_see_node(node_id));
create policy anchors_read on anchors for select using (public.can_see_node(node_id));

create policy alerts_read on alerts for select using (public.can_see_node(node_id));
create policy alerts_ack on alerts for update
  using (public.can_see_node(node_id)) with check (public.can_see_node(node_id));

create policy share_all on share_links for all
  using (public.can_see_node(node_id)) with check (public.can_see_node(node_id));

-- Anyone may submit a request; nobody can read them from the browser (use the Supabase dashboard).
create policy orders_insert on order_requests for insert to anon, authenticated with check (true);

-- Only the acknowledgement columns of an alert may be changed from the browser
revoke update on alerts from anon, authenticated;
grant update (acked_by, acked_at) on alerts to authenticated;
-- Same idea for nodes: owners edit settings, never the owner, key or timestamps
revoke update on nodes from anon, authenticated;
grant update (name, product, temp_lo, temp_hi, excursion_min, unanchored_hours, offline_min, log_interval_s) on nodes to authenticated;

-- Sign-up: the front end passes org_name in the user metadata and this creates the organisation
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  insert into orgs (name) values (coalesce(nullif(new.raw_user_meta_data->>'org_name', ''), new.email))
    returning id into new_org;
  insert into members (org_id, user_id, role) values (new_org, new.id, 'owner');
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Linking a node to a company (done by the AEGIS_X team, using the SQL editor):
--   update nodes set org_id = '<org uuid>', pubkey = '04...' where node_id = 'SAAKSHI-XXXXXXXX';
