begin;

insert into public.customers (id, name, industry, city)
values ('00000000-0000-0000-0000-0000000000c1', 'Testbäckerei', 'Bäckerei', 'Hamburg');

insert into public.audits (id, customer_id, status, total_score) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'collecting', null),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'collecting', null),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1', 'collecting', null),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c1', 'collecting', null);

do $$
begin
  assert exists (select 1 from information_schema.check_constraints where constraint_name = 'messages_app_check'
                   and check_clause like '%radarauditor%'), 'app check lacks radarauditor';
  begin
    insert into cockpit.messages (app, kind, title) values ('unbekannt', 'x', 'x');
    assert false, 'unknown app accepted';
  exception when check_violation then null;
  end;
end $$;

do $$
declare v_job uuid;
begin
  insert into public.jobs (kind, customer_id, audit_id, attempts)
  values ('collect', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 0)
  returning id into v_job;
  assert (select count(*) from cockpit.messages where kind = 'radar-gestartet') = 0, 'insert at attempts 0 must not notify';
  update public.jobs set attempts = 1 where id = v_job;
  assert (select count(*) from cockpit.messages where kind = 'radar-gestartet') = 1, 'first attempt must notify once';
  assert (select app from cockpit.messages where kind = 'radar-gestartet') = 'radarauditor', 'wrong app';
  assert (select title from cockpit.messages where kind = 'radar-gestartet') = 'Audit gestartet: Testbäckerei', 'wrong title';
  assert (select link from cockpit.messages where kind = 'radar-gestartet')
    = 'https://app.radarauditor.speedofthespirit.dev/auswertung/00000000-0000-0000-0000-0000000000a1', 'wrong link';
  update public.jobs set attempts = 2 where id = v_job;
  assert (select count(*) from cockpit.messages where kind = 'radar-gestartet') = 1, 'retry must not notify again';
  update public.jobs set status = 'done' where id = v_job;
  assert (select count(*) from cockpit.messages where kind = 'radar-gestartet') = 1, 'status change must not notify';
end $$;

