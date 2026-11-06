-- Trashlist – databáze pro Supabase
-- Vlož celé do Supabase → SQL Editor → New query → Run.
-- Tabulky nejsou přímo přístupné (RLS bez pravidel); web volá jen funkce níže,
-- které kontrolují jméno + tajný token uživatele.

create table if not exists tl_users (
  key text primary key, name text not null, token text not null, joined bigint not null
);
create table if not exists tl_reviews (
  id text primary key, title_id text not null, "user" text not null,
  poops int not null check (poops between 1 and 5), text text not null default '',
  ts bigint not null, likes text[] not null default '{}', unique (title_id, "user")
);
create table if not exists tl_titles (id text primary key, data jsonb not null, ts bigint not null);
create table if not exists tl_lists (
  "user" text not null, title_id text not null, status text not null, ts bigint not null,
  primary key ("user", title_id)
);
create table if not exists tl_meta (k int primary key, version bigint not null);
insert into tl_meta values (1, 0) on conflict do nothing;

alter table tl_users enable row level security;
alter table tl_reviews enable row level security;
alter table tl_titles enable row level security;
alter table tl_lists enable row level security;
alter table tl_meta enable row level security;

create or replace function tl_now() returns bigint language sql as
$$ select (extract(epoch from clock_timestamp()) * 1000)::bigint $$;

create or replace function tl_bump() returns void language sql security definer set search_path = public as
$$ update tl_meta set version = tl_now() where k = 1 $$;

-- vrátí jméno uživatele, nebo vyhodí chybu
create or replace function tl_auth(p_name text, p_token text) returns text
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  select name into n from tl_users where key = lower(trim(p_name)) and token = p_token;
  if n is null then raise exception 'Nejdřív se zaregistruj'; end if;
  return n;
end $$;

create or replace function tl_version() returns bigint language sql security definer set search_path = public as
$$ select version from tl_meta where k = 1 $$;

create or replace function tl_state() returns json language sql security definer set search_path = public as $$
  select json_build_object(
    'version', (select version from tl_meta where k = 1),
    'users', coalesce((select json_agg(json_build_object('name', name, 'joined', joined)) from tl_users), '[]'),
    'reviews', coalesce((select json_agg(json_build_object('id', id, 'titleId', title_id, 'user', "user",
        'poops', poops, 'text', text, 'ts', ts, 'likes', likes)) from tl_reviews), '[]'),
    'titles', coalesce((select json_agg(data) from tl_titles), '[]'),
    'lists', coalesce((select json_object_agg(u, l) from (
        select "user" u, json_object_agg(title_id, json_build_object('status', status, 'ts', ts)) l
        from tl_lists group by "user") x), '{}')
  )
$$;

create or replace function tl_register(p_name text, p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare n text := left(trim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', ' ', 'g')), 24); u tl_users;
begin
  if length(n) < 2 then raise exception 'Jméno musí mít aspoň 2 znaky'; end if;
  select * into u from tl_users where key = lower(n);
  if found then
    if p_token is not null and u.token = p_token then return json_build_object('name', u.name, 'token', u.token); end if;
    raise exception 'Tohle jméno už někdo má, zkus jiné';
  end if;
  insert into tl_users values (lower(n), n, replace(gen_random_uuid()::text, '-', ''), tl_now()) returning * into u;
  perform tl_bump();
  return json_build_object('name', u.name, 'token', u.token);
end $$;

create or replace function tl_review(p_name text, p_token text, p_title_id text, p_poops int, p_text text) returns json
language plpgsql security definer set search_path = public as $$
declare n text := tl_auth(p_name, p_token); r tl_reviews;
begin
  if p_poops is null or p_poops < 1 or p_poops > 5 then raise exception 'Vyber 1–5 hovínek'; end if;
  insert into tl_reviews (id, title_id, "user", poops, text, ts)
  values (substr(md5(random()::text), 1, 12), left(p_title_id, 120), n, p_poops, left(coalesce(p_text, ''), 1000), tl_now())
  on conflict (title_id, "user") do update set poops = excluded.poops, text = excluded.text, ts = excluded.ts
  returning * into r;
  perform tl_bump();
  return json_build_object('id', r.id);
end $$;

create or replace function tl_review_delete(p_name text, p_token text, p_id text) returns json
language plpgsql security definer set search_path = public as $$
declare n text := tl_auth(p_name, p_token);
begin
  delete from tl_reviews where id = p_id and "user" = n;
  if not found then raise exception 'Nenalezeno'; end if;
  perform tl_bump();
  return json_build_object('ok', true);
end $$;

create or replace function tl_review_like(p_name text, p_token text, p_id text) returns json
language plpgsql security definer set search_path = public as $$
declare n text := tl_auth(p_name, p_token);
begin
  update tl_reviews set likes = case when n = any(likes) then array_remove(likes, n) else array_append(likes, n) end
  where id = p_id;
  if not found then raise exception 'Nenalezeno'; end if;
  perform tl_bump();
  return json_build_object('ok', true);
end $$;

create or replace function tl_title_add(p_name text, p_token text, p_data jsonb) returns json
language plpgsql security definer set search_path = public as $$
declare n text := tl_auth(p_name, p_token); t jsonb; y int := (p_data->>'year')::int; img text := coalesce(p_data->>'img', '');
begin
  if length(trim(coalesce(p_data->>'title', ''))) < 1 then raise exception 'Chybí název'; end if;
  if y is null or y < 1900 or y > 2030 then raise exception 'Rok vypadá divně'; end if;
  t := jsonb_build_object(
    'id', 'u-' || substr(md5(random()::text), 1, 12), 'title', left(trim(p_data->>'title'), 120), 'year', y,
    'type', case when p_data->>'type' = 'serial' then 'serial' else 'film' end,
    'genres', coalesce((select jsonb_agg(left(g, 30)) from (select jsonb_array_elements_text(coalesce(p_data->'genres', '[]')) g limit 5) x), '[]'),
    'platform', coalesce(nullif(left(p_data->>'platform', 30), ''), 'Jinde'),
    'img', case when img ~ '^https?://' then left(img, 500) else null end,
    'addedBy', n, 'ts', tl_now());
  insert into tl_titles values (t->>'id', t, tl_now());
  perform tl_bump();
  return t::json;
end $$;

create or replace function tl_list(p_name text, p_token text, p_title_id text, p_status text) returns json
language plpgsql security definer set search_path = public as $$
declare n text := tl_auth(p_name, p_token);
begin
  if p_status in ('want', 'seen') then
    insert into tl_lists values (n, left(p_title_id, 120), p_status, tl_now())
    on conflict ("user", title_id) do update set status = excluded.status, ts = excluded.ts;
  else
    delete from tl_lists where "user" = n and title_id = p_title_id;
  end if;
  perform tl_bump();
  return json_build_object('ok', true);
end $$;

-- web smí volat jen tyhle funkce
revoke all on all tables in schema public from anon, authenticated;
revoke execute on function tl_now(), tl_bump(), tl_auth(text, text) from public, anon, authenticated;
grant execute on function tl_version(), tl_state(), tl_register(text, text), tl_review(text, text, text, int, text),
  tl_review_delete(text, text, text), tl_review_like(text, text, text), tl_title_add(text, text, jsonb),
  tl_list(text, text, text, text) to anon;
