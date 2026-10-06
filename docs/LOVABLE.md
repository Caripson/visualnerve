# Build an app from a diagram

Draw the workflow or features you want to turn into an app, including decision labels and connections. Choose **Build with Lovable** beside Export. On a phone, use **… → Build with Lovable**.

1. Describe what to build in **App instructions**: users, screens, expected behavior and any design or technology preferences.
2. Choose **Entire diagram**, **Current CSV groups** or **Selected objects**. The preview shows the complete prompt and object/relationship counts.
3. Review the preview, then choose **Open in Lovable**. A new tab opens with the prompt filled in. Review it in Lovable and press **Send** to start building.

Your draft instructions and scope are saved locally with the diagram and travel with its JSON export and workspace backup. Visual Nerve creates the brief without an account, API key, MCP bridge or network request. Lovable handles its own account and build process after you open it.

## What the brief means

The diagram describes the app you want Lovable to implement. Each object has a distinct reference, so duplicate titles stay separate. The brief includes object types, titles, descriptions, notes, planning status, tags, responsibilities and dates. Connections retain their types, descriptions, labels and directions, including reverse arrows, two-way connections, undirected associations and loops. Parent relationships describe hierarchy rather than an invented execution sequence. A **Done** status means progress on your plan; the corresponding app feature is still included.

**Entire diagram** includes canonical objects even when collapsed or off screen, including retained CSV groups. **Current CSV groups** includes the current generated CSV view plus manual objects. It is the default for data diagrams. **Selected objects** includes exactly the selected objects. Connections crossing the scope boundary identify the outside objects as context, so dependencies and conditions are visible without silently adding them to the requested app.

For CSV diagrams, the brief includes column schema, grouping, cleanup rules, filters and calculated group summaries. It never reads or includes the raw source rows. Parent and child aggregates can overlap; the brief tells Lovable to avoid double counting. Retained groups may reflect earlier analysis settings. Arbitrary metadata, owner emails and bridge credentials are excluded. Written text and grouping values are included as shown in the preview.

For [imported SQL schemas](SQL_IMPORT.md), a typed allowlist includes table/qualified names, ordered columns and types, nullability, primary/unique keys, and foreign-key column pairs, constraint names and delete/update actions. Composite key order is retained. Foreign keys run from child to parent as data integrity requirements, without inventing workflow execution order. External tables remain integration context; missing definitions and unresolved referenced columns stay explicitly unknown. Raw SQL scripts, INSERT/COPY rows, default/CHECK expressions and procedure bodies are absent. ENUM labels contained in a type can remain as schema structure. Schema names and type labels are included in the exact preview, so review them before sharing.

SQL SELECT/WITH diagrams contribute scoped source aliases, ordered outputs, normalized expressions, JOIN conditions/types, filters/grouping/order clauses and column lineage through a typed query allowlist. Repeated table aliases stay distinct, and ambiguous/unresolved references remain explicit. These describe a logical query, not executed rows or a database optimizer plan. **Expressions and filter clauses include literal values** that may be sensitive; review the complete preview before sharing. The full raw script and comments are excluded. Explain what app should use the query's information, because its structure does not by itself define screens, editing behavior or a business workflow.

Freehand strokes remain visual notes. Describe their meaning in your instructions when they affect the requested app. PNG/PDF export can provide a separate visual reference; the handoff does not publish or upload that drawing.

## Link limits and alternatives

The handoff uses Lovable's documented [Build with URL](https://docs.lovable.dev/integrations/build-with-url) route: `https://lovable.dev/#prompt=URL_ENCODED_TEXT`. The prompt is prefilled and unsent. Visual Nerve does not start a build automatically.

Lovable allows at most 50,000 prompt characters. Visual Nerve also limits the encoded link to 60,000 characters to avoid oversized browser URLs. These limits never truncate the brief. Use **Copy build prompt** or **Download build brief** for the complete text, then open Lovable and paste it. The downloaded file keeps a separate copy. If clipboard access is unavailable, the preview is selected for manual copying.

Opening the dialog sends no data. Opening Lovable explicitly shares the previewed text with that service. Normal editing and saving continue locally in IndexedDB. See [privacy](PRIVACY.md).

Code diagrams contribute recognized language/path/name/kind/source-location summaries and relationships with their confidence and evidence. Original source and arbitrary metadata are excluded. The brief labels the outline as static and asks the recipient to clarify heuristic/unresolved behavior instead of inventing implementations. File paths and identifiers are included as shown; review them before sharing.
