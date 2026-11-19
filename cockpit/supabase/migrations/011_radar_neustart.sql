create or replace function cockpit.on_radar_events() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_points text;
  v_text text;
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
    select e.audit_id, min(e.route) as route, e.reason, min(e.label) as label,
           (array_agg(e.checks))[1] as checks
      from new_rows e
     where e.kind = 'route' and e.result = 'fehlgeschlagen'
     group by e.audit_id, coalesce(e.route, e.label), e.reason
  loop
    perform cockpit.notify_safe('radarauditor', 'radar-messung',
      'Messung fehlgeschlagen: ' || r.label || ' (' || cockpit.radar_subject(r.audit_id) || ')',
      btrim(case when jsonb_array_length(r.checks) > 0
                 then cockpit.radar_checks_text(r.checks) || ': ' else '' end
            || coalesce(nullif(cockpit.radar_short(r.reason), ''), 'Grund unbekannt')),
      cockpit.radar_link(r.audit_id), 'wichtig',
      'radar-messung-' || r.audit_id::text || '-' || md5(coalesce(r.route, r.label) || '|' || coalesce(r.reason, ''))
        || '-' || to_char(now() at time zone 'utc', 'YYYYMMDDHH24'));
  end loop;

  for r in
    select e.id, e.audit_id, e.reason, e.label from new_rows e
     where e.kind = 'repair' and e.result = 'Warnung'
  loop
    perform cockpit.notify_safe('radarauditor', 'radar-warnung',
      'Warnung: ' || r.label || ' (' || cockpit.radar_subject(r.audit_id) || ')',
      coalesce(nullif(cockpit.radar_short(r.reason), ''), 'Grund unbekannt'),
      cockpit.radar_link(r.audit_id), 'wichtig', 'radar-warnung-' || r.id::text);
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

revoke all on function cockpit.on_radar_events() from public, anon, authenticated;
