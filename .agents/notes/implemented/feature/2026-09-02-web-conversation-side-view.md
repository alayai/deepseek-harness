# Agent Note: Conversation View side pane

Status: implemented

English | [中文](2026-09-02-web-conversation-side-view.zh.md)

## Problem

`conversation.view` tabs are exclusive: the shell renders one View at a time and unmounts the rest. A plugin View such as Elite-Lowcode therefore replaces Chat, so the user cannot send a message while watching that View update. The details column cannot host it: it is occupied by tool inspection, and its width ceiling is 520px.

## Decision

**The Conversation shell keeps one primary View in the existing scrollport and can pin a second registered View into a right-hand pane of the same conversation column.**

- The Conversation store persists `sideView` (the pinned entry id, or null) and `sideRatio` (the primary-pane fraction, clamped to 0.25–0.75) beside the existing `view` preference.
- Each tab that is not the only registered View has a side-open control. Opening a View that is already primary falls the primary back to Chat so the two panes differ. Clicking a tab that is already pinned is a no-op, so the user cannot accidentally full-screen the side View. Closing the pane restores a single primary View.
- The side View portals into a Root-owned mount (`data-conversation-side`) that is a grid sibling of the scrollport. Chat scrolling, the sticky composer, and composer overlays stay in the left column; the side pane is full height, including beside the composer. Transcript width handles hide while the pane is open.
- `openView` that addresses the pinned View writes only the one-shot focus request and leaves the primary View in place, so Inspect-style handoffs into a pinned Trajectory do not collapse the Chat split.

## Alternatives considered

**Rendering the second View in the details column and raising `DETAILS_MAX`.** Rejected: details is a single slot occupied by tool inspection, and mixing an application iframe with call details would collapse both jobs into one width budget.

**A fourth AppFrame column.** Rejected: the need is a second Conversation View, not a new shell region; AppFrame's concession chain and details lifetime stay unchanged.

**Keeping both Views mounted but hidden (`display: none`) instead of a visible split.** That would preserve iframe state across tab switches, but it would not let the user see Chat and the plugin View at once, which is the requested layout.

## Consequences

Users with two or more Conversation Views can keep Chat (or Trajectory) on the left and a plugin View on the right, including across reload of the same Session. Closing the pane still unmounts the side View. The details column remains available for tool inspection at its existing width.
