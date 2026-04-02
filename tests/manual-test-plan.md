# Aquarium — Manual Test Plan (Milestones v1.0–v1.3)

**Date:** 2026-03-08
**Environment:** Local dev (localhost:5173 / localhost:3001)
**Test Credentials:** OpenAI API key provided; MCP server: https://mcp.gojinko.com

---

## Section 1: Core Platform (v1.0)

### T1.0-01: User Registration & Login
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to /signup | Signup form displayed |
| 2 | Enter email, password, display name | Fields accept input |
| 3 | Click "Sign Up" | Account created, redirected to dashboard |
| 4 | Log out | Redirected to login page |
| 5 | Log in with created credentials | Dashboard displayed with instance list |

### T1.0-02: Instance Creation via Wizard
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Create Instance" on dashboard | Wizard opens at provider step |
| 2 | Select "OpenAI" provider | Credential step shown |
| 3 | Enter OpenAI API key | Key accepted, model step shown |
| 4 | Select model (e.g. gpt-4o) | Confirm step shown |
| 5 | Enter instance name, click Create | Instance created, startup progress shown |
| 6 | Wait for instance to reach "running" | Status indicator turns green |

### T1.0-03: Dashboard Instance List
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Return to dashboard | Created instance visible in grid |
| 2 | Verify status badge | Shows "running" with green indicator |
| 3 | Click instance card | Navigates to instance detail page |

### T1.0-04: Instance Overview Tab
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | View Overview tab | Shows provider, model, status, uptime |
| 2 | Verify provider shows "OpenAI" | Correct provider displayed |
| 3 | Verify model shows selected model | Correct model displayed |

### T1.0-05: Credentials Tab
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Credentials tab | Shows stored credentials |
| 2 | Verify OpenAI API key is listed | Key shown (masked) |
| 3 | Click "Add Credential" | Form opens |
| 4 | Add a test credential | Saved successfully |
| 5 | Delete test credential | Removed from list |

---

## Section 2: Channel Management (v1.1)

### T1.1-01: Channels Tab — View Status
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Channels tab | Channel list shown |
| 2 | View channel status icons | Shows connected/disconnected/error per channel |
| 3 | Status updates live (no manual refresh) | Real-time via WebSocket |

### T1.1-02: Channel Enable/Disable
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Find a disabled channel (e.g., Discord) | Shows disabled state |
| 2 | Toggle enable switch | Channel enabled via config.patch (no restart) |
| 3 | Toggle disable switch | Channel disabled via config.patch |

### T1.1-03: Channel DM/Group Policy
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Select a channel with policy options | Policy settings visible |
| 2 | Change DM policy (e.g., open → pairing) | Saved via config.patch |
| 3 | Change group policy | Saved via config.patch |

### T1.1-04: Config Patch Hot-Reload
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Make any channel config change | Change applied without pod restart |
| 2 | Verify instance stays "running" | No restart/downtime |

---

## Section 3: Direct Chat & Sessions (v1.2)

### T1.2-01: Chat Tab — Basic Conversation
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Chat tab | Chat interface displayed with input box |
| 2 | Type "Hello, what can you do?" | Message appears in chat |
| 3 | Press Enter/Send | Streaming response begins |
| 4 | Observe token-by-token rendering | Response streams in real-time |
| 5 | Response completes | Full response displayed, input re-enabled |

### T1.2-02: Chat — Tool Call Display
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Ask agent to use a tool (if MCP configured) | Tool call block shown inline |
| 2 | Tool result displayed | Result visible in message |

### T1.2-03: Chat — Thinking Display
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | If using extended thinking model, send message | Thinking block shown |
| 2 | Thinking collapses after response | Expandable thinking section |

### T1.2-04: Sessions Tab — List Sessions
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Sessions tab | Session list displayed |
| 2 | Verify chat session appears | Shows session with last activity |
| 3 | Click a session | Session history loads |

### T1.2-05: Sessions — Resume Session
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Select a previous session | History displayed |
| 2 | Click "Resume" or navigate to chat | Chat resumes in that session context |
| 3 | Send a follow-up message | Agent has conversation context |

### T1.2-06: Sessions — Edit Parameters
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click edit on a session | Edit form shown |
| 2 | Change session label | Label updated |
| 3 | Change model (if available) | Model updated via sessions.patch |

---

## Section 4: Runtime Management (v1.3)

### T1.3-01: Gateway Config Editor
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Gateway Config" tab | Monaco editor loads with current config |
| 2 | Config has syntax highlighting | JSON/YAML highlighted |
| 3 | Make a valid edit | No error markers |
| 4 | Make an invalid edit | Error markers appear |
| 5 | Save valid edit | Config applied via config.patch |
| 6 | Verify diff preview | Shows changes before apply |

### T1.3-02: MCP Server Management
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "MCP Servers" tab | MCP server list displayed |
| 2 | Click "Add MCP Server" | Add form opens |
| 3 | Enter server name, URL (https://mcp.gojinko.com) | Form accepts input |
| 4 | Configure env vars | Env var fields work |
| 5 | Save MCP server | Server added to list |
| 6 | Toggle enable/disable | Status changes |
| 7 | Edit server config | Edit form opens, saves correctly |
| 8 | Remove MCP server | Server removed with confirmation |

### T1.3-03: Cron Job Management
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Cron" tab | Cron job list displayed |
| 2 | Click "Create Job" | Creation form opens |
| 3 | Enter name, schedule, prompt | Fields accept input |
| 4 | Select from preset schedules | Presets available |
| 5 | Save cron job | Job appears in list |
| 6 | Edit cron job | Edit form works |
| 7 | Delete cron job | Removed with confirmation |

### T1.3-04: Skills Management
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click "Skills" tab | Skills list displayed |
| 2 | View installed skills | Shows name, type, status |
| 3 | Toggle enable/disable on a skill | Skill state changes |
| 4 | Install a new skill (if available) | Install flow works |
| 5 | Uninstall a skill | Removed with confirmation |

---

## Section 5: General Functionality

### T5-01: Instance Lifecycle
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Stop a running instance | Status changes to "stopping" → "stopped" |
| 2 | Start a stopped instance | Status changes to "starting" → "running" |
| 3 | Delete an instance | Instance removed from dashboard |

### T5-02: Workspace Tab
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Workspace tab | File list shown (SOUL.md, agents.list, etc.) |
| 2 | Edit SOUL.md | Editor opens, content editable |
| 3 | Save changes | Changes persisted |

### T5-03: Logs Tab
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Logs tab | Real-time pod logs stream |
| 2 | Logs auto-scroll | New entries appear at bottom |

### T5-04: Health Tab
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Health tab | Pod health metrics shown |
| 2 | Probe status visible | Startup/liveness/readiness probes shown |

### T5-05: Events Tab
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Click Events tab | Event history displayed |
| 2 | Events include instance lifecycle | Startup, config changes visible |

### T5-06: Templates Marketplace
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to /templates | Template list displayed |
| 2 | Search/filter templates | Filtering works |
| 3 | Click "Use Template" | Instantiate modal opens |

### T5-07: Dark/Light Mode
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Toggle theme | UI switches between dark and light mode |
| 2 | All components render correctly | No broken styles |

### T5-08: Profile Page
| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to /profile | Profile form displayed |
| 2 | Edit display name | Saved successfully |

---

## Test Environment Notes

- **OpenAI API Key:** Pre-configured in credential store
- **MCP Server:** https://mcp.gojinko.com (for MCP Server Management tests)
- **Browser:** Chrome with DevTools remote debugging
- **Screenshots:** Captured at each major validation point
