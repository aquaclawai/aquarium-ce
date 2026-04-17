# A1 Verification — WS subscribe semantics (Phase 23 Wave 0)

**Verified:** 2026-04-17
**Source:** apps/server/src/ws/index.ts lines 115-121

The server's `broadcast(instanceId, message)` function filters on
`client.instanceSubscriptions.has(instanceId)`. Phase 17 broadcasts issue:*
events with the workspace id 'AQ' as the instanceId parameter.

**Implication:** The existing `subscribe(instanceId)` method on
WebSocketContext can be called with the workspace id 'AQ' — NO new
`subscribeWorkspace` method is needed. `issue:created | issue:updated |
issue:deleted | issue:reordered | task:cancelled` events will reach any
client that calls `subscribe('AQ')` on mount.

**Downstream action (Plan 23-01):** On IssuesBoardPage mount, call
`subscribe('AQ')`; on unmount, call `unsubscribe('AQ')`. Keep 'AQ' as an
inline string literal matching the server's `DEFAULT_WORKSPACE_ID` (routes/issues.ts line 23).
