-- Optional presentation metadata for FC-style Community Build cards.
-- Existing publications remain valid because every new column is nullable.

alter table public.community_builds
  add column if not exists athlete_name text,
  add column if not exists ut_player_id bigint,
  add column if not exists ut_player_ea_id bigint,
  add column if not exists athlete_image_path text,
  add column if not exists card_rarity_id text,
  add column if not exists league_id text,
  add column if not exists club_id text,
  add column if not exists nation_id text;

alter table public.community_builds
  drop constraint if exists community_builds_build_name_length;

alter table public.community_builds
  add constraint community_builds_build_name_length
    check (char_length(build_name) between 1 and 60),
  add constraint community_builds_athlete_name
    check (
      athlete_name is null
      or (
        char_length(athlete_name) between 1 and 15
        and char_length(athlete_name)
          - char_length(replace(athlete_name, ' ', '')) <= 2
        and athlete_name !~ '[[:cntrl:]<>]'
      )
    ),
  add constraint community_builds_ut_player_id
    check (
      ut_player_id is null
      or ut_player_id between 1 and 9007199254740991
    ),
  add constraint community_builds_ut_player_ea_id
    check (
      ut_player_ea_id is null
      or ut_player_ea_id between 1 and 9007199254740991
    ),
  add constraint community_builds_athlete_image_path
    check (
      athlete_image_path is null
      or (
        char_length(athlete_image_path) between 1 and 256
        and athlete_image_path ~
          '^[A-Za-z0-9][A-Za-z0-9._/-]*\.(avif|jpeg|jpg|png|webp)$'
        and athlete_image_path !~ '(^|/)\.\.?(/|$)'
      )
    ),
  add constraint community_builds_card_rarity_id
    check (
      card_rarity_id is null
      or card_rarity_id ~ '^[1-9][0-9]{0,15}$'
    ),
  add constraint community_builds_league_id
    check (
      league_id is null
      or league_id ~ '^[1-9][0-9]{0,15}$'
    ),
  add constraint community_builds_club_id
    check (
      club_id is null
      or club_id ~ '^[1-9][0-9]{0,15}$'
    ),
  add constraint community_builds_nation_id
    check (
      nation_id is null
      or nation_id ~ '^[1-9][0-9]{0,15}$'
    ),
  add constraint community_builds_card_metadata_complete
    check (
      num_nonnulls(
        athlete_name,
        ut_player_id,
        ut_player_ea_id,
        athlete_image_path,
        card_rarity_id,
        league_id,
        club_id,
        nation_id
      ) in (0, 8)
    );

comment on column public.community_builds.athlete_name is
  'Display name printed on the generated card. Null on legacy publications.';
comment on column public.community_builds.ut_player_id is
  'FUT.GG item id selected as the card image source.';
comment on column public.community_builds.ut_player_ea_id is
  'EA item id paired with ut_player_id and athlete_image_path.';
comment on column public.community_builds.athlete_image_path is
  'Validated relative asset path for the selected athlete image.';
comment on column public.community_builds.card_rarity_id is
  'Validated rarity id from the checked-in UT card catalog.';
comment on column public.community_builds.league_id is
  'Validated league id from the checked-in UT card catalog.';
comment on column public.community_builds.club_id is
  'Validated club id belonging to league_id in the UT card catalog.';
comment on column public.community_builds.nation_id is
  'Validated nation id from the checked-in UT card catalog.';

grant select (
  athlete_name,
  ut_player_id,
  ut_player_ea_id,
  athlete_image_path,
  card_rarity_id,
  league_id,
  club_id,
  nation_id
) on table public.community_builds to anon, authenticated;
