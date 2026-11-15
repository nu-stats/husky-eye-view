# Builds the student workbook for the community-context assignment (needs Excel on Windows):
#   course/assignments/data/community-context-workbook.xlsx
# Four sheets:
#   Start here          choose the group, the ranking period and three variables; the steps
#   Top 50              the group's name, the 50 cities where it is largest, its size at three time
#                       points, and the three chosen variables at each time point
#   Data                all the data behind it: every city, the measures at three time points, total
#                       population, and the size of every group at each time point
#   Weighted averages   the calculation step by step, so students can see where each number comes from
# Inputs: course/assignments/data/cities-over-75k.csv and the three group-*.tsv files
# from scripts/build-city-assignment-data.mjs.
#
#   node scripts/build-city-assignment-data.mjs <folder>
#   powershell -ExecutionPolicy Bypass -File scripts/build-assignment-workbook.ps1 -DataFolder <folder>
param([Parameter(Mandatory)][string]$DataFolder)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$csvPath = Join-Path $root 'course/assignments/data/cities-over-75k.csv'
$out = Join-Path $root 'course/assignments/data/community-context-workbook.xlsx'

function ColLetter([int]$n) { $s = ''; while ($n -gt 0) { $m = ($n - 1) % 26; $s = [char](65 + $m) + $s; $n = [math]::Floor(($n - 1) / 26) }; $s }
$periodNames = '2000 Census', '2006-2010 survey', '2020-2024 survey'
$varList = 'population,foreign_born_percent,poverty_percent,unemployment_percent,overall_crime_rate,violent_crime_rate,property_crime_rate'
$periodList = '"' + ($periodNames -join '","') + '"'      # period labels used in formulas (not $P: PowerShell names are case-insensitive and $p is a loop variable)
$suffix = '_2000', '_2006_10', '_2020_24'
$headerFill = 0xEBDDD0; $inputFill = 0x99FFFF; $greyFill = 0xD9D9D9

