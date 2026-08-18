-- 0010_account_deletion_fixes.sql
--
-- Two defects behind DELETE /api/admin/users/[id], both in the schema rather
-- than in the route that trips over them.
--
--   1. Deleting an account fails outright if that person ever issued an
--      invite. invited_emails.invited_by is the only reference to profiles(id)
--      in the whole schema with no ON DELETE action, and profiles cascades
--      from auth.users (0001), so removing an account tries to remove its
--      profile row and this constraint refuses. Every invite is issued by an
--      admin, and the bootstrap admin (0005) issued the first ones — so this
--      breaks deletion for precisely the accounts most likely to need
--      deprovisioning, and surfaces as an unexplained 502 from GoTrue.
--
--      audit_log.actor (0006) already got this right: 'on delete set null',
--      with actor_name snapshotted so the row stays readable after the account
--      is gone. The same reasoning applies here. Who issued an invite is worth
--      recording while they are around; it is not worth refusing a deletion
--      over, and the audit_log row for that invite keeps the name regardless.
--
--   2. Nothing enforced that invited_emails.email is lowercase, though every
--      writer assumes it. The asymmetry is what makes it bite:
--      handle_new_user() matches on lower(email), so a mixed-case row still
--      lets its owner sign up — but invite_user(), revoke_invite() and the
--      delete route's invite cleanup all compare against an exactly-lowercased
--      string. A row written any other way (Supabase table editor, a hand-run
--      insert, a restored dump) therefore admits someone while being invisible
--      to every path that could revoke it, correct its role, or clear it when
--      the account is deleted.

-- ---------- 1. let a profile be deleted ----------

-- `drop ... if exists` rather than a bare drop so the whole file can be run
-- again safely. It matters more than it looks: the Supabase SQL editor runs a
-- script as a single transaction, so one "already exists" at the bottom rolls
-- back the top as well — and this constraint is the half that actually unblocks
-- account deletion.
alter table invited_emails drop constraint if exists invited_emails_invited_by_fkey;
alter table invited_emails
  add constraint invited_emails_invited_by_fkey
      foreign key (invited_by) references profiles(id) on delete set null;

-- ---------- 2. make the lowercase assumption true ----------

-- Where both spellings of the same address exist, the lowercase row is the one
-- every writer can already see; the other is a duplicate of it. Dropping it
-- first keeps the normalisation below from colliding on the primary key.
delete from invited_emails u
 where u.email <> lower(u.email)
   and exists (select 1 from invited_emails l where l.email = lower(u.email));

update invited_emails set email = lower(email) where email <> lower(email);

-- Deliberately a check rather than a normalising trigger. Everything that
-- should write here already lowercases; the value of the constraint is that
-- anything that does not is refused loudly at the point of the mistake, rather
-- than silently repaired into a row nobody realises was written wrong.
alter table invited_emails drop constraint if exists invited_emails_email_lowercase;
alter table invited_emails
  add constraint invited_emails_email_lowercase check (email = lower(email));
