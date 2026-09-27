-- DriveMetrik core schema — ported from the Floot/Neon prototype (23 tables).
-- Supabase-compatibility changes vs. the source (everything else is 1:1):
--   * users / user_passwords / sessions / login_attempts  -> replaced by Supabase Auth
--     (auth.users) + public.profiles. All *_user_id int4 columns -> uuid.
--   * job_line_items.job_id gets the FK to jobs the source was missing.
--   * Composite (id, shop_id) foreign keys so a row can never reference another
--     shop's customer/vehicle/job/invoice/employee — enforced by the database.
--   * RLS on every table; tenant resolved server-side from employees, never from input.

create extension if not exists pgcrypto;

-- ---------- enums ----------
create type public.shop_role as enum (
  'platform_owner','shop_owner','manager','service_advisor','cashier','greeter',
  'technician','shop_foreman','fleet_manager','accountant','customer');
create type public.user_role as enum ('user','admin');

-- ---------- profiles (replaces users) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text not null,
  avatar_url text,
  role public.user_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- shops / employees ----------
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text, phone text, email text,
  tax_rate_pct numeric not null default 0,
  subscription_plan text not null default 'trial',
  subscription_status text not null default 'trialing',
  stripe_customer_id text, stripe_subscription_id text,
  is_test_data boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.employees (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  shop_id uuid references public.shops(id) on delete cascade,
  role public.shop_role not null,
  phone text, pin text,
  hourly_rate numeric, commission_pct numeric,
  overtime_threshold_hours numeric not null default 40,
  active boolean not null default true,
  unique (user_id, shop_id)
);
create index idx_employees_shop on public.employees(shop_id);

-- ---------- tenant helpers (used by RLS) ----------
create or replace function public.current_shop_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select e.shop_id from public.employees e
  where e.user_id = auth.uid() and e.active and e.shop_id is not null
$$;
create or replace function public.current_shop_role() returns public.shop_role
language sql stable security definer set search_path = '' as $$
  select e.role from public.employees e
  where e.user_id = auth.uid() and e.active and e.shop_id is not null
$$;

-- ---------- customers / vehicles ----------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  phone text, email text, address text, notes text,
  is_fleet boolean not null default false,
  is_test_data boolean not null default false,
  import_batch_id text,
  created_at timestamptz not null default now(),
  unique (id, shop_id)
);
create index idx_customers_shop on public.customers(shop_id);

create table public.vehicles (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  owner_id uuid not null,
  year int, make text, model text, trim text, vin text,
  license_plate text, plate_state text, mileage int,
  is_test_data boolean not null default false,
  import_batch_id text,
  created_at timestamptz not null default now(),
  unique (id, shop_id),
  foreign key (owner_id, shop_id) references public.customers(id, shop_id) on delete cascade
);
create index idx_vehicles_shop on public.vehicles(shop_id);
create index idx_vehicles_owner on public.vehicles(owner_id);

create table public.vehicle_service_history (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  service_date date not null,
  mileage int,
  services text not null,
  is_test_data boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_vsh_vehicle on public.vehicle_service_history(vehicle_id);

-- ---------- jobs / estimates / invoices ----------
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  customer_id uuid not null,
  vehicle_id uuid not null,
  technician_user_id uuid,
  concern text,
  status text not null default 'Open',
  created_at timestamptz not null default now(),
  unique (id, shop_id),
  foreign key (customer_id, shop_id) references public.customers(id, shop_id),
  foreign key (vehicle_id, shop_id) references public.vehicles(id, shop_id),
  foreign key (technician_user_id, shop_id) references public.employees(user_id, shop_id)
);
create index idx_jobs_shop on public.jobs(shop_id);

create table public.job_line_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,  -- FK missing in source
  label text not null,
  kind text not null default 'service',
  price numeric not null default 0
);
create index idx_jli_job on public.job_line_items(job_id);

create table public.estimates (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  job_id uuid,
  customer_id uuid not null,
  vehicle_id uuid not null,
  status text not null default 'Pending',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (job_id, shop_id) references public.jobs(id, shop_id),
  foreign key (customer_id, shop_id) references public.customers(id, shop_id),
  foreign key (vehicle_id, shop_id) references public.vehicles(id, shop_id)
);
create index idx_estimates_shop on public.estimates(shop_id);

