create table if not exists history_items (
  user_id text not null,
  source text not null,
  id text not null,
  url text not null,
  title text not null,
  author text not null default '',
  thumbnail text not null default '',
  duration_sec integer,
  saved_at timestamptz not null default now(),
  primary key (user_id, source, id)
);

create index if not exists history_items_user_saved_idx
  on history_items (user_id, saved_at desc);
