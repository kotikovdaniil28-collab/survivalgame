-- BLACK RUSSIA survival browser game schema
-- Run this file once in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'Игра на выживание',
  invite_code text not null unique,
  status text not null default 'waiting' check (status in ('waiting', 'running', 'finished')),
  current_question_index integer not null default -1,
  lives_per_player integer not null default 3 check (lives_per_player between 1 and 10),
  owner_id uuid not null,
  owner_email text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  question_order integer not null,
  type text not null default 'quiz',
  question_text text not null,
  option_a text not null,
  option_b text not null,
  option_c text not null,
  option_d text not null,
  correct_option text not null check (upper(correct_option) in ('A', 'B', 'C', 'D')),
  time_limit_seconds integer not null default 25 check (time_limit_seconds between 5 and 300),
  created_at timestamptz not null default now(),
  unique (game_id, question_order)
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 32),
  lives integer not null default 3,
  score integer not null default 0,
  eliminated boolean not null default false,
  joined_at timestamptz not null default now()
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  answer text not null check (upper(answer) in ('A', 'B', 'C', 'D')),
  is_correct boolean not null,
  created_at timestamptz not null default now(),
  unique (player_id, question_id)
);

create index if not exists games_invite_code_idx on public.games(invite_code);
create index if not exists questions_game_order_idx on public.questions(game_id, question_order);
create index if not exists players_game_idx on public.players(game_id);
create index if not exists answers_game_question_idx on public.answers(game_id, question_id);

alter table public.games enable row level security;
alter table public.questions enable row level security;
alter table public.players enable row level security;
alter table public.answers enable row level security;

-- Clean old policies if rerunning the script.
drop policy if exists "owner can manage own games" on public.games;
drop policy if exists "owner can manage own questions" on public.questions;
drop policy if exists "everyone can read players" on public.players;
drop policy if exists "owner can delete players" on public.players;
drop policy if exists "everyone can read answers" on public.answers;
drop policy if exists "owner can delete answers" on public.answers;

-- Only this Supabase Auth account can create/manage games.
create policy "owner can manage own games"
on public.games
for all
to authenticated
using (
  owner_id = auth.uid()
  and lower(owner_email) = 'daniiltimosin72@gmail.com'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'daniiltimosin72@gmail.com'
)
with check (
  owner_id = auth.uid()
  and lower(owner_email) = 'daniiltimosin72@gmail.com'
  and lower(coalesce(auth.jwt() ->> 'email', '')) = 'daniiltimosin72@gmail.com'
);

create policy "owner can manage own questions"
on public.questions
for all
to authenticated
using (
  exists (
    select 1 from public.games g
    where g.id = questions.game_id
      and g.owner_id = auth.uid()
      and lower(g.owner_email) = 'daniiltimosin72@gmail.com'
      and lower(coalesce(auth.jwt() ->> 'email', '')) = 'daniiltimosin72@gmail.com'
  )
)
with check (
  exists (
    select 1 from public.games g
    where g.id = questions.game_id
      and g.owner_id = auth.uid()
      and lower(g.owner_email) = 'daniiltimosin72@gmail.com'
      and lower(coalesce(auth.jwt() ->> 'email', '')) = 'daniiltimosin72@gmail.com'
  )
);

-- Players are public for leaderboard/lobby display. Joining happens through join_game().
create policy "everyone can read players"
on public.players
for select
to anon, authenticated
using (true);

create policy "owner can delete players"
on public.players
for delete
to authenticated
using (
  exists (
    select 1 from public.games g
    where g.id = players.game_id
      and g.owner_id = auth.uid()
      and lower(coalesce(auth.jwt() ->> 'email', '')) = 'daniiltimosin72@gmail.com'
  )
);

-- Answers are readable so the player UI can know whether the user already answered.
-- They do NOT expose correct answers; correct answers are only in questions table.
create policy "everyone can read answers"
on public.answers
for select
to anon, authenticated
using (true);

create policy "owner can delete answers"
on public.answers
for delete
to authenticated
using (
  exists (
    select 1 from public.games g
    where g.id = answers.game_id
      and g.owner_id = auth.uid()
      and lower(coalesce(auth.jwt() ->> 'email', '')) = 'daniiltimosin72@gmail.com'
  )
);

