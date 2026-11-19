param(
  [string]$Image = "pgvector/pgvector:pg16"
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$firm = Resolve-Path (Join-Path $here "..\..\..")
$radar = Join-Path $firm "28_Produkte\281_RadarAuditor\supabase\migrations"
$crm = Join-Path $firm "23_CRM\supabase\migrations"
$cockpit = Join-Path $here "..\..\supabase\migrations"

$order = @(
  @($radar, "001_schema", "002_functions", "003_security", "004_access", "005_roles"),
  @($crm, "001_crm", "002_kundenakte", "003_postfach"),
  @($cockpit, "001_cockpit"),
  @($radar, "006_field_app", "007_serp_retry", "009_source_cost", "010_manual_changes", "011_url_only_audit", "012_field_audit_parts", "013_crm_handover", "014_remove_billing"),
  @($crm, "004_flow"),
  @($cockpit, "002_actions"),
  @($crm, "005_calls"),
  @($radar, "015_link_crm_leads"),
  @($cockpit, "003_scenario_fixes"),
  @($crm, "006_scenario_fixes", "007_finanzen"),
  @($cockpit, "004_payment_buttons"),
  @($crm, "008_rueckbuchung_belege"),
  @($cockpit, "005_reversal_buttons"),
  @($crm, "009_kalender", "010_nachfassen"),
  @($cockpit, "006_kalender_nachfassen"),
  @($crm, "011_herkunft", "012_assistent", "013_audit_anfragen", "014_angebot", "015_angebot_positionen"),
  @($cockpit, "007_audit_anfragen"),
  @($radar, "016_kundensuche_monatsservice"),
  @($cockpit, "008_monatsservice"),
  @($radar, "017_audit_events", "018_audit_manager", "019_keyword_scope", "020_audit_costs", "021_audit_estimates"),
  @($cockpit, "009_radarauditor", "010_radar_ohne_halt"),
  @($radar, "022_audit_repair"),
  @($cockpit, "011_radar_neustart")
)

$work = Join-Path ([IO.Path]::GetTempPath()) ("cockpit-sqltest-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$all = New-Object System.Text.StringBuilder
foreach ($group in $order) {
  $dir = $group[0]
  foreach ($name in $group[1..($group.Count - 1)]) {
    $text = [IO.File]::ReadAllText((Join-Path $dir "$name.sql"))
    $text = [regex]::Replace($text, "(?im)^\s*create extension if not exists (pg_cron|pg_net)\b.*$", "")
    [void]$all.AppendLine("\echo applying $name")
    [void]$all.AppendLine($text)
  }
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $work "migrations.sql"), $all.ToString(), $utf8)
Copy-Item (Join-Path $here "supabase_stub.sql") (Join-Path $work "stub.sql")
Copy-Item (Join-Path $here "radarauditor_test.sql") (Join-Path $work "test.sql")

$name = "cockpit-sqltest-" + [guid]::NewGuid().ToString("N").Substring(0, 8)
$exit = 1
try {
  docker run -d --name $name -e POSTGRES_PASSWORD=test $Image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "docker run failed" }
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    docker exec $name pg_isready -U postgres -d postgres 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; Start-Sleep -Seconds 2; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw "postgres did not become ready" }
  docker cp (Join-Path $work "stub.sql") "${name}:/tmp/stub.sql"
  docker cp (Join-Path $work "migrations.sql") "${name}:/tmp/migrations.sql"
  docker cp (Join-Path $work "test.sql") "${name}:/tmp/test.sql"
  foreach ($file in "stub", "migrations", "test") {
    docker exec $name psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "/tmp/$file.sql"
    if ($LASTEXITCODE -ne 0) { throw "$file.sql failed" }
  }
  $exit = 0
}
catch {
  Write-Host $_.Exception.Message
}
finally {
  docker rm -f $name | Out-Null
  Remove-Item -Recurse -Force $work
}
exit $exit