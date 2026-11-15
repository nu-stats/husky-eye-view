# Builds the worked example workbook (needs Excel on Windows):
#   course/assignments/data/weighted-averages-example.xlsx
# Ten cities, real Census data, formulas for the weighted averages.
#
#   node scripts/build-example-workbook-data.mjs <group tables folder> Poland <example.json>
#   powershell -ExecutionPolicy Bypass -File scripts/build-example-workbook.ps1 -DataFile <example.json>
param([Parameter(Mandatory)][string]$DataFile)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$data = Get-Content $DataFile -Raw | ConvertFrom-Json
$group = $data.group
$out = Join-Path $root 'course/assignments/data/weighted-averages-example.xlsx'
$n = $data.rows.Count                 # 10 cities
$first = 4; $last = $first + $n - 1   # data rows
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -lt 3) { [void]$wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
  $d = $wb.Worksheets.Item(1); $d.Name = 'Data'
  $w = $wb.Worksheets.Item(2); $w.Name = 'Weighted averages'
  $v = $wb.Worksheets.Item(3); $v.Name = 'Variables'

  # ---- Data sheet: per period, 4 columns (weight, foreign_born_percent, poverty_percent, unemployment_percent) ----
  $d.Cells.Item(1,1).Value2 = "Example: where $group-born residents live ($n cities, real Census data)"
  $d.Cells.Item(1,1).Font.Bold = $true; $d.Cells.Item(1,1).Font.Size = 13
  $periods = @('2000 (Census 2000)', '2006-2010 (American Community Survey)', '2020-2024 (American Community Survey)')
  $d.Cells.Item(3,1).Value2 = 'City'; $d.Cells.Item(3,2).Value2 = 'State'
  for ($k = 0; $k -lt 3; $k++) {
    $c = 3 + 4 * $k
    $d.Cells.Item(2,$c).Value2 = $periods[$k]
    $d.Range($d.Cells.Item(2,$c), $d.Cells.Item(2,$c+3)).Merge()
    $d.Cells.Item(2,$c).HorizontalAlignment = -4108
    $d.Cells.Item(3,$c).Value2 = "$group-born residents (WEIGHT)"
    $d.Cells.Item(3,$c+1).Value2 = 'foreign_born_percent'
    $d.Cells.Item(3,$c+2).Value2 = 'poverty_percent'
    $d.Cells.Item(3,$c+3).Value2 = 'unemployment_percent'
  }
  for ($i = 0; $i -lt $n; $i++) {
    $r = $first + $i; $row = $data.rows[$i]
    $d.Cells.Item($r,1).Value2 = $row.city; $d.Cells.Item($r,2).Value2 = $row.state
    for ($k = 0; $k -lt 3; $k++) {
      $c = 3 + 4 * $k; $p = $row.p[$k]
      $d.Cells.Item($r,$c).Value2 = [double]$p.w
      $d.Cells.Item($r,$c+1).Value2 = [double]$p.fb
      $d.Cells.Item($r,$c+2).Value2 = [double]$p.pov
      $d.Cells.Item($r,$c+3).Value2 = [double]$p.unemp
    }
  }
  $d.Range("C${first}:N$last").NumberFormat = '#,##0.0'
  foreach ($c in 3,7,11) { $d.Range($d.Cells.Item($first,$c), $d.Cells.Item($last,$c)).NumberFormat = '#,##0' }
  $d.Cells.Item($last+2,1).Value2 = "The $n cities have the most $group-born residents in 2020-2024 among cities above 75,000 residents in all three periods. Weights are $group-born counts (Census 2000 and the American Community Survey). City values are whole-city values, not values for $group-born residents."
  $d.Cells.Item($last+3,1).Value2 = 'Sources: Census 2000; American Community Survey 5-year estimates for 2006-2010 and 2020-2024.'
  $hdr = $d.Range('A2:N3'); $hdr.Font.Bold = $true; $hdr.Interior.Color = 0xEBDDD0; $hdr.WrapText = $true; $hdr.VerticalAlignment = -4108
  $d.Columns.Item(1).ColumnWidth = 22; $d.Columns.Item(2).ColumnWidth = 16
  $d.Range('C:N').ColumnWidth = 15
  $d.Rows.Item(3).RowHeight = 48

  # ---- Weighted averages sheet ----
  $w.Cells.Item(1,1).Value2 = "Weighted averages for the group ($n cities)"
  $w.Cells.Item(1,1).Font.Bold = $true; $w.Cells.Item(1,1).Font.Size = 13
  $w.Cells.Item(2,1).Value2 = "Weighted average = SUM(weight x value) / SUM(weight). Weights = $group-born residents in each city for that period."
  $h = 'Variable','Period','Weighted average','Unweighted mean of cities','National value','Weighted minus national','Weighted minus unweighted'
  for ($j = 0; $j -lt $h.Count; $j++) { $w.Cells.Item(4,$j+1).Value2 = $h[$j] }
  $vars = @(@('foreign_born_percent',1), @('poverty_percent',2), @('unemployment_percent',3))
  $names = '2000','2006-2010','2020-2024'
  $r = 5
  foreach ($var in $vars) {
    for ($k = 0; $k -lt 3; $k++) {
      $wc = 3 + 4 * $k; $vc = $wc + $var[1]
      $wl = $d.Cells.Item(1,$wc).Address($false,$false) -replace '\d',''
      $vl = $d.Cells.Item(1,$vc).Address($false,$false) -replace '\d',''
      $w.Cells.Item($r,1).Value2 = $var[0]
      $w.Cells.Item($r,2).Value2 = $names[$k]
      $w.Cells.Item($r,3).Formula = "=SUMPRODUCT(Data!`$$wl`$${first}:`$$wl`$$last,Data!`$$vl`$${first}:`$$vl`$$last)/SUM(Data!`$$wl`$${first}:`$$wl`$$last)"
      $w.Cells.Item($r,4).Formula = "=AVERAGE(Data!`$$vl`$${first}:`$$vl`$$last)"
      if ($var[1] -eq 1) { $w.Cells.Item($r,5).Value2 = [double]$data.nat[$k] }
      $w.Cells.Item($r,6).Formula = "=IF(ISNUMBER(E$r),C$r-E$r,`"enter national value`")"
      $w.Cells.Item($r,7).Formula = "=C$r-D$r"
      $r++
    }
  }
  $w.Range('C5:G13').NumberFormat = '0.0'
  $w.Range('E8:E13').Interior.Color = 0x99FFFF
  $w.Cells.Item(15,1).Value2 = 'National foreign-born values are computed from the Census tables (foreign-born / total population). For poverty and unemployment, type the U.S. value for each period (yellow cells); column F then fills in.'
  # a sentence about the 2000 poverty rows, computed from the data
  $wsum = 0.0; $wx = 0.0; $sx = 0.0; $big = $data.rows[0]
  foreach ($row in $data.rows) { $p = $row.p[0]; $wsum += $p.w; $wx += $p.w * $p.pov; $sx += $p.pov; if ($p.w -gt $big.p[0].w) { $big = $row } }
  $note = ('Read the 2000 poverty rows: weighted by {0}-born residents, the average city had {1:N1}% below poverty, against {2:N1}% for the plain mean of the {3} cities. {4} holds {5:P0} of the weight in 2000, so it pulls the weighted average toward its own values.' -f $group, ($wx / $wsum), ($sx / $n), $n, $big.city, ($big.p[0].w / $wsum))
  $w.Cells.Item(16,1).Value2 = $note
  $hh = $w.Range('A4:G4'); $hh.Font.Bold = $true; $hh.Interior.Color = 0xEBDDD0; $hh.WrapText = $true
  $w.Columns.Item(1).ColumnWidth = 32; $w.Columns.Item(2).ColumnWidth = 12; $w.Range('C:G').ColumnWidth = 18
  $w.Rows.Item(4).RowHeight = 32

  # ---- Variables sheet ----
  $rows = @(
    @('Variable name','What it measures','2000','2006-2010','2020-2024'),
    @('population','Total number of residents in the city','Census 2000','American Community Survey','American Community Survey'),
    @('foreign_born_percent','Foreign-born residents, as a percent of all residents','Census 2000','American Community Survey','American Community Survey'),
    @('poverty_percent','People below the poverty level, as a percent of people for whom poverty is determined','Census 2000','American Community Survey','American Community Survey'),
    @('unemployment_percent','Unemployed people, as a percent of the civilian labor force','Census 2000','American Community Survey','American Community Survey')
  )
  for ($i = 0; $i -lt $rows.Count; $i++) { for ($j = 0; $j -lt 5; $j++) { $v.Cells.Item($i+1,$j+1).Value2 = $rows[$i][$j] } }
  $v.Range('A1:E1').Font.Bold = $true; $v.Range('A1:E1').Interior.Color = 0xEBDDD0
  $v.Cells.Item(7,1).Value2 = 'Choose three of these four for the assignment.'
  $v.Columns.Item(1).ColumnWidth = 24; $v.Columns.Item(2).ColumnWidth = 60; $v.Range('C:E').ColumnWidth = 26

  $wb.Worksheets.Item(2).Activate()
  $wb.SaveAs($out, 51)
  $wb.Close($false)
  Write-Output "saved $out"
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