# ---- read the inputs ----
$csv = Import-Csv $csvPath
$heads = $csv[0].PSObject.Properties.Name
$nc = $heads.Count                                         # city_code, city, state + 15 measure columns
$nCities = $csv.Count
$lastRow = $nCities + 1                                    # last city row on Data
$usRow = $nCities + 2                                      # the United States row on Data
$tsv = foreach ($f in 'group-2000.tsv', 'group-2006_10.tsv', 'group-2020_24.tsv') { , [IO.File]::ReadAllLines((Join-Path $DataFolder $f)) }
$headFields = $tsv[0][0].Split("`t")
$groups = $headFields[1..($headFields.Count - 1)]
$nGroups = $groups.Count

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -lt 4) { [void]$wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
  $names = 'Start here', 'Top 50', 'Data', 'Weighted averages'
  for ($i = 0; $i -lt 4; $i++) { $wb.Worksheets.Item($i + 1).Name = $names[$i] }
  $start = $wb.Worksheets.Item(1); $top = $wb.Worksheets.Item(2); $dat = $wb.Worksheets.Item(3); $wa = $wb.Worksheets.Item(4)

  # ================= Data sheet =================
  # A..C city_code, city, state; D..R the measures (population, foreign-born count and percent, poverty,
  # unemployment, for 3 periods); then the chosen group's size (3 periods), ranking_count, group_rank,
  # tie_break_helper; then every group's size by period; then a plain list of group names for the dropdown
  $cV = ColLetter ($nc + 1); $cW = ColLetter ($nc + 2); $cX = ColLetter ($nc + 3); $cY = ColLetter ($nc + 4); $cZ = ColLetter ($nc + 5); $cAA = ColLetter ($nc + 6)
  $lastV = ColLetter $nc
  $m0 = $nc + 7                                            # first column (1-based) of the all-groups block
  $m1 = $m0 + 3 * $nGroups - 1                             # last column of that block
  $mFirst = ColLetter $m0; $mLast = ColLetter $m1
  $lcol = $m1 + 2; $lcolL = ColLetter $lcol
  $nCol = $lcol

  $arr = New-Object 'object[,]' $usRow, $nCol
  for ($c = 0; $c -lt $nc; $c++) { $arr[0, $c] = $heads[$c] }
  for ($r = 0; $r -lt $nCities; $r++) {
    $ri = $r + 1
    for ($c = 0; $c -lt $nc; $c++) {
      $v = $csv[$r].($heads[$c])
      if ($c -le 2) { $arr[$ri, $c] = $v } elseif ($v -eq '') { $arr[$ri, $c] = $null } else { $arr[$ri, $c] = [double]$v }
    }
  }
  $extra = 'group_size_2000', 'group_size_2006_10', 'group_size_2020_24', 'ranking_count', 'group_rank', 'tie_break_helper'
  for ($i = 0; $i -lt 6; $i++) { $ci = $nc + $i; $arr[0, $ci] = $extra[$i] }
  for ($p = 0; $p -lt 3; $p++) {
    $lines = $tsv[$p]
    for ($r = 1; $r -lt $lines.Count; $r++) {
      $f = $lines[$r].Split("`t")
      if ($r -le $nCities -and $f[0] -ne $csv[$r - 1].city_code) { throw "city order differs at row $r" }
      for ($g = 0; $g -lt $nGroups; $g++) { $ci = $m0 - 1 + $p * $nGroups + $g; $arr[$r, $ci] = [double]$f[$g + 1] }
    }
    for ($g = 0; $g -lt $nGroups; $g++) { $ci = $m0 - 1 + $p * $nGroups + $g; $arr[0, $ci] = "$($groups[$g]) ($($periodNames[$p]))" }
  }
  $ur = $nCities + 1
  $arr[$ur, 0] = 'US'; $arr[$ur, 1] = 'United States (total)'
  $li = $lcol - 1
  $arr[0, $li] = 'groups (list for the dropdown)'
  for ($g = 0; $g -lt $nGroups; $g++) { $ri = $g + 1; $arr[$ri, $li] = $groups[$g] }
  $dat.Range($dat.Cells.Item(1, 1), $dat.Cells.Item($usRow, 1)).NumberFormat = '@'
  $dat.Range($dat.Cells.Item(1, 1), $dat.Cells.Item($usRow, $nCol)).Value2 = $arr

  # names used on the other sheets
  [void]$wb.Names.Add('Group', "='Start here'!`$C`$5")
  [void]$wb.Names.Add('RankPeriod', "='Start here'!`$C`$6")
  [void]$wb.Names.Add('Variable1', "='Start here'!`$C`$7")
  [void]$wb.Names.Add('Variable2', "='Start here'!`$C`$8")
  [void]$wb.Names.Add('Variable3', "='Start here'!`$C`$9")
  [void]$wb.Names.Add('GroupList', "=Data!`$${lcolL}`$2:`$${lcolL}`$$($nGroups + 1)")

  # the chosen group's size, then the ranking
  for ($k = 0; $k -lt 3; $k++) {
    $col = ColLetter ($nc + 1 + $k)
    $dat.Range("${col}2:${col}$lastRow").Formula = "=INDEX(`$${mFirst}2:`$${mLast}2,MATCH(Group&`" ($($periodNames[$k]))`",`$${mFirst}`$1:`$${mLast}`$1,0))"
  }
  $dat.Range("${cY}2:${cY}$lastRow").Formula = "=CHOOSE(MATCH(RankPeriod,{$periodList},0),${cV}2,${cW}2,${cX}2)"
  # ties are broken by city code (lowest first), so the Top 50 does not change if the sheet is sorted
  $dat.Range("${cAA}2:${cAA}$lastRow").Formula = "=${cY}2-VALUE(`$A2)/10^7"
  $dat.Range("${cZ}2:${cZ}$lastRow").Formula = "=RANK(${cAA}2,`$${cAA}`$2:`$${cAA}`$$lastRow)"
  $dat.Range("D2:${lastV}$lastRow").NumberFormat = '#,##0.0'
  foreach ($c in 4, 5, 9, 10, 14, 15) { $dat.Range($dat.Cells.Item(2, $c), $dat.Cells.Item($lastRow, $c)).NumberFormat = '#,##0' }
  $dat.Range("${cV}2:${cZ}$lastRow").NumberFormat = '#,##0'
  $dat.Range("${cAA}2:${cAA}$lastRow").NumberFormat = '0.0000000'
  $dat.Range("${cAA}1:${cAA}$lastRow").Font.Color = 0x808080
  $dat.Range("${mFirst}2:${mLast}$usRow").NumberFormat = '#,##0'
  $dat.Rows.Item(1).Font.Bold = $true; $dat.Rows.Item(1).WrapText = $true; $dat.Rows.Item(1).VerticalAlignment = -4160
  $dat.Range("A1:${lastV}1").Interior.Color = $headerFill
  $dat.Range("${cV}1:${cAA}1").Interior.Color = 0xCCE5CC
  $dat.Range("${mFirst}1:${lcolL}1").Interior.Color = $greyFill
  $dat.Rows.Item($usRow).Font.Bold = $true
  $dat.Columns.Item(1).ColumnWidth = 11; $dat.Columns.Item(2).ColumnWidth = 24; $dat.Columns.Item(3).ColumnWidth = 18
  $dat.Range("D:${lcolL}").ColumnWidth = 14
  $dat.Columns.Item($lcol).ColumnWidth = 30
  $dat.Rows.Item(1).RowHeight = 64
  [void]$dat.Range("A1:${mLast}$lastRow").AutoFilter()
  $dat.Activate(); $xl.ActiveWindow.FreezePanes = $false; $dat.Range('D2').Select(); $xl.ActiveWindow.FreezePanes = $true

  # ================= Top 50 sheet =================
  $first = 5; $last = 54
  $top.Range('A1').Formula = '="Group: "&Group'
  $top.Range('A1').Font.Bold = $true; $top.Range('A1').Font.Size = 16
  $top.Range('A2').Formula = '="The 50 cities with the most residents born in "&Group&", ranked by "&RankPeriod'
  $top.Range('A2').Font.Italic = $true
  $top.Range('A4').Value2 = 'rank'; $top.Range('B4').Value2 = 'city_code'; $top.Range('C4').Value2 = 'city'; $top.Range('D4').Value2 = 'state'
  $top.Range('E3').Formula = '="Residents born in "&Group'
  $top.Range('E3:G3').Merge()
  for ($k = 0; $k -lt 3; $k++) { $top.Cells.Item(4, 5 + $k).Value2 = $periodNames[$k] }
  for ($v = 0; $v -lt 3; $v++) {
    $c0 = 8 + 3 * $v
    $top.Cells.Item(3, $c0).Formula = "=Variable$($v + 1)"
    $top.Range($top.Cells.Item(3, $c0), $top.Cells.Item(3, $c0 + 2)).Merge()
    for ($k = 0; $k -lt 3; $k++) { $top.Cells.Item(4, $c0 + $k).Value2 = $periodNames[$k] }
  }
  for ($r = $first; $r -le $last; $r++) { $top.Cells.Item($r, 1).Value2 = $r - $first + 1 }
  $top.Range("B${first}:B$last").Formula = "=INDEX(Data!`$A`$2:`$A`$$lastRow,MATCH(`$A$first,Data!`$${cZ}`$2:`$${cZ}`$$lastRow,0))"
  $top.Range("C${first}:C$last").Formula = "=INDEX(Data!`$B`$2:`$B`$$lastRow,MATCH(`$B$first,Data!`$A`$2:`$A`$$lastRow,0))"
  $top.Range("D${first}:D$last").Formula = "=INDEX(Data!`$C`$2:`$C`$$lastRow,MATCH(`$B$first,Data!`$A`$2:`$A`$$lastRow,0))"
  $top.Range("E${first}:G$last").Formula = "=INDEX(Data!${cV}`$2:${cV}`$$lastRow,MATCH(`$B$first,Data!`$A`$2:`$A`$$lastRow,0))"
  for ($v = 0; $v -lt 3; $v++) {
    for ($k = 0; $k -lt 3; $k++) {
      $col = ColLetter (8 + 3 * $v + $k)
      $idx = "INDEX(Data!`$D`$2:`$${lastV}`$$lastRow,MATCH(`$B$first,Data!`$A`$2:`$A`$$lastRow,0),MATCH(Variable$($v + 1)&`"$($suffix[$k])`",Data!`$D`$1:`$${lastV}`$1,0))"
      $top.Range("${col}${first}:${col}$last").Formula = "=IF($idx=`"`",`"`",$idx)"
    }
  }
  $top.Range("E${first}:G$last").NumberFormat = '#,##0'
  $top.Range("H${first}:P$last").NumberFormat = '[>=1000]#,##0;#,##0.0'      # counts without decimals, percents with one
  $top.Range('A3:P4').Font.Bold = $true; $top.Range('A3:P4').Interior.Color = $headerFill
  $top.Range('E3:P3').HorizontalAlignment = -4108; $top.Range('A4:P4').WrapText = $true
  $top.Rows.Item(4).RowHeight = 32
  $top.Columns.Item(1).ColumnWidth = 7; $top.Columns.Item(3).ColumnWidth = 30; $top.Columns.Item(4).ColumnWidth = 16
  $top.Range('E:P').ColumnWidth = 15
  $top.Columns.Item(2).Hidden = $true      # city_code is used by the formulas only
  foreach ($a in "E3:G$last", "H3:J$last", "K3:M$last", "N3:P$last") { $top.Range($a).Borders.Item(7).LineStyle = 1 }
  $top.Activate(); $xl.ActiveWindow.FreezePanes = $false; $top.Range("E$first").Select(); $xl.ActiveWindow.FreezePanes = $true

  # ================= Weighted averages sheet =================
  $wa.Range('A1').Formula = '="Weighted averages for "&Group&" (top 50 cities, ranked by "&RankPeriod&")"'
  $wa.Range('A1').Font.Bold = $true; $wa.Range('A1').Font.Size = 13
  $wa.Range('A2').Value2 = 'A weighted average counts each city in proportion to how many people in your group live there. The plain average counts every city the same.'
  $wa.Range('A4').Value2 = 'Step 1. National values (type the yellow cells; foreign_born_percent is filled in)'; $wa.Range('A4').Font.Bold = $true
  $wa.Cells.Item(5, 1).Value2 = 'variable'
  for ($k = 0; $k -lt 3; $k++) { $wa.Cells.Item(5, 2 + $k).Value2 = $periodNames[$k] }
  $nv = 'population', 'foreign_born_percent', 'poverty_percent', 'unemployment_percent', 'overall_crime_rate', 'violent_crime_rate', 'property_crime_rate'
  $nNv = $nv.Count; $nvLast = 5 + $nNv                      # national table rows 6..12
  for ($i = 0; $i -lt $nNv; $i++) { $wa.Cells.Item(6 + $i, 1).Value2 = $nv[$i] }
  $wa.Range('B7').Value2 = 11.1; $wa.Range('C7').Value2 = 12.7; $wa.Range('D7').Value2 = 14.1
  foreach ($a in "B6:D6", "B8:D$nvLast") { $wa.Range($a).Interior.Color = $inputFill }
  $wa.Range("B6:D$nvLast").NumberFormat = '[>=1000]#,##0;#,##0.0'
  $wa.Range('A5:D5').Font.Bold = $true; $wa.Range('A5:D5').Interior.Color = $headerFill

  $r2 = $nvLast + 2                                          # Step 2 title row
  $wa.Cells.Item($r2, 1).Value2 = 'Step 2. Results for the three variables you chose on the Start here sheet'; $wa.Cells.Item($r2, 1).Font.Bold = $true
  $wcol = 'E', 'F', 'G'; $ccol = 'B', 'C', 'D'
  $labels = 'Number of cities with a value', 'Sum of the group sizes (the weights)', 'Sum of (group size x value)', 'Weighted average = (sum of group size x value) / (sum of the group sizes)', 'Plain average of those cities', 'National value', 'Weighted average minus national', 'Weighted average minus plain average'
  $stride = 11
  for ($j = 0; $j -lt 3; $j++) {
    $s = $r2 + 1 + $stride * $j
    $wa.Cells.Item($s, 1).Formula = "=Variable$($j + 1)"
    for ($k = 0; $k -lt 3; $k++) { $wa.Cells.Item($s, 2 + $k).Value2 = $periodNames[$k] }
    for ($i = 0; $i -lt 8; $i++) { $wa.Cells.Item($s + 1 + $i, 1).Value2 = $labels[$i] }
    for ($k = 0; $k -lt 3; $k++) {
      $col = $ccol[$k]; $wl = $wcol[$k]; $vl = ColLetter (8 + 3 * $j + $k)
      $wr = "'Top 50'!`$$wl`$5:`$$wl`$54"; $vr = "'Top 50'!`$$vl`$5:`$$vl`$54"
      $wa.Cells.Item($s + 1, 2 + $k).Formula = "=COUNT($vr)"
      $wa.Cells.Item($s + 2, 2 + $k).Formula = "=SUMPRODUCT($wr,--ISNUMBER($vr))"
      $wa.Cells.Item($s + 3, 2 + $k).Formula = "=SUMPRODUCT($wr,$vr)"
      $wa.Cells.Item($s + 4, 2 + $k).Formula = "=IFERROR($col$($s + 3)/$col$($s + 2),`"no value for these cities`")"
      $wa.Cells.Item($s + 5, 2 + $k).Formula = "=IFERROR(AVERAGE($vr),`"no value for these cities`")"
      $look = "INDEX(`$B`$6:`$D`$${nvLast},MATCH(`$A`$$s,`$A`$6:`$A`$${nvLast},0),$($k + 1))"
      $wa.Cells.Item($s + 6, 2 + $k).Formula = "=IF($look=`"`",`"`",$look)"
      $wa.Cells.Item($s + 7, 2 + $k).Formula = "=IF(AND(ISNUMBER($col$($s + 4)),ISNUMBER($col$($s + 6))),$col$($s + 4)-$col$($s + 6),`"type the national value in Step 1`")"
      $wa.Cells.Item($s + 8, 2 + $k).Formula = "=IFERROR($col$($s + 4)-$col$($s + 5),`"`")"
    }
    $wa.Range("B$($s + 1):D$($s + 3)").NumberFormat = '#,##0'
    $wa.Range("B$($s + 4):D$($s + 8)").NumberFormat = '[>=1000]#,##0;#,##0.0'
    $wa.Range("A${s}:D${s}").Font.Bold = $true; $wa.Range("A${s}:D${s}").Interior.Color = $headerFill
    $wa.Range("A$($s + 4):D$($s + 4)").Font.Bold = $true
    $wa.Range("A$($s + 4):D$($s + 4)").Interior.Color = 0xDDF2E2
  }
  $r3 = $r2 + 1 + $stride * 3 + 1                            # Step 3 title row
  $wa.Cells.Item($r3, 1).Value2 = 'Step 3. How much of your group lives in these 50 cities?'; $wa.Cells.Item($r3, 1).Font.Bold = $true
  $ch = 'period', 'group residents in these 50 cities', 'group residents in the United States', 'share'
  for ($j = 0; $j -lt 4; $j++) { $wa.Cells.Item($r3 + 1, $j + 1).Value2 = $ch[$j] }
  for ($k = 0; $k -lt 3; $k++) {
    $r = $r3 + 2 + $k; $wl = $wcol[$k]
    $wa.Cells.Item($r, 1).Value2 = $periodNames[$k]
    $wa.Cells.Item($r, 2).Formula = "=SUM('Top 50'!${wl}5:${wl}54)"
    $wa.Cells.Item($r, 3).Formula = "=INDEX(Data!`$${mFirst}`$${usRow}:`$${mLast}`$${usRow},MATCH(Group&`" ($($periodNames[$k]))`",Data!`$${mFirst}`$1:`$${mLast}`$1,0))"
    $wa.Cells.Item($r, 4).Formula = "=IFERROR(B$r/C$r,`"`")"
  }
  $wa.Range("B$($r3 + 2):C$($r3 + 4)").NumberFormat = '#,##0'; $wa.Range("D$($r3 + 2):D$($r3 + 4)").NumberFormat = '0.0%'
  $wa.Range("A$($r3 + 1):D$($r3 + 1)").Font.Bold = $true; $wa.Range("A$($r3 + 1):D$($r3 + 1)").Interior.Color = $headerFill; $wa.Range("A$($r3 + 1):D$($r3 + 1)").WrapText = $true

  $r4 = $r3 + 7
  $wa.Cells.Item($r4, 1).Value2 = 'Check it yourself'; $wa.Cells.Item($r4, 1).Font.Bold = $true
  $wa.Cells.Item($r4 + 1, 1).Value2 = 'Every number above comes from the Top 50 sheet: the group sizes in columns E to G (the weights) and your variables in columns H to P. To calculate a weighted average yourself:'
  $wa.Cells.Item($r4 + 2, 1).Value2 = '1. Multiply each city''s group size by its value, city by city.'
  $wa.Cells.Item($r4 + 3, 1).Value2 = '2. Add up those products (the "Sum of (group size x value)" row).'
  $wa.Cells.Item($r4 + 4, 1).Value2 = '3. Add up the group sizes of the cities that have a value (the "Sum of the group sizes" row).'
  $wa.Cells.Item($r4 + 5, 1).Value2 = '4. Divide the sum from step 2 by the sum from step 3.'
  $wa.Cells.Item($r4 + 6, 1).Value2 = 'In one formula, for Variable 1 in 2000 when every city has a value (type it in any empty cell to check):'
  $wa.Cells.Item($r4 + 7, 1).Value2 = '''=SUMPRODUCT(''Top 50''!E5:E54,''Top 50''!H5:H54)/SUM(''Top 50''!E5:E54)'
  $wa.Cells.Item($r4 + 7, 1).Font.Name = 'Consolas'
  $wa.Cells.Item($r4 + 8, 1).Value2 = 'Some cities have no value for a variable (for example, a police department that did not report crime). Those cities are left out of that variable''s averages.'
  $wa.Columns.Item(1).ColumnWidth = 50; $wa.Range('B:D').ColumnWidth = 22

  # ================= Start here sheet =================
  $start.Range('A1').Value2 = 'Community context workbook'; $start.Range('A1').Font.Bold = $true; $start.Range('A1').Font.Size = 15
  $start.Range('A2').Value2 = 'Where does your group live, and what are those cities like? Choose in the yellow cells, then follow the steps.'
  $start.Range('A4').Value2 = 'Before you start: choose your group and three variables'; $start.Range('A4').Font.Bold = $true
  $lab = 'Group (country of birth)', 'Rank the cities by', 'Variable 1', 'Variable 2', 'Variable 3'
  $init = 'Poland', '2020-2024 survey', 'foreign_born_percent', 'poverty_percent', 'unemployment_percent'
  for ($i = 0; $i -lt 5; $i++) {
    $r = 5 + $i
    $start.Cells.Item($r, 1).Value2 = $lab[$i]
    $start.Cells.Item($r, 3).Value2 = $init[$i]; $start.Cells.Item($r, 3).Font.Bold = $true; $start.Cells.Item($r, 3).Interior.Color = $inputFill
    $start.Cells.Item($r, 3).Validation.Delete()
  }
  [void]$start.Range('C5').Validation.Add(3, 1, 1, '=GroupList')
  [void]$start.Range('C6').Validation.Add(3, 1, 1, ($periodNames -join ','))
  foreach ($a in 'C7', 'C8', 'C9') { [void]$start.Range($a).Validation.Add(3, 1, 1, $varList) }
  $steps = @(
    @(11, 'Task 1. Choose three variables', $true),
    @(12, 'Pick them in the yellow cells above (Variable 1, 2 and 3). Use the arrow at the right of each cell. For Part 2 choose three of the first four; for Part 3 choose the three crime rates.', $false),
    @(14, 'Task 2. Find the cities where most of your group lives', $true),
    @(15, 'Open the Top 50 sheet. It shows the group name and the 50 cities with the most people born in your group, ranked by the period you chose, with the size of your group in each of the three periods.', $false),
    @(16, 'To do it by hand: on the Data sheet, click the arrow on the group_size column for that period and sort largest to smallest. The first 50 rows are your cities.', $false),
    @(18, 'Task 3. Collect the three variables for each city and period', $true),
    @(19, 'The Top 50 sheet also shows, for each city, the three variables you chose in all three periods. These are whole-city values.', $false),
    @(21, 'Task 4. Weighted averages', $true),
    @(22, 'The Weighted averages sheet shows, for each of your variables and each period, the calculation step by step: the sum of the weights, the sum of weight times value, the weighted average, the plain average of the 50 cities, the national value, and the differences.', $false),
    @(23, 'weighted average = SUM(weight x value) / SUM(weight), where the weight is the number of people in your group in that city.', $false),
    @(24, 'Type the national values in the yellow cells (Step 1 on that sheet; foreign_born_percent is filled in). Step 3 shows how much of your group lives in the 50 cities.', $false),
    @(26, 'Tasks 5 and 6 (figures and the written profile) are done outside this workbook: copy the results into your figures and text.', $true),
    @(28, 'Notes', $true),
    @(29, "The Data sheet has everything behind the other sheets: every city ($nCities cities with more than 75,000 residents in 2000, 2006-2010 and 2020-2024), the measures at the three time points, total population, and the size of every group at each time point.", $false),
    @(30, 'If two cities have exactly the same group size, the one with the lower city_code is ranked first. Sorting the Data sheet does not change the Top 50 list.', $false)
  )
  foreach ($s in $steps) { $start.Cells.Item($s[0], 1).Value2 = $s[1]; if ($s[2]) { $start.Cells.Item($s[0], 1).Font.Bold = $true } }
  $start.Columns.Item(1).ColumnWidth = 28; $start.Columns.Item(2).ColumnWidth = 4; $start.Columns.Item(3).ColumnWidth = 34

  $start.Activate()
  $xl.Calculation = -4105
  $xl.CalculateFull()
  $wb.SaveAs($out, 51)
  $wb.Close($false)
  Write-Output "saved $out"
} finally { $xl.Quit(); [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl) }
