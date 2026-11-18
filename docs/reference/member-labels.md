# Friendly member labels

A rig author can name a responsibility without changing its address:

```yaml
members:
  - id: analyst
    label: "Research Analyst (Due Diligence)"
    # Keep the member's ordinary agent_ref, profile, runtime and cwd fields.
```

The optional RigSpec member `label` already exists. Honor that same field in the
web topology graph, topology table and member detail surfaces. It applies to
managed agents and adopted external service participants alike. For example,
an external scheduler may have the label `Research Schedule (Systemd Service)`.
This is presentation metadata, not evidence that an external process is alive.

## Display contract

- A nonblank label is the primary visible name, rendered as plain text. Trim
  surrounding whitespace for display. Absent, null or blank labels retain the
  existing derived-name fallback. Do not require new configuration.
- Keep the logical/session identity visible as secondary information. Equal
  labels are allowed: addresses and node IDs remain the way to distinguish and
  target seats. Parentheses, ordinary Unicode and punctuation are supported.
- A long label must remain accessible without obscuring its sibling controls.
  Do not interpret label text as HTML or terminal commands.
- Do not change node IDs, member IDs, roles, session names, queue targets,
  workflow ownership, edges, runtime classifications, activity or health status.
- Existing export and snapshot/restore behavior must preserve authored labels.
  No database schema migration is required: node label storage already exists.

## Existing members

Provide a narrow operator path to set or clear the existing node's label without
relaunching it. Use the existing seat resolution, trusted-daemon write boundary,
actor attribution and audit conventions, including adopted external participants.
An actor string is attribution, not authentication or a new per-user security
boundary. Do not widen daemon exposure or weaken its origin checks. A clear restores
the ordinary fallback. A missing or ambiguous seat must not update a sibling.
The operation changes only label metadata, not processes or custody. Keep authored
YAML in sync when it is the deployment source; an override is not a source edit.
The setter accepts a single-line label up to 200 characters; whitespace-only
input clears it. Existing first-start source-consistency checks still apply:
update authored YAML too before retrying a failed first start.

```sh
rig seat set-label research-analyst@project --label "Research Analyst (Due Diligence)" --reason "Explain responsibility" --operator operator@external
rig seat set-label research-analyst@project --clear --reason "Use the normal name" --operator operator@external
```

## Verification

Check the actual daemon graph/inventory projections and composed web surfaces,
not just a schema that accepts `label`. Include absent/blank labels, Unicode,
long labels, duplicate labels with distinct addresses, and literal markup text.
Test labeled managed and external members, persisted readback and clearing, and
verify metadata changes preserve bindings, work and neighboring nodes. Retain
current runtime/health signals. Keep tests isolated from installed daemons,
provider homes and real agent work. Native TUI/cmux/Herdr pane-title changes are
outside this web-display slice.
