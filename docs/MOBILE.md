# Using Visual Nerve on a phone

The compact workspace keeps the diagram visible and opens longer controls only when needed. It applies on phone-sized screens and short landscape windows. Portrait and landscape use the same saved diagram and simulation model; changing the screen size does not change nodes, connections or assumptions.

## Projects and editing

Use **Projects** to open another diagram, create one or import a file. The project drawer closes when you choose a diagram. Use its close button, tap the dimmed background or press Escape to return to the canvas.

Tap a node to select it, then **Edit** to inspect its title, description, status and other properties. Properties appear in a scrollable sheet instead of permanently reducing the diagram width. Close the sheet or press Escape when finished. Changes save locally through the same editor used on larger screens. Selecting a projected simulator capacity card still refers to its shared logical Work/Resource; capacity-unit cards do not become independently editable simulation objects.

Use **Diagram actions** for export, the diagram player, settings, new diagrams and advanced tools. Actions open a menu that stays within the screen and can scroll. Dialogs keep their heading and close action visible while long forms scroll. Escape dismisses a menu or dismissible dialog and returns focus to its opening control.

Drag empty canvas space with one finger to pan, and pinch to zoom. A newly opened Process Simulator starts near its first Work node when there is no saved touch viewport, keeping the cards readable. **Fit diagram** shows the whole process; pan or pinch to inspect a part again. Saved positions remain unchanged. Canvas options contain grid, snapping and centering; the drawing control remains directly available. Compact mode also works in landscape, keeping desktop sidebars out of the available canvas area.

In 2D, a two-finger gesture also works when it starts over a node or its scrollable code/process details. Place both fingers before moving them; the view follows their midpoint without moving the node. Lift both fingers before starting another node drag or content scroll. If a one-finger native scroll is already underway, finish it before starting a pinch.

## Process Simulator

The compact simulation strip keeps **Play**, **Pause** and simulated time available beside the canvas. **Simulation details** opens the longer controls:

- **Run settings** selects speed, duration, seed and scenario, and opens Assumptions. **Run simulation** starts or resumes the chosen run and returns to the canvas.
- **Metrics** shows the same live population, queues, utilization and economics as the API. Large comparison tables scroll within the panel.
- **Replay & compare** selects saved runs and simulated moments and compares scenario outcomes.

In **Assumptions**, **Settings section** chooses Nodes, Connections, Particles, Resources, Improvements, Economics or Complete model. The existing semantic fields and validation apply on every screen size. **Apply assumptions** saves the model or selected scenario; scenario edits preserve Baseline. Every configuration remains accessible through the existing simulation API and MCP. Responsive controls do not introduce a separate model, worker or execution engine.

## 3D and walkthroughs

Use **3D** to show the same styled logical diagram in relief. Compact navigation keeps Return to 2D, Fit and Help accessible. **3D tools** contains object movement, orientations and other controls. **Show 3D handles** expands the camera gizmo; **Hide 3D handles** clears that space again. Help starts collapsed in compact mode. Simulator particles and full capacity-card banks remain in 2D; numeric simulation metrics are still available while viewing 3D.

A numbered walkthrough starts with a compact player. Play, Pause and step navigation remain available. **Expand player** opens ordering, narration, subtitles, preload and video controls; **Minimize player** returns to the smaller view. **Close diagram player** returns to normal editing. Voice setup, supported export limits and local execution are the same as on desktop.

## Local data and integration

Work remains in this browser's IndexedDB. A different phone, browser profile or origin has its own workspace; export/import a native JSON document or complete backup to move your work. The UI does not require a backend or AI.

API and MCP commands use the existing connected-browser bridge, permissions and semantic routes documented in [API.md](../API.md) and [Process Simulator](PROCESS_SIMULATOR.md). Opening a drawer or collapsing a player is presentation state; capacity, rates, costs, scenarios, saved nodes and simulation results remain in the shared authoritative model.

## Implementation boundaries

`frontend/src/hooks/useCompactLayout.ts` defines the shared responsive boundary. `components/mobile/CompactToolbar.tsx`, `CompactDiagramActions.tsx` and `CompactArrangementTools.tsx` arrange normal editor actions; `MobileWorkspacePanel.tsx` provides the project/property drawers and focus handling. Their presentation styles live in `mobile-workspace.css`.

`canvas/CanvasTools.tsx` keeps canvas utilities compact, and `canvas/useResponsiveCanvasViewport.ts` preserves the visible diagram center during orientation changes. `ui/SelectionTools.tsx` measures the selected-object toolbar so Fit and drawing controls remain above it when its buttons wrap. `spatial/SpatialNavigationTools.tsx` groups 3D navigation. The existing shared Modal, presentation Player and simulator UI provide responsive sheets and controls. These modules reuse existing editor commands and simulation services. Document schema version 1 and API version 0.3.0 remain unchanged; responsive layout adds no semantic simulation properties.

`canvas/touch-viewport-gesture.ts` owns two-finger navigation across 2D node surfaces and scrollable details. It ends an existing one-finger interaction before updating the shared React Flow viewport, preserves the diagram point beneath the fingers' midpoint, and retains ownership until all fingers lift. Fixed controls keep their own interactions.

## Regression coverage

`frontend/tests/e2e/mobile.spec.ts` exercises touch interactions at 320×640, 360×740 and 390×844, plus 844×390 landscape. Cases cover canvas space and page width, preserving the diagram's visible center through orientation changes, project/property/menu dismissal and focus, native node edits with REST parity, unobstructed Fit/drawing controls with a selection, dialogs, simulation controls and metrics, scenario editing across settings sections, compact walkthrough controls and readable expanded-player subtitles, and returning from 3D to the same saved 2D document. The phone status regression also verifies real touch pinch-zoom, status changes, undo and persistence. Browser screenshots from those cases are written to `/tmp/visualnerve-mobile-final-*.png` instead of replacing checked-in acceptance images.

`frontend/tests/e2e/mobile-pinch.spec.ts` starts actual two-finger touch gestures on flowchart and mind-map nodes, scrollable code content and simulator details. It checks simultaneous and staggered starts, proportional zoom and midpoint anchoring, unchanged node geometry and simulation assumptions, subsequent one-finger editing, and saved viewport restoration. `frontend/tests/canvas-touch-gesture.test.ts` additionally covers the genuine two-to-one touch-end lifecycle, including finger identifier reuse before all fingers lift.
