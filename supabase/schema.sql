-- BLACK RUSSIA Survival Game v2
-- Static frontend + Supabase RPC backend.
-- Run this whole file in Supabase SQL Editor.
-- Host code: JohnWick123

create extension if not exists pgcrypto;

create table if not exists public.br_games (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Игра на выживание',
  invite_code text not null unique,
  status text not null default 'waiting' check (status in ('waiting', 'running', 'finished')),
  current_round_index integer not null default -1,
  lives_per_player integer not null default 3 check (lives_per_player between 1 and 10),
  round_started_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.br_rounds (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.br_games(id) on delete cascade,
  round_order integer not null,
  type text not null default 'quiz' check (type in ('quiz', 'fast', 'double', 'immunity', 'trap', 'sudden', 'reflex', 'memory')),
  title text not null default 'Раунд',
  question_text text not null,
  option_a text not null default 'A',
  option_b text not null default 'B',
  option_c text not null default 'C',
  option_d text not null default 'D',
  correct_option text not null check (upper(correct_option) in ('A', 'B', 'C', 'D')),
  time_limit_seconds integer not null default 15 check (time_limit_seconds between 5 and 300),
  score_value integer not null default 1 check (score_value between 0 and 20),
  penalty_lives integer not null default 1 check (penalty_lives between 0 and 99),
  created_at timestamptz not null default now(),
  unique (game_id, round_order)
);

create table if not exists public.br_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.br_games(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 32),
  lives integer not null default 3,
  score integer not null default 0,
  shield_count integer not null default 0,
  eliminated boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.br_answers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.br_games(id) on delete cascade,
  player_id uuid not null references public.br_players(id) on delete cascade,
  round_id uuid not null references public.br_rounds(id) on delete cascade,
  answer text not null,
  is_correct boolean not null default false,
  score_delta integer not null default 0,
  lives_delta integer not null default 0,
  used_shield boolean not null default false,
  created_at timestamptz not null default now(),
  unique (player_id, round_id)
);

create index if not exists br_games_invite_code_idx on public.br_games (upper(invite_code));
create index if not exists br_rounds_game_order_idx on public.br_rounds (game_id, round_order);
create index if not exists br_players_game_idx on public.br_players (game_id);
create unique index if not exists br_players_unique_name_idx on public.br_players (game_id, lower(trim(name)));
create index if not exists br_answers_game_round_idx on public.br_answers (game_id, round_id);

alter table public.br_games enable row level security;
alter table public.br_rounds enable row level security;
alter table public.br_players enable row level security;
alter table public.br_answers enable row level security;

-- No direct table access is required; everything goes through security definer RPC.
drop policy if exists "br_games_no_direct" on public.br_games;
drop policy if exists "br_rounds_no_direct" on public.br_rounds;
drop policy if exists "br_players_no_direct" on public.br_players;
drop policy if exists "br_answers_no_direct" on public.br_answers;

create or replace function public.br_assert_host_code(p_host_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_host_code, '') <> 'JohnWick123' then
    raise exception 'Неверный код ведущего' using errcode = '28000';
  end if;
end;
$$;

