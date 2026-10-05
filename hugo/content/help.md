---
title: "A guide to connected thinking"
---

Visual Nerve saves diagrams in this browser profile. Before the workspace opens, you must accept local browser storage and offline app caching; it cannot work without this storage. Open **New diagram** and choose a blank canvas or a template. One graph can be viewed as a mind map, flowchart, timeline, process or responsibility flow; changing its mode keeps the underlying nodes and relationships.

## Move around

Scroll to zoom. Hold Space and drag to pan, or use the middle/right mouse button. Drag the canvas to select a box of nodes. Hold Shift, Ctrl or Cmd to extend selection. **F** fits the graph; the crosshair below the canvas centers your selection. The minimap is pannable and zoomable. Use the grid and magnet controls to toggle dots and snapping.

On a phone, drag the empty canvas with one finger to pan and pinch with two fingers to zoom. Tap the menu beside the project name to open the project list. Tap the properties button or **Edit** in the selection actions to open details in a bottom panel. The **…** menu contains layout, connections, filters and settings. Tap outside a panel or its close button to return to the canvas.

## Edit your graph

Use **Add node**, choose a type, and edit its title and details in the properties panel. Drag between node handles to connect them, or use the toolbar connection button. Select an edge to change its label, direction, relationship, description or style. Drag an edge endpoint to reconnect it. Select a node and drag a corner handle to resize it.

Click the project name to rename it; Enter saves and Escape cancels. With no item selected, **F2** also opens the project name. Choose a project icon beside its name. Select an item for quick **Edit**, **Color**, **Icon**, duplicate and delete actions. The icon picker includes sixteen areas and supports searching in English or Swedish. Icons are also available in properties and are preserved in JSON, copying and image exports.

Mind maps have a central idea, colored curved branches and rounded topic backgrounds at every depth. Each main branch has its own color, inherited by its descendants; setting a topic's color changes that part of the branch. Double-click a topic or press **F2** to edit its text directly; Enter saves and Escape cancels. Use the **+** beside a topic or **Add subtopic** in the toolbar to extend it. **Tab** adds a child and **Enter** adds a sibling, immediately opening the new topic for typing; a sibling keeps the same side of the map. While typing, **Tab** saves and creates another child, so you can build many levels without switching to properties. The view follows the new topic. New topics avoid occupied rows while retaining existing manual positions.

**Focus map** hides the workspace panels and fits the mind map to the available space. You can still edit topics directly, add branches, search, save and export. **Exit focus** restores the diagram list and properties panel.

Use **Parent / container** to reparent without changing node IDs. The circle beside a branch collapses or expands its descendants. Select multiple nodes and use Ctrl/Cmd+G to group them; Ctrl/Cmd+Shift+G ungroups. Groups move their descendants together.

Arrow keys nudge selected nodes; Shift increases the distance. Ctrl/Cmd+C, V and D copy, paste and duplicate, preserving metadata and internal edges while assigning fresh UUIDs. **Delete** or the trash button removes selected items, retaining unselected children. **Delete branch** or **Shift+Delete** removes the selected topic and all its descendants. Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z undo and redo complete gestures and edits, including deletion.

## Owners, search and filters

**Owners** creates people, teams, departments, systems and organizations with colors and contact details. Select a node to assign one or more owners. Ctrl/Cmd+F or K opens global search across diagrams, node details, tags, owners and metadata. A node result opens its diagram, selects the object and centers the view.

**Filters** narrows by owner, status, type, tag or date. Choose dim or hide; filtering never deletes objects. The diagram list supports folder paths, tags, favorites, sorting and recently edited diagrams. Set folder, tags and favorite in diagram properties with no object selected.

## Layout and timelines

Mind maps default to **Balanced branches**, which places main topics on both sides of the central idea and reserves space for their subtopics. For an existing map, choose **Auto layout** to apply it. Four directional layouts and radial placement are also available. Layout is an explicit, undoable operation, and topics remain freely draggable; spatial groups retain their manually arranged contents in balanced mode. Changing diagram mode changes the presentation while preserving node types, parent relationships and positions. Timeline mode uses start/end dates for horizontal placement; its zoom selector offers day, week, month, quarter and year. Dragging changes dates and vertical lanes. Timeline objects retain graph connections.

## Save and work offline

The editor saves changes immediately in this browser's IndexedDB. **Saved** means the local database transaction committed. The server and internet can be unavailable while you edit, create projects, search and export. After the first visit the production app can reload offline. Use the same browser profile and address to return to the same workspace.

Changes from other tabs appear through local database updates. A version conflict preserves your unsaved edits in the current tab and offers **Save local copy**, **Use saved version** or **Replace saved version**. Resolve it before closing the tab.
## Exchange and backups

JSON is the complete restorable format, including owners, metadata, hierarchy, layout and viewport. Markdown exports semantic outlines and process relationships. Import accepts Visual Nerve JSON, headings/lists in Markdown and CSV with a title column. PNG exports viewport, selection or full graph at 1×, 2× or 4×. PDF supports A4/A3, portrait/landscape and tiled pages. Complete rendered exports include collapsed and off-screen objects.

Settings controls theme and **Data & Privacy**. **Export all data** downloads a dated complete backup of projects, owners, portable settings and templates. **Restore backup** previews Merge (keep current diagrams) or Replace (remove current work, requiring confirmation). Connection grants and storage acceptance are never imported. **Export diagram** remains a separate PNG/PDF/Markdown/JSON choice.

Clearing site data, resetting a browser profile or uninstalling the browser may remove work. Private/incognito sessions may discard it on closing. Another browser/profile/device, or a different website address, opens an independent workspace; nothing synchronizes automatically. Export a backup to move or keep a copy. Storage details shows estimated usage and, after you create a diagram, an optional browser retention request. A grant cannot prevent manual clearing or guarantee retention. Global deletion is separately confirmed under Data & Privacy. [How your data is stored](/privacy/).

## Codex and MCP

MCP access is **Off** by default. Start a bridge on your own computer with `--bridge`, then choose **Read only** or **Read + write** in Settings. Visual Nerve must remain open. Tools can read content you grant access to and, with write access, change it. Read-only commands cannot mutate or elevate access. Turning it Off or closing the browser stops access; the bridge keeps no database or cloud copy.

```text
Codex → local MCP bridge → your active browser → IndexedDB
```

For an app hosted at a public HTTPS address, start the loopback bridge with `--allowed-origin https://YOUR-APP-DOMAIN`. Some browsers require local network permission or secure WebSockets: use `--tls-cert` and `--tls-key` with a certificate your browser trusts, and set `wss://127.0.0.1:4317/bridge` under **Local connection details**. Connections can only target this computer. An optional token configured through `VISUAL_NERVE_BRIDGE_TOKEN` lasts for the browser session when entered in Settings. The public website has no content API. The reference at **/api/docs** describes the optional local bridge.