-- Public player view without correct_option.
drop view if exists public.player_questions;
create view public.player_questions as
select
  id,
  game_id,
  question_order,
  type,
  question_text,
  option_a,
  option_b,
  option_c,
  option_d,
  time_limit_seconds
from public.questions;

create or replace function public.get_game_by_code(p_invite_code text)
returns table (
  id uuid,
  title text,
  invite_code text,
  status text,
  current_question_index integer,
  lives_per_player integer,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select g.id, g.title, g.invite_code, g.status, g.current_question_index, g.lives_per_player, g.created_at
  from public.games g
  where upper(g.invite_code) = upper(trim(p_invite_code))
  limit 1;
$$;

create or replace function public.join_game(p_invite_code text, p_name text)
returns table (
  id uuid,
  game_id uuid,
  name text,
  lives integer,
  score integer,
  eliminated boolean,
  joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game public.games%rowtype;
  v_name text;
begin
  v_name := left(trim(p_name), 32);
  if char_length(v_name) < 2 then
    raise exception 'Введите ник минимум из 2 символов';
  end if;

  select * into v_game
  from public.games
  where upper(invite_code) = upper(trim(p_invite_code))
  limit 1;

  if not found then
    raise exception 'Игра не найдена';
  end if;

  if v_game.status = 'finished' then
    raise exception 'Игра уже завершена';
  end if;

  return query
  insert into public.players (game_id, name, lives, score, eliminated)
  values (v_game.id, v_name, v_game.lives_per_player, 0, false)
  returning players.id, players.game_id, players.name, players.lives, players.score, players.eliminated, players.joined_at;
end;
$$;

create or replace function public.submit_answer(p_player_id uuid, p_question_id uuid, p_answer text)
returns table (
  correct boolean,
  lives integer,
  score integer,
  eliminated boolean,
  already_answered boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player public.players%rowtype;
  v_question public.questions%rowtype;
  v_game public.games%rowtype;
  v_answer text;
  v_correct boolean;
  v_existing public.answers%rowtype;
begin
  v_answer := upper(trim(p_answer));
  if v_answer not in ('A', 'B', 'C', 'D') then
    raise exception 'Некорректный вариант ответа';
  end if;

  select * into v_player from public.players where id = p_player_id;
  if not found then
    raise exception 'Игрок не найден';
  end if;

  if v_player.eliminated then
    raise exception 'Игрок уже выбыл';
  end if;

  select * into v_question from public.questions where id = p_question_id;
  if not found then
    raise exception 'Вопрос не найден';
  end if;

  if v_question.game_id <> v_player.game_id then
    raise exception 'Вопрос не относится к игре игрока';
  end if;

  select * into v_game from public.games where id = v_player.game_id;
  if not found or v_game.status <> 'running' then
    raise exception 'Игра сейчас не запущена';
  end if;

  if v_question.question_order <> v_game.current_question_index then
    raise exception 'Сейчас активен другой вопрос';
  end if;

  select * into v_existing
  from public.answers
  where player_id = p_player_id and question_id = p_question_id
  limit 1;

  if found then
    return query
    select v_existing.is_correct, v_player.lives, v_player.score, v_player.eliminated, true;
    return;
  end if;

  v_correct := v_answer = upper(v_question.correct_option);

  insert into public.answers (game_id, player_id, question_id, answer, is_correct)
  values (v_player.game_id, p_player_id, p_question_id, v_answer, v_correct);

  if v_correct then
    update public.players
    set score = score + 1
    where id = p_player_id
    returning players.lives, players.score, players.eliminated
    into v_player.lives, v_player.score, v_player.eliminated;
  else
    update public.players
    set lives = greatest(lives - 1, 0),
        eliminated = case when lives - 1 <= 0 then true else eliminated end
    where id = p_player_id
    returning players.lives, players.score, players.eliminated
    into v_player.lives, v_player.score, v_player.eliminated;
  end if;

  return query
  select v_correct, v_player.lives, v_player.score, v_player.eliminated, false;
end;
$$;

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.games to authenticated;
grant select, insert, update, delete on public.questions to authenticated;
grant select, delete on public.players to anon, authenticated;
grant select, delete on public.answers to anon, authenticated;
grant select on public.player_questions to anon, authenticated;
grant execute on function public.get_game_by_code(text) to anon, authenticated;
grant execute on function public.join_game(text, text) to anon, authenticated;
grant execute on function public.submit_answer(uuid, uuid, text) to anon, authenticated;
