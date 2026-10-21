param([Parameter(Mandatory=$true)][string]$VaultPath)
# Памочнік сховішча сакрэтаў: DPAPI бягучага карыстальніка Windows.
# read  -> JSON-мапа ўсіх сакрэтаў ({} калі файла няма)
# write -> зашыфраваць і атамарна замяніць файл
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.action -eq 'read') {
        if (-not (Test-Path -LiteralPath $VaultPath)) { '{}'; exit 0 }
        $secure = [IO.File]::ReadAllText($VaultPath) | ConvertTo-SecureString
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    } elseif ($request.action -eq 'write') {
        $plain = ConvertTo-Json -InputObject $request.values -Compress -Depth 10
        $cipher = ConvertFrom-SecureString -SecureString (ConvertTo-SecureString -String $plain -AsPlainText -Force)
        $temp = $VaultPath + '.tmp'
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($VaultPath)) | Out-Null
        [IO.File]::WriteAllText($temp, $cipher)
        if (Test-Path -LiteralPath $VaultPath) { [IO.File]::Replace($temp, $VaultPath, [NullString]::Value) }
        else { [IO.File]::Move($temp, $VaultPath) }
        'null'
    } else { exit 2 }
} catch { exit 3 }
