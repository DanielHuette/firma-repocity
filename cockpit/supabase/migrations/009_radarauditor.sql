alter table cockpit.messages drop constraint if exists messages_app_check;
alter table cockpit.messages add constraint messages_app_check
  check (app in ('crm', 'marketing', 'trading', 'system', 'radarauditor'));

create or replace function cockpit.radar_link(p_audit uuid) returns text
language sql immutable set search_path = '' as $$
  select 'https://app.radarauditor.speedofthespirit.dev/auswertung/' || p_audit::text
$$;

create or replace function cockpit.radar_subject(p_audit uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c.name from public.audits a join public.customers c on c.id = a.customer_id where a.id = p_audit),
    'einem Kunden')
$$;

create or replace function cockpit.radar_is_monthly(p_audit uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from crm.audit_runs where audit_id = p_audit)
$$;

create or replace function cockpit.radar_points(p_audit uuid) returns text
language sql stable security definer set search_path = '' as $$
  select replace(trim_scale(a.total_score)::text, '.', ',') || ' von 100 Punkten'
    from public.audits a where a.id = p_audit and a.total_score is not null
$$;

create or replace function cockpit.radar_short(p_text text) returns text
language sql immutable set search_path = '' as $$
  select case when length(btrim(coalesce(p_text, ''))) > 280
              then left(btrim(p_text), 279) || '…'
              else btrim(coalesce(p_text, '')) end
$$;

create or replace function cockpit.radar_checks_text(p_checks jsonb) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg('Nr ' || (t.item ->> 'number') || ' ' || (t.item ->> 'id'), ', ' order by t.ord), '')
         || case when jsonb_array_length(p_checks) > 3
                 then ' und ' || (jsonb_array_length(p_checks) - 3) || ' weitere' else '' end
    from jsonb_array_elements(p_checks) with ordinality as t(item, ord)
   where t.ord <= 3
$$;

create or replace function cockpit.on_radar_job_started() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.audit_id is null or cockpit.radar_is_monthly(new.audit_id) then
    return new;
  end if;
  perform cockpit.notify_safe('radarauditor', 'radar-gestartet',
    'Audit gestartet: ' || cockpit.radar_subject(new.audit_id),
    'Die Messung läuft. Du bekommst Bescheid, sobald das Urteil da ist.',
    cockpit.radar_link(new.audit_id), 'info', 'radar-gestartet-' || new.audit_id::text);
  return new;
exception when others then
  raise warning 'cockpit.on_radar_job_started failed: %', sqlerrm;
  return new;
end $$;

create or replace trigger cockpit_radar_job_started after update of attempts on public.jobs
  for each row when (new.kind = 'collect' and new.attempts = 1 and old.attempts is distinct from new.attempts)
  execute function cockpit.on_radar_job_started();

create or replace function cockpit.on_radar_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_points text;
  v_text text;
  v_halting boolean;