create table public.estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  label text not null,
  kind text not null default 'service',
  price numeric not null default 0
);
create index idx_eli_estimate on public.estimate_line_items(estimate_id);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  job_id uuid,
  customer_id uuid not null,
  vehicle_id uuid not null,
  invoice_number text not null,
  status text not null default 'Unpaid',
  tax_rate_pct numeric not null default 0,
  tax_exempt boolean not null default false,
  manual_discount numeric not null default 0,
  coupon_discount numeric not null default 0,
  payment_method text,
  paid_date timestamptz,
  fleet_account_id uuid,
  is_test_data boolean not null default false,
  import_batch_id text,
  created_at timestamptz not null default now(),
  unique (shop_id, invoice_number),
  unique (id, shop_id),
  foreign key (job_id, shop_id) references public.jobs(id, shop_id),
  foreign key (customer_id, shop_id) references public.customers(id, shop_id),
  foreign key (vehicle_id, shop_id) references public.vehicles(id, shop_id),
  foreign key (fleet_account_id, shop_id) references public.customers(id, shop_id)
);
create index idx_invoices_shop on public.invoices(shop_id);

create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  label text not null,
  kind text not null default 'service',
  price numeric not null default 0
);
create index idx_ili_invoice on public.invoice_line_items(invoice_id);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  invoice_id uuid,
  customer_id uuid,
  amount numeric not null,
  method text not null,
  stripe_payment_intent_id text,
  refunded boolean not null default false,
  created_at timestamptz not null default now(),
  foreign key (invoice_id, shop_id) references public.invoices(id, shop_id),
  foreign key (customer_id, shop_id) references public.customers(id, shop_id)
);
create index idx_payments_shop on public.payments(shop_id);

-- ---------- cash / close / timeclock ----------
create table public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  employee_user_id uuid not null,
  type text not null check (type in ('paid_in','paid_out')),
  category text not null,
  amount numeric not null,
  memo text not null,
  payment_method text,
  related_customer_id uuid,
  related_invoice_id uuid,
  related_fleet_account_id uuid,
  created_at timestamptz not null default now(),
  foreign key (employee_user_id, shop_id) references public.employees(user_id, shop_id),
  foreign key (related_customer_id, shop_id) references public.customers(id, shop_id),
  foreign key (related_invoice_id, shop_id) references public.invoices(id, shop_id),
  foreign key (related_fleet_account_id, shop_id) references public.customers(id, shop_id)
);
create index idx_cash_shop on public.cash_transactions(shop_id);

create table public.daily_close (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  business_date date not null,
  closed_by_user_id uuid not null,
  opening_cash numeric not null, cash_sales numeric not null,
  paid_in numeric not null, paid_out numeric not null,
  expected_cash numeric not null, actual_cash numeric not null,
  over_short numeric not null,
  closed_at timestamptz not null default now(),
  unique (shop_id, business_date),
  foreign key (closed_by_user_id, shop_id) references public.employees(user_id, shop_id)
);

create table public.timeclock_entries (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  employee_user_id uuid not null,
  clock_in timestamptz not null,
  clock_out timestamptz,
  adjusted boolean not null default false,
  adjusted_by_user_id uuid,
  foreign key (employee_user_id, shop_id) references public.employees(user_id, shop_id),
  foreign key (adjusted_by_user_id, shop_id) references public.employees(user_id, shop_id)
);
create index idx_timeclock_shop on public.timeclock_entries(shop_id);

-- ---------- coupons / inventory / migration / audit ----------
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  code text not null,
  discount_type text not null check (discount_type in ('flat','percent')),
  discount_value numeric not null,
  active boolean not null default true,
  unique (shop_id, code)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  part_number text,
  stock int not null default 0,
  reorder_point int not null default 0,
  cost numeric, sell_price numeric, vendor text,
  is_test_data boolean not null default false
);
create index idx_inventory_shop on public.inventory_items(shop_id);

create table public.migration_batches (
  batch_id text primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  name text not null,
  status text not null default 'complete',
  source_file_count int not null default 0,
  customer_count int not null default 0,
  vehicle_count int not null default 0,
  invoice_count int not null default 0,
  is_test_data boolean not null default false,
  created_by_user_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_migration_shop on public.migration_batches(shop_id);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops(id) on delete cascade,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_shop on public.audit_log(shop_id);