do $$
begin
  insert into public.jobs (kind, customer_id, audit_id, attempts)
  values ('score', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', 0);
  update public.jobs set attempts = 1 where audit_id = '00000000-0000-0000-0000-0000000000a2';
  assert (select count(*) from cockpit.messages where kind = 'radar-gestartet') = 1, 'only collect jobs announce a start';
end $$;

do $$
declare v_long text := repeat('x', 300);
begin
  update public.audits set total_score = 62.50 where id = '00000000-0000-0000-0000-0000000000a1';
  insert into public.audit_events (audit_id, kind, phase, result, reason, label) values
    ('00000000-0000-0000-0000-0000000000a1', 'manager', 'auswertung', 'gemessen', 'Alles gemessen', 'Audit-Manager: Ergebnis');
  assert (select count(*) from cockpit.messages where kind = 'radar-fertig') = 1, 'verdict ok must notify';
  assert (select title from cockpit.messages where kind = 'radar-fertig') = 'Audit fertig: Testbäckerei', 'wrong ok title';
  assert (select body from cockpit.messages where kind = 'radar-fertig') = '62,5 von 100 Punkten. Alles gemessen', 'wrong ok body';
  assert (select priority from cockpit.messages where kind = 'radar-fertig') = 'info', 'ok must be info';

  insert into public.audit_events (audit_id, kind, phase, result, reason, label) values
    ('00000000-0000-0000-0000-0000000000a2', 'manager', 'auswertung', 'ausgesetzt', 'Drei Prüfungen fehlen', 'Audit-Manager: Ergebnis');
  assert (select priority from cockpit.messages where kind = 'radar-unvollstaendig') = 'wichtig', 'incomplete must be wichtig';
  assert (select body from cockpit.messages where kind = 'radar-unvollstaendig') = 'Drei Prüfungen fehlen', 'no score means no points sentence';

  insert into public.audit_events (audit_id, kind, phase, result, reason, label) values
    ('00000000-0000-0000-0000-0000000000a3', 'manager', 'auswertung', 'fehlgeschlagen', v_long, 'Audit-Manager: Ergebnis');
  assert (select priority from cockpit.messages where kind = 'radar-fehlgeschlagen') = 'dringend', 'failed must be dringend';
  assert (select length(body) from cockpit.messages where kind = 'radar-fehlgeschlagen') = 280, 'reason must be cut to 280';
  assert (select body from cockpit.messages where kind = 'radar-fehlgeschlagen') like '%…', 'cut reason must end with an ellipsis';

  insert into public.audit_events (audit_id, kind, phase, result, reason, label) values
    ('00000000-0000-0000-0000-0000000000a3', 'manager', 'auswertung', 'offen', 'noch nicht', 'Audit-Manager: Ergebnis'),
    ('00000000-0000-0000-0000-0000000000a3', 'manager', 'auswertung', 'gemessen', 'Notiz', 'Audit-Manager');
  assert (select count(*) from cockpit.messages where kind in ('radar-fertig', 'radar-unvollstaendig', 'radar-fehlgeschlagen')) = 3,
    'open verdicts and notes must not notify';

  update public.audits set total_score = 100 where id = '00000000-0000-0000-0000-0000000000a4';
  insert into public.audit_events (audit_id, kind, phase, result, reason, label) values
    ('00000000-0000-0000-0000-0000000000a4', 'manager', 'auswertung', 'gemessen', null, 'Audit-Manager: Ergebnis');
  assert (select body from cockpit.messages where kind = 'radar-fertig' and link like '%a4') = '100 von 100 Punkten.', 'whole score needs no decimals';
end $$;

do $$
declare v_checks jsonb := '[{"number":1,"id":"a1","name":"A"},{"number":2,"id":"a2","name":"B"},{"number":3,"id":"a3","name":"C"},{"number":4,"id":"a4","name":"D"}]';
begin
  insert into public.audit_events (audit_id, kind, phase, result, reason, stage, route, label, checks) values
    ('00000000-0000-0000-0000-0000000000a1', 'route', 'messung', 'fehlgeschlagen', 'Google zeigt eine Sicherheitsabfrage', 0, 'google_search', 'Google-Suche', v_checks),
    ('00000000-0000-0000-0000-0000000000a1', 'route', 'messung', 'fehlgeschlagen', 'Die Antwort kam nicht rechtzeitig', 2, 'bing', 'Bing', '[{"number":9,"id":"b9","name":"X"}]'),
    ('00000000-0000-0000-0000-0000000000a1', 'route', 'messung', 'fehlgeschlagen', null, 1, 'maps', 'Google Maps', '[]'),
    ('00000000-0000-0000-0000-0000000000a1', 'route', 'messung', 'gemessen', null, 0, 'website', 'Website', '[]');
  assert (select count(*) from cockpit.messages where kind = 'radar-messung') = 3, 'one notice per failed route';
  assert (select priority from cockpit.messages where kind = 'radar-messung' and title like '%Google-Suche%') = 'wichtig', 'a failed route is wichtig whatever its stage';
  assert (select body from cockpit.messages where kind = 'radar-messung' and title like '%Google-Suche%')
    = 'Nr 1 a1, Nr 2 a2, Nr 3 a3 und 1 weitere: Google zeigt eine Sicherheitsabfrage', 'a failed route never announces a halt';
  assert (select title from cockpit.messages where kind = 'radar-messung' and title like '%Google-Suche%')
    = 'Messung fehlgeschlagen: Google-Suche (Testbäckerei)', 'wrong route title';
  assert (select priority from cockpit.messages where kind = 'radar-messung' and title like '%Bing%') = 'wichtig', 'stage 2 is wichtig';
  assert (select body from cockpit.messages where kind = 'radar-messung' and title like '%Bing%')
    = 'Nr 9 b9: Die Antwort kam nicht rechtzeitig', 'wrong stage 2 body';
  assert (select priority from cockpit.messages where kind = 'radar-messung' and title like '%Maps%') = 'wichtig', 'stage 1 is wichtig';
  assert (select body from cockpit.messages where kind = 'radar-messung' and title like '%Maps%')
    = 'Grund unbekannt', 'missing reason must be named';

  insert into public.audit_events (audit_id, kind, phase, result, reason, stage, route, label, checks) values
    ('00000000-0000-0000-0000-0000000000a1', 'route', 'messung', 'fehlgeschlagen', 'Google zeigt eine Sicherheitsabfrage', 0, 'google_search', 'Google-Suche', v_checks);
  assert (select count(*) from cockpit.messages where kind = 'radar-messung') = 3, 'same failure in the same hour must not repeat';

  insert into public.audit_events (audit_id, kind, phase, result, reason, stage, route, label, checks) values
    ('00000000-0000-0000-0000-0000000000a1', 'route', 'messung', 'fehlgeschlagen', 'Ein anderer Grund', 0, 'google_search', 'Google-Suche', v_checks);
  assert (select count(*) from cockpit.messages where kind = 'radar-messung') = 4, 'a new reason must notify';
end $$;

do $$
begin
  insert into public.audit_events (audit_id, kind, phase, result, reason, stage, route, label, check_number, check_id) values
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'fehlgeschlagen', 'Für diese Prüfung liegt kein Ergebnis vor', 3, 'website', 'P1', 1, 'c1'),
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'fehlgeschlagen', 'Für diese Prüfung liegt kein Ergebnis vor', 3, 'website', 'P2', 2, 'c2'),
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'fehlgeschlagen', 'Für diese Prüfung liegt kein Ergebnis vor', 3, 'website', 'P3', 3, 'c3'),
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'fehlgeschlagen', 'Für diese Prüfung liegt kein Ergebnis vor', 3, 'website', 'P4', 4, 'c4'),
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'fehlgeschlagen', 'Für diese Prüfung liegt kein Ergebnis vor', 3, 'website', 'P5', 5, 'c5'),
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'fehlgeschlagen', 'Bing ausgefallen: Sicherheitsabfrage', 3, 'bing', 'P6', 6, 'c6'),
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'gemessen', null, 3, 'website', 'P7', 7, 'c7');
  assert (select count(*) from cockpit.messages where kind = 'radar-ohne-messwert') = 1, 'one summary per audit';
  assert (select title from cockpit.messages where kind = 'radar-ohne-messwert') = '5 Prüfungen ohne Messwert (Testbäckerei)', 'wrong summary title';
  assert (select body from cockpit.messages where kind = 'radar-ohne-messwert') = 'Nr 1 c1, Nr 2 c2, Nr 3 c3 und 2 weitere', 'wrong summary body';
  assert (select priority from cockpit.messages where kind = 'radar-ohne-messwert') = 'info', 'summary is info';

  delete from public.audit_events where audit_id = '00000000-0000-0000-0000-0000000000a2' and kind = 'check';
  insert into public.audit_events (audit_id, kind, phase, result, reason, stage, route, label, check_number, check_id) values
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'fehlgeschlagen', 'Für diese Prüfung liegt kein Ergebnis vor', 3, 'website', 'P1', 1, 'c1'),
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'fehlgeschlagen', 'Für diese Prüfung liegt kein Ergebnis vor', 3, 'website', 'P2', 2, 'c2'),
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'fehlgeschlagen', 'Für diese Prüfung liegt kein Ergebnis vor', 3, 'website', 'P3', 3, 'c3'),
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'fehlgeschlagen', 'Für diese Prüfung liegt kein Ergebnis vor', 3, 'website', 'P4', 4, 'c4'),
    ('00000000-0000-0000-0000-0000000000a2', 'check', 'auswertung', 'fehlgeschlagen', 'Für diese Prüfung liegt kein Ergebnis vor', 3, 'website', 'P5', 5, 'c5');
  assert (select count(*) from cockpit.messages where kind = 'radar-ohne-messwert') = 1, 'rescoring the same checks the same day must not repeat';

  insert into public.audit_events (audit_id, kind, phase, result, reason, stage, route, label, check_number, check_id) values
    ('00000000-0000-0000-0000-0000000000a3', 'check', 'auswertung', 'fehlgeschlagen', null, 3, 'website', 'P1', 1, 'c1');
  assert (select title from cockpit.messages where kind = 'radar-ohne-messwert' and link like '%a3') = '1 Prüfung ohne Messwert (Testbäckerei)', 'singular title';
  assert (select body from cockpit.messages where kind = 'radar-ohne-messwert' and link like '%a3') = 'Nr 1 c1', 'singular body';
