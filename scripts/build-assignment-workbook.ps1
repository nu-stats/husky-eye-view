# Builds the student workbook for the community-context assignment (needs Excel on Windows):
#   course/assignments/data/community-context-workbook.xlsx
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
$P = '"2000 Census","2006-2010 survey","2020-2024 survey"'   # period labels used in formulas
$periodNames = '2000 Census', '2006-2010 survey', '2020-2024 survey'
$headerFill = 0xEBDDD0; $inputFill = 0x99FFFF

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Add()
  while ($wb.Worksheets.Count -lt 6) { [void]$wb.Worksheets.Add([Type]::Missing, $wb.Worksheets.Item($wb.Worksheets.Count)) }
  $names = 'Start here', 'Cities', 'Top 50', 'Group 2000', 'Group 2006-10', 'Group 2020-24'
  for ($i = 0; $i -lt 6; $i++) { $wb.Worksheets.Item($i + 1).Name = $names[$i] }
  $start = $wb.Worksheets.Item(1); $cty = $wb.Worksheets.Item(2); $top = $wb.Worksheets.Item(3)

  # ---- group data sheets (one per period) ----
  $groupSheets = @(@('Group 2000', 'group-2000.tsv'), @('Group 2006-10', 'group-2006_10.tsv'), @('Group 2020-24', 'group-2020_24.tsv'))
  $nCols = 0; $nRows = 0
  foreach ($g in $groupSheets) {
    $ws = $wb.Worksheets.Item($g[0])
    $lines = [IO.File]::ReadAllLines((Join-Path $DataFolder $g[1]))
    $nRows = $lines.Count; $nCols = $lines[0].Split("`t").Count
    $arr = New-Object 'object[,]' $nRows, $nCols
    for ($r = 0; $r -lt $nRows; $r++) {
      $f = $lines[$r].Split("`t")
      for ($c = 0; $c -lt $nCols; $c++) { if ($r -eq 0 -or $c -eq 0) { $arr[$r, $c] = $f[$c] } else { $arr[$r, $c] = [double]$f[$c] } }
    }
    $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item($nRows, 1)).NumberFormat = '@'
    $ws.Range($ws.Cells.Item(1, 1), $ws.Cells.Item($nRows, $nCols)).Value2 = $arr
    $ws.Range($ws.Cells.Item(2, 2), $ws.Cells.Item($nRows, $nCols)).NumberFormat = '#,##0'
    $ws.Rows.Item(1).Font.Bold = $true; $ws.Rows.Item(1).Interior.Color = $headerFill
    $ws.Rows.Item($nRows).Font.Bold = $true
    $ws.Columns.Item(1).ColumnWidth = 12
    $ws.Range($ws.Cells.Item(1, 2), $ws.Cells.Item(1, $nCols)).ColumnWidth = 14
    $ws.Range($ws.Cells.Item(1, 2), $ws.Cells.Item(1, $nCols)).WrapText = $true
  }
  $nCounties = $nRows - 2          # data rows 2 .. nCounties+1 ; the last row is the United States total
  $lastRow = $nCounties + 1        # 648
  $usRow = $nRows                  # 649
  $lastCol = ColLetter $nCols      # last group column letter

  # ---- names ----
  [void]$wb.Names.Add('Group', "='Start here'!`$C`$5")
  [void]$wb.Names.Add('RankPeriod', "='Start here'!`$C`$6")
  [void]$wb.Names.Add('GroupList', "='Group 2000'!`$B`$1:`$${lastCol}`$1")

  # ---- Cities sheet ----
  $csv = Import-Csv $csvPath
  $heads = $csv[0].PSObject.Properties.Name
  $nc = $heads.Count                                   # 21 data columns
  $arr = New-Object 'object[,]' ($csv.Count + 1), $nc
  for ($c = 0; $c -lt $nc; $c++) { $arr[0, $c] = $heads[$c] }
  for ($r = 0; $r -lt $csv.Count; $r++) {
    for ($c = 0; $c -lt $nc; $c++) {
      $v = $csv[$r].($heads[$c])
      if ($c -le 2) { $arr[($r + 1), $c] = $v } else { $arr[($r + 1), $c] = [double]$v }
    }
  }
  $cty.Range($cty.Cells.Item(1, 1), $cty.Cells.Item($csv.Count + 1, 1)).NumberFormat = '@'
  $cty.Range($cty.Cells.Item(1, 1), $cty.Cells.Item($csv.Count + 1, $nc)).Value2 = $arr
  $extra = 'group_count_2000', 'group_count_2006_10', 'group_count_2020_24', 'ranking_count', 'group_rank', 'tie_break_helper'
  for ($i = 0; $i -lt 6; $i++) { $cty.Cells.Item(1, $nc + 1 + $i).Value2 = $extra[$i] }
  $cV = ColLetter ($nc + 1); $cW = ColLetter ($nc + 2); $cX = ColLetter ($nc + 3); $cY = ColLetter ($nc + 4); $cZ = ColLetter ($nc + 5); $cAA = ColLetter ($nc + 6)
  $gsheets = "'Group 2000'", "'Group 2006-10'", "'Group 2020-24'"
  for ($k = 0; $k -lt 3; $k++) {
    $s = $gsheets[$k]; $col = ColLetter ($nc + 1 + $k)
    $f = "=INDEX($s!`$B`$2:`$$lastCol`$$lastRow,MATCH(`$A2,$s!`$A`$2:`$A`$$lastRow,0),MATCH(Group,$s!`$B`$1:`$$lastCol`$1,0))"
    $cty.Range("${col}2:${col}$lastRow").Formula = $f
  }
  $cty.Range("${cY}2:${cY}$lastRow").Formula = "=CHOOSE(MATCH(RankPeriod,{$P},0),${cV}2,${cW}2,${cX}2)"
  # Ties are broken by city code (lowest first), so the list does not change if the sheet is sorted.
  $cty.Range("${cAA}2:${cAA}$lastRow").Formula = "=${cY}2-VALUE(`$A2)/10^7"
  $cty.Range("${cZ}2:${cZ}$lastRow").Formula = "=RANK(${cAA}2,`$${cAA}`$2:`$${cAA}`$$lastRow)"
  $cty.Range("${cAA}2:${cAA}$lastRow").NumberFormat = '0.0000000'
  $cty.Range("${cAA}1:${cAA}$lastRow").Font.Color = 0x808080
  $cty.Range("D2:${cZ}$lastRow").NumberFormat = '#,##0.0'
  foreach ($c in 4, 5, 9, 10, 14, 15) { $cty.Range($cty.Cells.Item(2, $c), $cty.Cells.Item($lastRow, $c)).NumberFormat = '#,##0' }
  $cty.Range("${cV}2:${cY}$lastRow").NumberFormat = '#,##0'
  $cty.Range("${cZ}2:${cZ}$lastRow").NumberFormat = '0'
  $cty.Range("${cV}1:${cZ}1").Interior.Color = 0xCCE5CC
  $cty.Rows.Item(1).Font.Bold = $true; $cty.Rows.Item(1).WrapText = $true
  $cty.Range("A1:${cV}1").Interior.Color = $headerFill
  $cty.Range("${cV}1:${cZ}1").Interior.Color = 0xCCE5CC
  $cty.Columns.Item(1).ColumnWidth = 12; $cty.Columns.Item(2).ColumnWidth = 24; $cty.Columns.Item(3).ColumnWidth = 18
  $cty.Range("D:${cZ}").ColumnWidth = 14
  $cty.Rows.Item(1).RowHeight = 48
  [void]$cty.Range("A1:${cAA}$lastRow").AutoFilter()
  $cty.Activate(); $xl.ActiveWindow.FreezePanes = $false; $cty.Range('D2').Select(); $xl.ActiveWindow.FreezePanes = $true

  # ---- Top 50 sheet ----
  $top.Range('A1').Formula = '="Top 50 cities for: "&Group&", ranked by "&RankPeriod'
  $top.Range('A1').Font.Bold = $true; $top.Range('A1').Font.Size = 13
  $top.Range('A2').Value2 = 'Change the group or the ranking period on the Start here sheet. Group counts are the weights for the weighted averages below.'
  $top.Range('A4').Value2 = 'rank'; $top.Range('B4').Value2 = 'city_code'; $top.Range('C4').Value2 = 'city'; $top.Range('D4').Value2 = 'state'
  $top.Range('E4:G4').Formula = "=Cities!${cV}1"
  $top.Range('H4:V4').Formula = '=Cities!D1'
  for ($r = 5; $r -le 54; $r++) { $top.Cells.Item($r, 1).Value2 = $r - 4 }
  $top.Range('B5:B54').Formula = "=INDEX(Cities!`$A`$2:`$A`$$lastRow,MATCH(`$A5,Cities!`$${cZ}`$2:`$${cZ}`$$lastRow,0))"
  $top.Range('C5:C54').Formula = "=INDEX(Cities!`$B`$2:`$B`$$lastRow,MATCH(`$B5,Cities!`$A`$2:`$A`$$lastRow,0))"
  $top.Range('D5:D54').Formula = "=INDEX(Cities!`$C`$2:`$C`$$lastRow,MATCH(`$B5,Cities!`$A`$2:`$A`$$lastRow,0))"
  $top.Range('E5:G54').Formula = "=INDEX(Cities!${cV}`$2:${cV}`$$lastRow,MATCH(`$B5,Cities!`$A`$2:`$A`$$lastRow,0))"
  $top.Range('H5:V54').Formula = "=INDEX(Cities!D`$2:D`$$lastRow,MATCH(`$B5,Cities!`$A`$2:`$A`$$lastRow,0))"
  $top.Range('E5:G54').NumberFormat = '#,##0'; $top.Range('H5:V54').NumberFormat = '#,##0.0'
  foreach ($c in 'H', 'I', 'M', 'N', 'R', 'S') { $top.Range("${c}5:${c}54").NumberFormat = '#,##0' }
  $top.Range('A4:V4').Font.Bold = $true; $top.Range('A4:V4').Interior.Color = $headerFill; $top.Range('A4:V4').WrapText = $true
  $top.Rows.Item(4).RowHeight = 48
  $top.Columns.Item(1).ColumnWidth = 7; $top.Columns.Item(2).ColumnWidth = 12; $top.Columns.Item(3).ColumnWidth = 24; $top.Columns.Item(4).ColumnWidth = 18
  $top.Range('E:V').ColumnWidth = 14

  # weighted averages
  $top.Range('A57').Value2 = 'Weighted averages for these 50 cities (weights = group_count for each period)'
  $top.Range('A57').Font.Bold = $true; $top.Range('A57').Font.Size = 12
  $top.Range('A58').Value2 = 'Pick three variables in the yellow cells, then read the results.'
  $hdr = 'variable', 'period', 'weighted average', 'unweighted mean of the 50 cities', 'national value', 'weighted minus national', 'weighted minus unweighted'
  for ($j = 0; $j -lt 7; $j++) { $top.Cells.Item(59, $j + 1).Value2 = $hdr[$j] }
  $vars = 'foreign_born_percent', 'poverty_percent', 'unemployment_percent'
  $pm = "MATCH(`$B@R@,{$P},0)"
  for ($v = 0; $v -lt 3; $v++) {
    for ($k = 0; $k -lt 3; $k++) {
      $r = 60 + 3 * $v + $k
      if ($k -eq 0) { $top.Cells.Item($r, 1).Value2 = $vars[$v] } else { $top.Cells.Item($r, 1).Formula = "=`$A$(60 + 3 * $v)" }
      $top.Cells.Item($r, 2).Value2 = $periodNames[$k]
      $top.Cells.Item($r, 9).Formula = "=`$A$r&CHOOSE($($pm.Replace('@R@', "$r")),`"_2000`",`"_2006_10`",`"_2020_24`")"
      $w = "INDEX(`$E`$5:`$G`$54,0,$($pm.Replace('@R@', "$r")))"
      $val = "INDEX(`$H`$5:`$V`$54,0,MATCH(`$I$r,`$H`$4:`$V`$4,0))"
      $top.Cells.Item($r, 3).Formula = "=IFERROR(SUMPRODUCT($w,$val)/SUM($w),`"no group residents`")"
      $top.Cells.Item($r, 4).Formula = "=AVERAGE($val)"
      $top.Cells.Item($r, 5).Formula = "=IF(INDEX(`$B`$78:`$D`$81,MATCH(`$A$r,`$A`$78:`$A`$81,0),MATCH(`$B$r,`$B`$77:`$D`$77,0))=`"`",`"`",INDEX(`$B`$78:`$D`$81,MATCH(`$A$r,`$A`$78:`$A`$81,0),MATCH(`$B$r,`$B`$77:`$D`$77,0)))"
      $top.Cells.Item($r, 6).Formula = "=IF(AND(ISNUMBER(C$r),ISNUMBER(E$r)),C$r-E$r,`"enter national value below`")"
      $top.Cells.Item($r, 7).Formula = "=IFERROR(C$r-D$r,`"`")"
    }
    $cell = $top.Cells.Item(60 + 3 * $v, 1)
    $cell.Interior.Color = $inputFill
    $cell.Validation.Delete()
    [void]$cell.Validation.Add(3, 1, 1, 'population,foreign_born_percent,poverty_percent,unemployment_percent')
  }
  $top.Range('C60:D68').NumberFormat = '#,##0.0'; $top.Range('E60:G68').NumberFormat = '#,##0.0'
  $top.Range('I59').Value2 = 'column used (helper)'; $top.Range('I59:I68').Font.Color = 0x808080
  $top.Range('A59:G59').Font.Bold = $true; $top.Range('A59:G59').Interior.Color = $headerFill; $top.Range('A59:G59').WrapText = $true

  # coverage
  $top.Range('A70').Value2 = "Share of the group's U.S. residents who live in these 50 cities"; $top.Range('A70').Font.Bold = $true
  $ch = 'period', 'group residents in these 50 cities', 'group residents in the United States', 'share'
  for ($j = 0; $j -lt 4; $j++) { $top.Cells.Item(71, $j + 1).Value2 = $ch[$j] }
  for ($k = 0; $k -lt 3; $k++) {
    $r = 72 + $k; $col = ColLetter (5 + $k); $s = $gsheets[$k]
    $top.Cells.Item($r, 1).Value2 = $periodNames[$k]
    $top.Cells.Item($r, 2).Formula = "=SUM(${col}5:${col}54)"
    $top.Cells.Item($r, 3).Formula = "=INDEX($s!`$B`$${usRow}:`$$lastCol`$${usRow},MATCH(Group,$s!`$B`$1:`$$lastCol`$1,0))"
    $top.Cells.Item($r, 4).Formula = "=IFERROR(B$r/C$r,`"`")"
  }
  $top.Range('B72:C74').NumberFormat = '#,##0'; $top.Range('D72:D74').NumberFormat = '0.0%'
  $top.Range('A71:D71').Font.Bold = $true; $top.Range('A71:D71').Interior.Color = $headerFill; $top.Range('A71:D71').WrapText = $true

  # national values
  $top.Range('A76').Value2 = 'National values: type the U.S. figure for each period in the yellow cells (foreign_born_percent is filled in)'; $top.Range('A76').Font.Bold = $true
  $top.Range('A77').Value2 = 'variable'
  for ($k = 0; $k -lt 3; $k++) { $top.Cells.Item(77, 2 + $k).Value2 = $periodNames[$k] }
  $nv = 'population', 'foreign_born_percent', 'poverty_percent', 'unemployment_percent'
  for ($i = 0; $i -lt 4; $i++) { $top.Cells.Item(78 + $i, 1).Value2 = $nv[$i] }
  $top.Range('B79').Value2 = 11.1; $top.Range('C79').Value2 = 12.7; $top.Range('D79').Value2 = 14.1
  foreach ($a in 'B78:D78', 'B80:D81') { $top.Range($a).Interior.Color = $inputFill }
  $top.Range('A77:D77').Font.Bold = $true; $top.Range('A77:D77').Interior.Color = $headerFill
  $top.Range('B78:D81').NumberFormat = '#,##0.0'

  # ---- Start here ----
  $start.Range('A1').Value2 = 'Community context workbook'; $start.Range('A1').Font.Bold = $true; $start.Range('A1').Font.Size = 15
  $start.Range('A2').Value2 = 'Where does your group live, and what are those cities like? Follow the steps from top to bottom.'
  $start.Range('A4').Value2 = 'Before you start: choose your group'; $start.Range('A4').Font.Bold = $true
  $start.Range('A5').Value2 = 'Group (country of birth)'; $start.Range('C5').Value2 = 'Poland'
  $start.Range('A6').Value2 = 'Rank the cities by'; $start.Range('C6').Value2 = '2020-2024 survey'
  foreach ($a in 'C5', 'C6') { $start.Range($a).Interior.Color = $inputFill; $start.Range($a).Font.Bold = $true }
  $start.Range('C5').Validation.Delete(); [void]$start.Range('C5').Validation.Add(3, 1, 1, '=GroupList')
  $start.Range('C6').Validation.Delete(); [void]$start.Range('C6').Validation.Add(3, 1, 1, '2000 Census,2006-2010 survey,2020-2024 survey')
  $steps = @(
    @(8, 'Task 1. Choose three variables', $true),
    @(9, 'On the Top 50 sheet, scroll to Weighted averages (row 57) and pick your three variables in the yellow cells.', $false),
    @(11, 'Task 2. Find the cities where most of your group lives', $true),
    @(12, 'To do it by hand: on the Cities sheet, click the arrow on the group count column for the period you chose and sort largest to smallest. The first 50 rows are your cities.', $false),
    @(13, 'To let the workbook do it: open the Top 50 sheet. It lists the 50 cities with the highest group count in the period you chose.', $false),
    @(15, 'Task 3. Collect the three variables for each city and period', $true),
    @(16, 'The Top 50 sheet shows, for each city, the group count (the weight) and every variable for all three periods. These are whole-city values.', $false),
    @(18, 'Task 4. Weighted averages', $true),
    @(19, 'The Weighted averages block gives, for each variable and period, the weighted average, the unweighted mean of the 50 cities, and the difference from the national value.', $false),
    @(20, 'weighted average = SUM(weight x value) / SUM(weight), where the weight is the number of people in your group in that city.', $false),
    @(21, 'Type the national value for each variable and period in the yellow cells (foreign_born_percent is filled in).', $false),
    @(23, 'Tasks 5 and 6 (figures and the written profile) are done outside this workbook: copy the results into your figures and text.', $true),
    @(25, 'Notes', $true),
    @(26, 'Cities are those with more than 75,000 residents in 2000, 2006-2010 and 2020-2024 (343 cities).', $false),
    @(28, 'If two cities have exactly the same group count, the one with the lower city_code is ranked first. Sorting the Cities sheet does not change the Top 50 list.', $false)
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
