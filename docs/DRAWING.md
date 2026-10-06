# Drawing on diagrams

The pencil in the bottom canvas controls opens a separate drawing layer. It works on mind maps, regular diagrams, timelines and CSV data diagrams.

- **Pen:** draw a freehand stroke or tap to make a dot. Mouse, touch and stylus input use the same tool.
- **Drawing color / Drawing width:** choose the brush for the next stroke.
- **Eraser:** touch a stroke to remove that entire stroke. An eraser drag is one undoable action.
- **Hide drawing / Show drawing:** hide annotations while keeping the diagram editable. The eye button is also available outside drawing mode.
- **Clear drawing:** remove saved strokes; Undo restores them.
- **Done drawing** or Escape: return to normal diagram editing. Escape also cancels an unfinished stroke.

Strokes occupy diagram coordinates, so they follow pan and zoom. They are independent of nodes, edges and CSV calculations. Moving or relaying out nodes does not move a stroke attached to the drawing layer. Fit diagram includes visible annotations. Existing object selection, connections and touch navigation work again after leaving drawing mode.

Completed gestures save through the ordinary IndexedDB autosave transaction. No CSV rows are rewritten by drawing. Layer visibility, stroke points, colors and widths survive reload, diagram JSON, workspace backup and restore. Hidden strokes remain in these lossless formats. Brush/tool choice is transient.

PNG/PDF show the visible layer above diagram objects and connections. Complete export includes strokes outside the node bounds and supports drawing-only diagrams. Selection export crops annotations to the selected nodes' image area; viewport export uses the current view. Unfinished gestures are not exported.

A layer allows at most 1,000 strokes, 20,000 points per stroke and 200,000 points in total. Widths are 1–32 diagram units. The editor reports exceeded limits instead of saving malformed or partial strokes. Browser storage and raster export limits still apply. No drawing content is uploaded to S3 or another service.