end $$;

do $$
begin
  insert into crm.customers (id, name) values ('00000000-0000-0000-0000-0000000000d1', 'Monatskunde') on conflict do nothing;
  set local session_replication_role = replica;
  insert into crm.audit_runs (subscription_id, customer_id, month, status, audit_id)
  values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000d1', date_trunc('month', now())::date, 'started',
          '00000000-0000-0000-0000-0000000000a4');
  set local session_replication_role = origin;

  insert into public.jobs (kind, customer_id, audit_id, attempts)
  values ('collect', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a4', 0);
  update public.jobs set attempts = 1 where audit_id = '00000000-0000-0000-0000-0000000000a4' and kind = 'collect';
  assert (select count(*) from cockpit.messages where kind = 'radar-gestartet' and link like '%a4') = 0, 'monthly audits have their own start notice';

  insert into public.audit_events (audit_id, kind, phase, result, reason, label) values
    ('00000000-0000-0000-0000-0000000000a4', 'manager', 'auswertung', 'gemessen', 'zweites Urteil', 'Audit-Manager: Ergebnis');
  assert (select count(*) from cockpit.messages where kind = 'radar-fertig' and body like '%zweites%') = 0, 'monthly audits have their own done notice';

  insert into public.audit_events (audit_id, kind, phase, result, reason, label) values
    ('00000000-0000-0000-0000-0000000000a4', 'manager', 'auswertung', 'ausgesetzt', 'Monat unvollständig', 'Audit-Manager: Ergebnis');
  assert (select count(*) from cockpit.messages where kind = 'radar-unvollstaendig' and body = '100 von 100 Punkten. Monat unvollständig') = 1, 'incomplete monthly audit must notify';
end $$;

do $$
begin
  insert into public.audit_events (audit_id, kind, phase, result, reason, label, route) values
    ('00000000-0000-0000-0000-0000000000a4', 'repair', 'messung', 'neu gestartet', 'Bing-Suche, Versuch 4', 'Audit-Agent übernimmt', 'bing'),
    ('00000000-0000-0000-0000-0000000000a4', 'repair', 'messung', 'Warnung', 'Bing-Suche scheitert nach 5 Versuchen weiter', 'Audit-Agent: Teil scheitert weiter', 'bing');
  assert (select count(*) from cockpit.messages where kind = 'radar-warnung') = 1, 'a warning of the audit agent must notify once';
  assert (select count(*) from cockpit.messages where kind = 'radar-warnung' and priority = 'wichtig'
            and body = 'Bing-Suche scheitert nach 5 Versuchen weiter') = 1, 'the warning must carry its reason';
end $$;

do $$
begin
  delete from public.settings where key = 'worker_heartbeat';
  insert into public.settings (key, value) values ('worker_heartbeat', '{"at":"2026-01-01T10:00:00Z"}');
  update public.settings set value = '{"at":"2026-01-01T11:00:00Z"}' where key = 'worker_heartbeat';
  assert (select count(*) from cockpit.messages where kind = 'sammler-zurueck') = 0, 'a late heartbeat must not notify';
  assert to_regprocedure('cockpit.on_radar_heartbeat()') is null, 'heartbeat notice must be gone';
end $$;

do $$
declare v_function text;
begin
  foreach v_function in array array[
    'cockpit.radar_link(uuid)', 'cockpit.radar_subject(uuid)', 'cockpit.radar_is_monthly(uuid)',
    'cockpit.radar_points(uuid)', 'cockpit.radar_short(text)', 'cockpit.radar_checks_text(jsonb)',
    'cockpit.on_radar_job_started()', 'cockpit.on_radar_events()']
  loop
    assert not has_function_privilege('authenticated', v_function, 'execute'), v_function || ' open to authenticated';
    assert not has_function_privilege('anon', v_function, 'execute'), v_function || ' open to anon';
  end loop;
end $$;

do $$
begin
  assert (select count(*) from net.calls) = (select count(*) from cockpit.messages), 'every message must be handed to the push function';
end $$;

rollback;
