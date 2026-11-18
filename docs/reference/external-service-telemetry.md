# Read-only external service observations

An optional host observer can publish timer and last-process-invocation facts
for explicitly registered external participants. This is not a runtime adapter:
OpenRig does not start, stop or authorize the observed service. Native seat
identity, activity and lifecycle remain unchanged. Other external clients are
not automatically services.

Set `OPENRIG_EXTERNAL_SERVICES_DIR` to a trusted read-only directory containing
root-owned `registry.json` and `status/observations.json`. The registry is the
only authority for `{key, rigName, logicalId, host, timer, service,
expectedAttachment: "external_cli"}` bindings. Both documents have `version: 1`;
the registry has a `services` array and observations have an `entries` array.
Each entry carries the exact registry binding, bootId, millisecond observedAt
and lastAttemptAt, nullable error (`probe_failed`), and nullable facts. Facts
are the selected typed systemd Timer/Unit/Service properties. Epoch timestamps
inside facts remain microseconds. No commands, logs, environment or credentials
belong in this interface.

The optional `GET /api/rigs/:id/external-services` route and existing graph,
inventory and detail projections expose observations only for a unique current
nonarchived rig and matching external attachment. Unknown or invalid registry
bindings do not change the native presentation. Missing observations retain
the registered service presentation but report Unavailable. Samples over 180
seconds old are Stale; future samples, old boot identity and malformed inputs
are unavailable. File mtime does not establish freshness. Observations are
collector assertions, not cryptographically attested host truth.

UI distinguishes the timer schedule, current process state, last invocation
exit code/signal, systemd Result and observation age. An inactive oneshot can be
normally waiting between runs. A retained exit code 1 remains visible even if
systemd Result was reset to success. A successful process is not evidence of a
completed workflow or successful trade. There are no service-control actions.
