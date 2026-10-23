// FIXTURE — the DefectCodes table shape, with the severity spelled `Severity.X`.
// One single-line row and one multi-line row, the two layouts the reference uses.
module DefectCodes =
    let table =
        [ row ("EmptyNodeId", "FUARAN-EMPTY-ID", Severity.Error, "a node carries an empty id", "")
          row (
              "UngroundedSwitchStateKey",
              "FUARAN083",
              Severity.Warning,
              "Switch '{nodeId}' has an empty stateKey - it can never resolve a case and is stuck on its default; name the state key the switch selects on",
              "Phase 392"
          ) ]