begin
  for r in
    select e.id, e.audit_id, e.result, e.reason from new_rows e
     where e.kind = 'manager' and e.label = 'Audit-Manager: Ergebnis'
  loop
    v_points := cockpit.radar_points(r.audit_id);
    v_text := btrim(coalesce(v_points || '. ', '') || cockpit.radar_short(r.reason));
    if r.result = 'gemessen' then
      if not cockpit.radar_is_monthly(r.audit_id) then
        perform cockpit.notify_safe('radarauditor', 'radar-fertig',
          'Audit fertig: ' || cockpit.radar_subject(r.audit_id), v_text,
          cockpit.radar_link(r.audit_id), 'info', 'radar-fertig-' || r.id::text);
      end if;
    elsif r.result = 'ausgesetzt' then
      perform cockpit.notify_safe('radarauditor', 'radar-unvollstaendig',
        'Audit unvollständig: ' || cockpit.radar_subject(r.audit_id), v_text,
        cockpit.radar_link(r.audit_id), 'wichtig', 'radar-unvollstaendig-' || r.id::text);
    elsif r.result = 'fehlgeschlagen' then
      perform cockpit.notify_safe('radarauditor', 'radar-fehlgeschlagen',
        'Audit fehlgeschlagen: ' || cockpit.radar_subject(r.audit_id), v_text,
        cockpit.radar_link(r.audit_id), 'dringend', 'radar-fehlgeschlagen-' || r.id::text);
    end if;
  end loop;

  for r in
    select e.audit_id, min(e.route) as route, e.reason, min(e.label) as label, min(e.stage) as stage,
           (array_agg(e.checks))[1] as checks
      from new_rows e
     where e.kind = 'route' and e.result = 'fehlgeschlagen'
     group by e.audit_id, coalesce(e.route, e.label), e.reason
  loop
    v_halting := r.stage in (0, 1);
    perform cockpit.notify_safe('radarauditor', 'radar-messung',
      'Messung fehlgeschlagen: ' || r.label || ' (' || cockpit.radar_subject(r.audit_id) || ')',
      btrim(case when jsonb_array_length(r.checks) > 0
                 then cockpit.radar_checks_text(r.checks) || ': ' else '' end
            || coalesce(nullif(cockpit.radar_short(r.reason), ''), 'Grund unbekannt')
            || case when v_halting then '. Der Audit ist angehalten und wartet auf Daniel' else '' end),
      cockpit.radar_link(r.audit_id),
      case when v_halting then 'dringend' else 'wichtig' end,
      'radar-messung-' || r.audit_id::text || '-' || md5(coalesce(r.route, r.label) || '|' || coalesce(r.reason, ''))
        || '-' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24'));
  end loop;

  for r in
    select e.audit_id, count(*) as missing,
           (array_agg('Nr ' || e.check_number || ' ' || e.check_id order by e.check_number))[1:3] as listed,
           md5(string_agg(e.check_id, ',' order by e.check_id)) as fingerprint
      from new_rows e
     where e.kind = 'check' and e.result = 'fehlgeschlagen' and coalesce(e.reason, '') not like '% ausgefallen: %'
     group by e.audit_id
  loop
    perform cockpit.notify_safe('radarauditor', 'radar-ohne-messwert',
      r.missing || case when r.missing = 1 then ' Prüfung' else ' Prüfungen' end || ' ohne Messwert ('
        || cockpit.radar_subject(r.audit_id) || ')',
      array_to_string(r.listed, ', ')
        || case when r.missing > 3 then ' und ' || (r.missing - 3) || ' weitere' else '' end,
      cockpit.radar_link(r.audit_id), 'info',
      'radar-ohne-messwert-' || r.audit_id::text || '-' || r.fingerprint
        || '-' || to_char(now() at time zone 'utc', 'YYYYMMDD'));
  end loop;
  return null;
exception when others then
  raise warning 'cockpit.on_radar_events failed: %', sqlerrm;
  return null;
end $$;

create or replace trigger cockpit_radar_events after insert on public.audit_events
  referencing new table as new_rows for each statement
  execute function cockpit.on_radar_events();

create or replace function cockpit.on_radar_heartbeat() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_away interval := (new.value ->> 'at')::timestamptz - (old.value ->> 'at')::timestamptz;
begin
  if v_away <= interval '3 minutes' then
    return new;
  end if;
  perform cockpit.notify_safe('radarauditor', 'sammler-zurueck', 'Der Sammler ist wieder da',
    'Der Sammler ist wieder da, nach etwa ' || round(extract(epoch from v_away) / 60)::int
      || ' Minuten Pause. Wartende Audits laufen jetzt weiter.',
    'https://app.radarauditor.speedofthespirit.dev/auswertung', 'info',
    'sammler-zurueck-' || (new.value ->> 'at'));
  return new;
exception when others then
  raise warning 'cockpit.on_radar_heartbeat failed: %', sqlerrm;
  return new;
end $$;

create or replace trigger cockpit_radar_heartbeat after update on public.settings
  for each row when (new.key = 'worker_heartbeat') execute function cockpit.on_radar_heartbeat();

revoke all on function cockpit.radar_link(uuid) from public, anon, authenticated;
revoke all on function cockpit.radar_subject(uuid) from public, anon, authenticated;
revoke all on function cockpit.radar_is_monthly(uuid) from public, anon, authenticated;
revoke all on function cockpit.radar_points(uuid) from public, anon, authenticated;
revoke all on function cockpit.radar_short(text) from public, anon, authenticated;
revoke all on function cockpit.radar_checks_text(jsonb) from public, anon, authenticated;
revoke all on function cockpit.on_radar_job_started() from public, anon, authenticated;
revoke all on function cockpit.on_radar_events() from public, anon, authenticated;
revoke all on function cockpit.on_radar_heartbeat() from public, anon, authenticated;
