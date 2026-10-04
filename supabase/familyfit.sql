-- =====================================================================
-- 42world 패밀리핏: 가족 방 / 구성원 / 리포트
--
-- 설계 원칙
--  * 로그인(인증) 없음. 이메일은 연락용으로만 저장하며 검증하지 않습니다.
--  * 접근 권한은 "추측할 수 없는 긴 토큰"이 대신합니다.
--      host_token   : 호스트 대시보드와 리포트 열람/생성
--      member token : 구성원 한 사람의 결과 제출
--  * 테이블은 RLS로 잠가 두고(정책 없음), 브라우저는 아래 RPC 함수로만 접근합니다.
--  * 리포트 생성용 함수 2개는 service_role(Edge Function)만 호출할 수 있습니다.
--
-- 실행: Supabase 대시보드 > SQL Editor 에 전체를 붙여 넣고 Run (여러 번 실행해도 안전)
-- =====================================================================

create table if not exists public.ff_rooms (
  id          uuid primary key default gen_random_uuid(),
  host_token  text not null unique,
  email       text not null,
  family_name text not null,
  consent_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create table if not exists public.ff_members (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.ff_rooms(id) on delete cascade,
  token        text not null unique,
  nickname     text not null,
  counts       int[],
  winner       text,
  tie_note     text,
  submitted_at timestamptz,
  created_at   timestamptz not null default clock_timestamp(),   -- 등록 순서를 보존
  unique (room_id, nickname)
);

create table if not exists public.ff_reports (
  room_id    uuid primary key references public.ff_rooms(id) on delete cascade,
  input_hash text not null,
  content    jsonb not null,
  gen_count  int not null default 1,
  updated_at timestamptz not null default now()
);

create index if not exists ff_members_room_idx on public.ff_members(room_id);
create index if not exists ff_rooms_email_idx on public.ff_rooms(lower(email), created_at);

-- RLS: 켜 두고 정책을 만들지 않으면 anon/authenticated 는 테이블을 직접 읽거나 쓸 수 없습니다.
alter table public.ff_rooms   enable row level security;
alter table public.ff_members enable row level security;
alter table public.ff_reports enable row level security;
revoke all on public.ff_rooms, public.ff_members, public.ff_reports from anon, authenticated;

-- ---------------------------------------------------------------------
-- 내부 도우미
-- ---------------------------------------------------------------------
create or replace function public.ff_new_token() returns text
language sql volatile
as $$ select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') $$;

-- 제출된 결과가 바뀌면 값이 바뀌는 지문. 리포트가 최신 데이터 기준인지 판단할 때 씁니다.
create or replace function public.ff_input_hash(p_room uuid) returns text
language sql stable
as $$
  select coalesce(md5(string_agg(m.nickname || ':' || array_to_string(m.counts, ',') || ':' || coalesce(m.winner, ''),
                                 '|' order by m.nickname)), 'empty')
  from public.ff_members m
  where m.room_id = p_room and m.submitted_at is not null
$$;

-- ---------------------------------------------------------------------
-- 호스트: 방 만들기 (이메일 + 구성원 이름들)
-- ---------------------------------------------------------------------
create or replace function public.ff_create_room(p_email text, p_family text, p_members text[])
returns json
language plpgsql security definer set search_path = public
as $$
declare
  v_room uuid;
  v_host text;
  v_names text[] := '{}';
  v_name text;
  v_out json;
begin
  p_email  := lower(btrim(coalesce(p_email, '')));
  p_family := btrim(coalesce(p_family, ''));

  if p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(p_email) > 120 then
    raise exception 'invalid_email';
  end if;
  if length(p_family) < 1 or length(p_family) > 12 then
    raise exception 'invalid_family';
  end if;

  foreach v_name in array coalesce(p_members, '{}') loop
    v_name := btrim(regexp_replace(v_name, '[[:cntrl:]<>]', '', 'g'));
    if length(v_name) between 1 and 8 and not (v_name = any(v_names)) then
      v_names := v_names || v_name;
    end if;
  end loop;
  if array_length(v_names, 1) is null or array_length(v_names, 1) < 2 or array_length(v_names, 1) > 8 then
    raise exception 'invalid_members';
  end if;

  -- 남용 방지: 같은 이메일로 하루 5개까지
  if (select count(*) from ff_rooms where lower(email) = p_email and created_at > now() - interval '1 day') >= 5 then
    raise exception 'too_many_rooms';
  end if;

  v_host := ff_new_token();
  insert into ff_rooms(host_token, email, family_name) values (v_host, p_email, p_family) returning id into v_room;
  foreach v_name in array v_names loop
    insert into ff_members(room_id, token, nickname) values (v_room, ff_new_token(), v_name);
  end loop;

  select json_build_object(
    'host_token', v_host,
    'family', p_family,
    'members', (select json_agg(json_build_object('nickname', nickname, 'token', token) order by created_at, nickname)
                from ff_members where room_id = v_room)
  ) into v_out;
  return v_out;
end $$;

-- 호스트: 이메일로 내 방 찾기 (테스트 기간 한정 / 인증 없음)
--  ※ 이메일을 아는 사람은 누구나 그 이메일의 방(호스트 열쇠)을 열 수 있습니다.
--    정식 운영 전에는 이 함수의 권한을 거두고(아래 revoke 한 줄) 메일 링크 방식으로 바꾸세요:
--    revoke execute on function public.ff_rooms_by_email(text) from anon, authenticated;
create or replace function public.ff_rooms_by_email(p_email text) returns json
language plpgsql stable security definer set search_path = public
as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 120 then raise exception 'invalid_email'; end if;
  return coalesce((
    select json_agg(x order by x.created_at desc)
    from (select r.host_token, r.family_name as family, r.created_at,
                 (select count(*) from ff_members m where m.room_id = r.id) as total,
                 (select count(*) from ff_members m where m.room_id = r.id and m.submitted_at is not null) as done
          from ff_rooms r where lower(r.email) = v_email order by r.created_at desc limit 10) x
  ), '[]'::json);
end $$;

-- 호스트: 구성원 추가 (최대 8명)
create or replace function public.ff_add_member(p_host text, p_nickname text) returns json
language plpgsql security definer set search_path = public
as $$
declare v_room uuid; v_name text; v_tok text;
begin
  select id into v_room from ff_rooms where host_token = p_host;
  if v_room is null then raise exception 'not_found'; end if;
  v_name := btrim(regexp_replace(coalesce(p_nickname, ''), '[[:cntrl:]<>]', '', 'g'));
  if length(v_name) not between 1 and 8 then raise exception 'invalid_name'; end if;
  if (select count(*) from ff_members where room_id = v_room) >= 8 then raise exception 'too_many_members'; end if;
  if exists (select 1 from ff_members where room_id = v_room and nickname = v_name) then raise exception 'duplicate_name'; end if;
  v_tok := ff_new_token();
  insert into ff_members(room_id, token, nickname) values (v_room, v_tok, v_name);
  return json_build_object('nickname', v_name, 'token', v_tok);
end $$;

-- 호스트: 구성원 빼기 (최소 2명은 남겨 둠)
create or replace function public.ff_remove_member(p_host text, p_member_token text) returns void
language plpgsql security definer set search_path = public
as $$
declare v_room uuid;
begin
  select id into v_room from ff_rooms where host_token = p_host;
  if v_room is null then raise exception 'not_found'; end if;
  if (select count(*) from ff_members where room_id = v_room) <= 2 then raise exception 'min_members'; end if;
  delete from ff_members where room_id = v_room and token = p_member_token;
end $$;

-- 호스트: 대시보드 (진행 현황 + 결과)
create or replace function public.ff_dashboard(p_host text) returns json
language plpgsql stable security definer set search_path = public
as $$
declare v_room ff_rooms; v_out json;
begin
  select * into v_room from ff_rooms where host_token = p_host;
  if v_room.id is null then raise exception 'not_found'; end if;
  select json_build_object(
    'family', v_room.family_name,
    'created_at', v_room.created_at,
    'data_hash', ff_input_hash(v_room.id),
    'members', (select coalesce(json_agg(json_build_object(
                  'nickname', m.nickname, 'token', m.token, 'submitted', m.submitted_at is not null,
                  'submitted_at', m.submitted_at, 'counts', m.counts, 'winner', m.winner, 'tie', m.tie_note)
                  order by m.created_at, m.nickname), '[]'::json)
                from ff_members m where m.room_id = v_room.id),
    'report', (select json_build_object('input_hash', r.input_hash, 'updated_at', r.updated_at, 'gen_count', r.gen_count)
               from ff_reports r where r.room_id = v_room.id)
  ) into v_out;
  return v_out;
end $$;

-- 호스트: 저장된 리포트 문구 읽기
create or replace function public.ff_get_report(p_host text) returns json
language plpgsql stable security definer set search_path = public
as $$
declare v_room uuid; v_out json;
begin
  select id into v_room from ff_rooms where host_token = p_host;
  if v_room is null then raise exception 'not_found'; end if;
  select json_build_object('content', r.content, 'input_hash', r.input_hash, 'updated_at', r.updated_at)
    into v_out from ff_reports r where r.room_id = v_room;
  return v_out;   -- 없으면 null
end $$;

-- ---------------------------------------------------------------------
-- 구성원: 자기 링크 정보 / 결과 제출
-- ---------------------------------------------------------------------
create or replace function public.ff_get_member(p_token text) returns json
language plpgsql stable security definer set search_path = public
as $$
declare v_out json;
begin
  select json_build_object('family', r.family_name, 'nickname', m.nickname,
                           'submitted', m.submitted_at is not null, 'winner', m.winner)
    into v_out
  from ff_members m join ff_rooms r on r.id = m.room_id where m.token = p_token;
  if v_out is null then raise exception 'not_found'; end if;
  return v_out;
end $$;

create or replace function public.ff_submit(p_token text, p_counts int[], p_winner text, p_tie text default null)
returns json
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; i int;
begin
  select id into v_id from ff_members where token = p_token;
  if v_id is null then raise exception 'not_found'; end if;
  if p_counts is null or array_length(p_counts, 1) is distinct from 4 then raise exception 'invalid_counts'; end if;
  for i in 1..4 loop
    if p_counts[i] is null or p_counts[i] < 0 or p_counts[i] > 6 then raise exception 'invalid_counts'; end if;
  end loop;
  if (p_counts[1] + p_counts[2] + p_counts[3] + p_counts[4]) <> 12 then raise exception 'invalid_counts'; end if;
  if p_winner is null or p_winner !~ '^[PSFT]$' then raise exception 'invalid_winner'; end if;
  update ff_members
     set counts = p_counts, winner = p_winner, tie_note = left(p_tie, 40), submitted_at = now()
   where id = v_id;
  return json_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------
-- Edge Function(service_role) 전용: 리포트 입력 읽기 / 저장
-- ---------------------------------------------------------------------
create or replace function public.ff_report_input(p_host text) returns json
language plpgsql stable security definer set search_path = public
as $$
declare v_room ff_rooms; v_out json;
begin
  select * into v_room from ff_rooms where host_token = p_host;
  if v_room.id is null then raise exception 'not_found'; end if;
  select json_build_object(
    'room_id', v_room.id,
    'family', v_room.family_name,
    'hash', ff_input_hash(v_room.id),
    'gen_count', coalesce((select gen_count from ff_reports where room_id = v_room.id), 0),
    'existing_hash', (select input_hash from ff_reports where room_id = v_room.id),
    'members', (select coalesce(json_agg(json_build_object('nickname', nickname, 'counts', counts, 'winner', winner, 'tie', tie_note)
                  order by created_at, nickname), '[]'::json)
                from ff_members where room_id = v_room.id and submitted_at is not null)
  ) into v_out;
  return v_out;
end $$;

create or replace function public.ff_save_report(p_room uuid, p_hash text, p_content jsonb) returns void
language sql security definer set search_path = public
as $$
  insert into ff_reports(room_id, input_hash, content, gen_count, updated_at)
  values (p_room, p_hash, p_content, 1, now())
  on conflict (room_id) do update
    set input_hash = excluded.input_hash, content = excluded.content,
        gen_count = ff_reports.gen_count + 1, updated_at = now()
$$;

-- ---------------------------------------------------------------------
-- 권한: 함수는 기본적으로 모두 실행 가능이므로 먼저 거두고 필요한 곳에만 엽니다.
-- ---------------------------------------------------------------------
revoke execute on function
  public.ff_new_token(),
  public.ff_input_hash(uuid),
  public.ff_create_room(text, text, text[]),
  public.ff_add_member(text, text),
  public.ff_remove_member(text, text),
  public.ff_dashboard(text),
  public.ff_get_report(text),
  public.ff_get_member(text),
  public.ff_submit(text, int[], text, text),
  public.ff_rooms_by_email(text),
  public.ff_report_input(text),
  public.ff_save_report(uuid, text, jsonb)
from public, anon, authenticated;

grant execute on function
  public.ff_create_room(text, text, text[]),
  public.ff_add_member(text, text),
  public.ff_remove_member(text, text),
  public.ff_dashboard(text),
  public.ff_get_report(text),
  public.ff_get_member(text),
  public.ff_submit(text, int[], text, text),
  public.ff_rooms_by_email(text)
to anon, authenticated;

grant execute on function
  public.ff_report_input(text),
  public.ff_save_report(uuid, text, jsonb)
to service_role;
