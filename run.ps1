#Requires -Version 7.0
# The corpus repository's gate: its resident self-checks. The hosts certify against the corpus in
# their own gates; this runs only what the corpus checks about itself.
# check-enum-token-vectors.mjs: every published enum token has a vector (the reference emitter writes them).
# check-family-producers.mjs: every corpus family has a producer record and a spec section (WIRE_FORMAT 27.8).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$failed = @()
foreach ($check in @(
        'validator/check-coverage-selftest.mjs',
        'validator/check-message-parity-selftest.mjs',
        'check-enum-token-vectors.mjs',
        'check-family-producers.mjs')) {
    $global:LASTEXITCODE = 0
    & node $check
    if ($LASTEXITCODE -ne 0) { $failed += $check }
}
if ($failed.Count -gt 0) {
    Write-Error "corpus self-checks failed: $($failed -join ', ')"
    exit 1
}
exit 0
