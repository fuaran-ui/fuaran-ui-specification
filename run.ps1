#Requires -Version 7.0
# The corpus repository's gate: its resident self-checks. The hosts certify against the corpus in
# their own gates; this runs only what the corpus checks about itself.
# check-enum-token-vectors.mjs is not run here yet: it reports published enum tokens that no fixture
# exercises, and those fixtures come from the reference emitter (Phase 2302).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$failed = @()
foreach ($check in @(
        'validator/check-coverage-selftest.mjs',
        'validator/check-message-parity-selftest.mjs')) {
    $global:LASTEXITCODE = 0
    & node $check
    if ($LASTEXITCODE -ne 0) { $failed += $check }
}
if ($failed.Count -gt 0) {
    Write-Error "corpus self-checks failed: $($failed -join ', ')"
    exit 1
}
exit 0
