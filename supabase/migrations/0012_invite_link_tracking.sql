-- 0012_invite_link_tracking.sql
--
-- Records when an invitation link was last minted, so the Users tab can say
-- whether the one you sent is still good.
--
-- Needed because none of the existing columns answer that question.
-- invited_at is stamped by invite_user(), which the link route only calls the
-- first time — pressing "Copy link" again for someone who has not signed up
-- issues a fresh link without touching it. claimed_at is stamped the moment the
-- account row appears, which for a link invite is when the link is *generated*,
-- not when it is used. So both are about the allow-list entry; neither tracks
-- the credential actually sent to a person.
--
-- Written by the route with the service key rather than through invite_user():
-- the useful moment is after generateLink() has actually returned a URL, and
-- folding it into the RPC would stamp it for the Add account path too, which
-- mints no link at all.
--
-- Nullable on purpose, and null is meaningful rather than missing: an account
-- created through Add account never has a link, and reads as "ready to sign in"
-- instead of "waiting on a link".

alter table invited_emails add column if not exists link_generated_at timestamptz;

comment on column invited_emails.link_generated_at is
  'When an invitation or recovery link was last generated for this address. '
  'Null means no link was ever minted — either the row was allow-listed by '
  'hand, or the account was created directly through Add account. The link''s '
  'lifetime is a Supabase project setting (Authentication -> Email); the UI '
  'mirrors it as INVITE_LINK_TTL_HOURS in components/UsersPanel.jsx, so the '
  'two have to be changed together.';