create or replace function public.br_host_list_games(p_host_code text)
returns table (
  id uuid,
  title text,
  invite_code text,
  status text,
  current_round_index integer,
  lives_per_player integer,
  round_started_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.br_assert_host_code(p_host_code);

  return query
  select g.id, g.title, g.invite_code, g.status, g.current_round_index, g.lives_per_player, g.round_started_at, g.created_at
  from public.br_games g
  order by g.created_at desc;
end;
$$;

create or replace function public.br_host_create_game(
  p_host_code text,
  p_title text,
  p_invite_code text,
  p_lives_per_player integer,
  p_rounds jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id uuid;
  v_item jsonb;
  v_index integer := 0;
  v_type text;
  v_correct text;
  v_round_order integer;
  v_time integer;
  v_score integer;
  v_penalty integer;
begin
  perform public.br_assert_host_code(p_host_code);

  if p_rounds is null or jsonb_typeof(p_rounds) <> 'array' or jsonb_array_length(p_rounds) = 0 then
    raise exception 'Добавьте хотя бы один раунд';
  end if;

  insert into public.br_games (title, invite_code, lives_per_player)
  values (
    coalesce(nullif(trim(p_title), ''), 'Игра на выживание'),
    upper(trim(p_invite_code)),
    greatest(1, least(coalesce(p_lives_per_player, 3), 10))
  )
  returning id into v_game_id;

  for v_item in select value from jsonb_array_elements(p_rounds) loop
    v_type := lower(coalesce(nullif(trim(v_item->>'type'), ''), 'quiz'));
    v_correct := upper(trim(coalesce(v_item->>'correct_option', '')));
    v_round_order := coalesce(nullif(v_item->>'round_order', '')::integer, v_index);
    v_time := greatest(5, least(coalesce(nullif(v_item->>'time_limit_seconds', '')::integer, 15), 300));
    v_score := greatest(0, least(coalesce(nullif(v_item->>'score_value', '')::integer, 1), 20));
    v_penalty := greatest(0, least(coalesce(nullif(v_item->>'penalty_lives', '')::integer, 1), 99));

    if v_type not in ('quiz', 'fast', 'double', 'immunity', 'trap', 'sudden', 'reflex', 'memory') then
      raise exception 'Некорректный тип раунда №%: %', v_index + 1, v_type;
    end if;
    if v_correct not in ('A', 'B', 'C', 'D') then
      raise exception 'Некорректный correct_option в раунде №%', v_index + 1;
    end if;
    if coalesce(trim(v_item->>'question_text'), '') = '' then
      raise exception 'Пустой текст вопроса в раунде №%', v_index + 1;
    end if;

    insert into public.br_rounds (
      game_id, round_order, type, title, question_text,
      option_a, option_b, option_c, option_d,
      correct_option, time_limit_seconds, score_value, penalty_lives
    )
    values (
      v_game_id,
      v_round_order,
      v_type,
      coalesce(nullif(trim(v_item->>'title'), ''), 'Раунд ' || (v_index + 1)),
      trim(v_item->>'question_text'),
      coalesce(nullif(trim(v_item->>'option_a'), ''), 'A'),
      coalesce(nullif(trim(v_item->>'option_b'), ''), 'B'),
      coalesce(nullif(trim(v_item->>'option_c'), ''), 'C'),
      coalesce(nullif(trim(v_item->>'option_d'), ''), 'D'),
      v_correct,
      v_time,
      v_score,
      v_penalty
    );

    v_index := v_index + 1;
  end loop;

  return (
    select to_jsonb(g)
    from public.br_games g
    where g.id = v_game_id
  );
end;
$$;

create or replace function public.br_public_game_state(p_invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.br_games%rowtype;
  v_current public.br_rounds%rowtype;
  v_current_json jsonb := null;
  v_players jsonb := '[]'::jsonb;
  v_answered jsonb := '[]'::jsonb;
  v_answers_count integer := 0;
begin
  select * into v_game
  from public.br_games
  where upper(invite_code) = upper(trim(p_invite_code))
  limit 1;

  if not found then
    raise exception 'Игра не найдена';
  end if;

  if v_game.current_round_index >= 0 then
    select * into v_current
    from public.br_rounds
    where game_id = v_game.id and round_order = v_game.current_round_index
    limit 1;

    if found then
      select jsonb_build_object(
        'id', v_current.id,
        'game_id', v_current.game_id,
        'round_order', v_current.round_order,
        'type', v_current.type,
        'title', v_current.title,
        'question_text', v_current.question_text,
        'option_a', v_current.option_a,
        'option_b', v_current.option_b,
        'option_c', v_current.option_c,
        'option_d', v_current.option_d,
        'time_limit_seconds', v_current.time_limit_seconds,
        'score_value', v_current.score_value,
        'penalty_lives', v_current.penalty_lives,
        'server_now', now(),
        'started_at', v_game.round_started_at,
        'ends_at', case when v_game.round_started_at is null then null else v_game.round_started_at + make_interval(secs => v_current.time_limit_seconds) end
      ) into v_current_json;

      select coalesce(jsonb_agg(player_id), '[]'::jsonb), count(*)
      into v_answered, v_answers_count
      from public.br_answers
      where game_id = v_game.id and round_id = v_current.id;
    end if;
  end if;

  select coalesce(jsonb_agg(to_jsonb(p) order by (p.eliminated)::int, p.score desc, p.lives desc, p.joined_at asc), '[]'::jsonb)
  into v_players
  from (
    select id, game_id, name, lives, score, shield_count, eliminated, joined_at, last_seen_at
    from public.br_players
    where game_id = v_game.id
  ) p;

  return jsonb_build_object(
    'game', jsonb_build_object(
      'id', v_game.id,
      'title', v_game.title,
      'invite_code', v_game.invite_code,
      'status', v_game.status,
      'current_round_index', v_game.current_round_index,
      'lives_per_player', v_game.lives_per_player,
      'round_started_at', v_game.round_started_at,
      'created_at', v_game.created_at,
      'server_now', now()
    ),
    'current_round', v_current_json,
    'players', v_players,
    'answered_player_ids', v_answered,
    'answers_count', v_answers_count
  );
end;
$$;

create or replace function public.br_host_game_state(p_host_code text, p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.br_games%rowtype;
  v_rounds jsonb := '[]'::jsonb;
  v_players jsonb := '[]'::jsonb;
  v_answers jsonb := '[]'::jsonb;
begin
  perform public.br_assert_host_code(p_host_code);

  select * into v_game from public.br_games where id = p_game_id;
  if not found then
    raise exception 'Игра не найдена';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.round_order), '[]'::jsonb)
  into v_rounds
  from public.br_rounds r
  where r.game_id = p_game_id;

  select coalesce(jsonb_agg(to_jsonb(p) order by (p.eliminated)::int, p.score desc, p.lives desc, p.joined_at asc), '[]'::jsonb)
  into v_players
  from public.br_players p
  where p.game_id = p_game_id;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_answers
  from public.br_answers a
  where a.game_id = p_game_id;

  return jsonb_build_object(
    'game', to_jsonb(v_game),
    'rounds', v_rounds,
    'players', v_players,
    'answers', v_answers,
    'server_now', now()
  );
end;
$$;

create or replace function public.br_join_game(p_invite_code text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.br_games%rowtype;
  v_player public.br_players%rowtype;
  v_name text := trim(p_name);
begin
  if char_length(v_name) < 2 or char_length(v_name) > 32 then
    raise exception 'Ник должен быть от 2 до 32 символов';
  end if;

  select * into v_game
  from public.br_games
  where upper(invite_code) = upper(trim(p_invite_code))
  limit 1;

  if not found then
    raise exception 'Игра не найдена';
  end if;

  if v_game.status = 'finished' then
    raise exception 'Игра уже завершена';
  end if;

  select * into v_player
  from public.br_players
  where game_id = v_game.id and lower(trim(name)) = lower(v_name)
  limit 1;

  if found then
    update public.br_players
    set last_seen_at = now()
    where id = v_player.id
    returning * into v_player;
  else
    insert into public.br_players (game_id, name, lives)
    values (v_game.id, v_name, v_game.lives_per_player)
    returning * into v_player;
  end if;

  return to_jsonb(v_player);
end;
$$;

create or replace function public.br_submit_answer(
  p_invite_code text,
  p_player_id uuid,
  p_round_id uuid,
  p_answer text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.br_games%rowtype;
  v_round public.br_rounds%rowtype;
  v_player public.br_players%rowtype;
  v_answer text := upper(trim(p_answer));
  v_is_correct boolean := false;
  v_score_delta integer := 0;
  v_lives_delta integer := 0;
  v_used_shield boolean := false;
  v_gained_shield boolean := false;
  v_new_lives integer;
  v_new_shield integer;
  v_existing uuid;
  v_answer_row public.br_answers%rowtype;
begin
  if v_answer not in ('A', 'B', 'C', 'D') then
    raise exception 'Некорректный ответ';
  end if;

  select * into v_game
  from public.br_games
  where upper(invite_code) = upper(trim(p_invite_code))
  limit 1;

  if not found then
    raise exception 'Игра не найдена';
  end if;

  if v_game.status <> 'running' then
    raise exception 'Раунд сейчас не активен';
  end if;

  select * into v_round
  from public.br_rounds
  where id = p_round_id and game_id = v_game.id and round_order = v_game.current_round_index
  limit 1;

  if not found then
    raise exception 'Это не текущий раунд';
  end if;

  if v_game.round_started_at is not null and now() > v_game.round_started_at + make_interval(secs => v_round.time_limit_seconds) then
    raise exception 'Время вышло';
  end if;

  select * into v_player
  from public.br_players
  where id = p_player_id and game_id = v_game.id
  limit 1;

  if not found then
    raise exception 'Игрок не найден';
  end if;

  if v_player.eliminated or v_player.lives <= 0 then
    raise exception 'Вы уже выбыли';
  end if;

  select id into v_existing
  from public.br_answers
  where player_id = p_player_id and round_id = p_round_id
  limit 1;

  if found then
    raise exception 'Вы уже ответили в этом раунде';
  end if;

  v_is_correct := v_answer = upper(v_round.correct_option);

  if v_is_correct then
    v_score_delta := v_round.score_value;
    v_lives_delta := 0;
    v_new_lives := v_player.lives;
    v_new_shield := v_player.shield_count;
    if v_round.type = 'immunity' then
      v_new_shield := v_new_shield + 1;
      v_gained_shield := true;
    end if;
  else
    v_score_delta := 0;
    if v_player.shield_count > 0 then
      v_used_shield := true;
      v_lives_delta := 0;
      v_new_lives := v_player.lives;
      v_new_shield := v_player.shield_count - 1;
    else
      v_lives_delta := -least(v_player.lives, v_round.penalty_lives);
      v_new_lives := greatest(0, v_player.lives + v_lives_delta);
      v_new_shield := v_player.shield_count;
    end if;
  end if;

  insert into public.br_answers (game_id, player_id, round_id, answer, is_correct, score_delta, lives_delta, used_shield)
  values (v_game.id, p_player_id, p_round_id, v_answer, v_is_correct, v_score_delta, v_lives_delta, v_used_shield)
  returning * into v_answer_row;

  update public.br_players
  set score = score + v_score_delta,
      lives = v_new_lives,
      shield_count = v_new_shield,
      eliminated = v_new_lives <= 0,
      last_seen_at = now()
  where id = p_player_id;

  return jsonb_build_object(
    'answer_id', v_answer_row.id,
    'is_correct', v_is_correct,
    'score_delta', v_score_delta,
    'lives_delta', v_lives_delta,
    'used_shield', v_used_shield,
    'gained_shield', v_gained_shield
  );
end;
$$;

create or replace function public.br_process_current_timeouts(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.br_games%rowtype;
  v_round public.br_rounds%rowtype;
  v_player public.br_players%rowtype;
  v_used_shield boolean;
  v_lives_delta integer;
  v_new_lives integer;
  v_new_shield integer;
begin
  select * into v_game from public.br_games where id = p_game_id;
  if not found or v_game.status <> 'running' or v_game.current_round_index < 0 then
    return;
  end if;

  select * into v_round
  from public.br_rounds
  where game_id = p_game_id and round_order = v_game.current_round_index
  limit 1;

  if not found then
    return;
  end if;

  for v_player in
    select * from public.br_players p
    where p.game_id = p_game_id
      and p.eliminated = false
      and p.lives > 0
      and not exists (
        select 1 from public.br_answers a
        where a.player_id = p.id and a.round_id = v_round.id
      )
  loop
    if v_player.shield_count > 0 then
      v_used_shield := true;
      v_lives_delta := 0;
      v_new_lives := v_player.lives;
      v_new_shield := v_player.shield_count - 1;
    else
      v_used_shield := false;
      v_lives_delta := -least(v_player.lives, v_round.penalty_lives);
      v_new_lives := greatest(0, v_player.lives + v_lives_delta);
      v_new_shield := v_player.shield_count;
    end if;

    insert into public.br_answers (game_id, player_id, round_id, answer, is_correct, score_delta, lives_delta, used_shield)
    values (p_game_id, v_player.id, v_round.id, 'TIMEOUT', false, 0, v_lives_delta, v_used_shield)
    on conflict (player_id, round_id) do nothing;

    update public.br_players
    set lives = v_new_lives,
        shield_count = v_new_shield,
        eliminated = v_new_lives <= 0,
        last_seen_at = now()
    where id = v_player.id;
  end loop;
end;
$$;

create or replace function public.br_host_start_game(p_host_code text, p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round_count integer;
  v_exists uuid;
begin
  perform public.br_assert_host_code(p_host_code);

  select id into v_exists from public.br_games where id = p_game_id;
  if not found then
    raise exception 'Игра не найдена';
  end if;

  select count(*) into v_round_count from public.br_rounds where game_id = p_game_id;
  if v_round_count = 0 then
    raise exception 'В игре нет раундов';
  end if;

  update public.br_games
  set status = 'running',
      current_round_index = 0,
      round_started_at = now(),
      updated_at = now()
  where id = p_game_id;

  update public.br_players
  set lives = (select lives_per_player from public.br_games where id = p_game_id),
      score = 0,
      shield_count = 0,
      eliminated = false,
      last_seen_at = now()
  where game_id = p_game_id;

  delete from public.br_answers where game_id = p_game_id;

  return public.br_host_game_state(p_host_code, p_game_id);
end;
$$;

create or replace function public.br_host_next_round(p_host_code text, p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.br_games%rowtype;
  v_next integer;
  v_round_count integer;
  v_alive integer;
begin
  perform public.br_assert_host_code(p_host_code);

  select * into v_game from public.br_games where id = p_game_id;
  if not found then
    raise exception 'Игра не найдена';
  end if;
  if v_game.status <> 'running' then
    raise exception 'Игра сейчас не запущена';
  end if;

  perform public.br_process_current_timeouts(p_game_id);

  select count(*) into v_alive from public.br_players where game_id = p_game_id and eliminated = false and lives > 0;
  select count(*) into v_round_count from public.br_rounds where game_id = p_game_id;

  if v_alive <= 1 or v_game.current_round_index + 1 >= v_round_count then
    update public.br_games
    set status = 'finished', updated_at = now()
    where id = p_game_id;
  else
    v_next := v_game.current_round_index + 1;
    update public.br_games
    set current_round_index = v_next,
        round_started_at = now(),
        updated_at = now()
    where id = p_game_id;
  end if;

  return public.br_host_game_state(p_host_code, p_game_id);
end;
$$;

create or replace function public.br_host_finish_game(p_host_code text, p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.br_assert_host_code(p_host_code);
  perform public.br_process_current_timeouts(p_game_id);

  update public.br_games
  set status = 'finished', updated_at = now()
  where id = p_game_id;

  if not found then
    raise exception 'Игра не найдена';
  end if;

  return public.br_host_game_state(p_host_code, p_game_id);
end;
$$;

create or replace function public.br_host_reset_game(p_host_code text, p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.br_assert_host_code(p_host_code);

  delete from public.br_answers where game_id = p_game_id;

  update public.br_players
  set lives = (select lives_per_player from public.br_games where id = p_game_id),
      score = 0,
      shield_count = 0,
      eliminated = false,
      last_seen_at = now()
  where game_id = p_game_id;

  update public.br_games
  set status = 'waiting',
      current_round_index = -1,
      round_started_at = null,
      updated_at = now()
  where id = p_game_id;

  if not found then
    raise exception 'Игра не найдена';
  end if;

  return public.br_host_game_state(p_host_code, p_game_id);
end;
$$;

create or replace function public.br_host_delete_game(p_host_code text, p_game_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.br_assert_host_code(p_host_code);
  delete from public.br_games where id = p_game_id;
  if not found then
    raise exception 'Игра не найдена';
  end if;
  return true;
end;
$$;

grant execute on function public.br_host_list_games(text) to anon, authenticated;
grant execute on function public.br_host_create_game(text, text, text, integer, jsonb) to anon, authenticated;
grant execute on function public.br_host_game_state(text, uuid) to anon, authenticated;
grant execute on function public.br_join_game(text, text) to anon, authenticated;
grant execute on function public.br_public_game_state(text) to anon, authenticated;
grant execute on function public.br_submit_answer(text, uuid, uuid, text) to anon, authenticated;
grant execute on function public.br_host_start_game(text, uuid) to anon, authenticated;
grant execute on function public.br_host_next_round(text, uuid) to anon, authenticated;
grant execute on function public.br_host_finish_game(text, uuid) to anon, authenticated;
grant execute on function public.br_host_reset_game(text, uuid) to anon, authenticated;
grant execute on function public.br_host_delete_game(text, uuid) to anon, authenticated;
