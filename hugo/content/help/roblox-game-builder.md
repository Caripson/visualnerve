---
title: "Build your own Roblox game"
summary: "Turn an idea into a world, choose its rules, test them with pretend players, and open a real game in Roblox Studio."
weight: 27
---

Roblox Game Builder turns your diagram into a real Roblox place. You choose the objects, where they go, and what happens when players touch or use them. You can start small and grow into a multiplayer adventure with quests, inventory, timers, rounds, and reusable rooms.

You do not need to write code. The builder creates the Roblox objects and scripts from your choices. Roblox Studio runs the game and lets you test how it feels to play.

## Choose a starting point

1. Choose **New diagram → Roblox Game Builder**.
2. Pick **My first game**, **My own idea**, or **A bigger adventure**.
3. Give your game a name and choose **Create diagram**.
4. Choose **World & rules** in the Roblox Game Builder bar.

**My first game** is an editable jumping adventure with a start, checkpoint, moving bridge, bonus star, lava, and finish. **My own idea** gives you an empty world. **A bigger adventure** creates Crystal Island: separate player quests and inventory, shared island power, a timed round, and reusable crystal rewards and lava traps.

[Open the starting template](https://app.visualnerve.com/?demo=roblox-game-builder). The link creates a local document after storage consent and workspace unlock. It contains a template name, never a Roblox account or secret.

For a guided first try, follow [Change your first game](/help/roblox-first-game/). For a larger project, follow [Build a multiplayer adventure](/help/roblox-advanced-game/).

## World {#world}

Open **1 · World**. Use **Object to add → Add object**, then choose the object in the list. Give it a name you will recognize when making a rule.

| Object | Try using it for… |
| --- | --- |
| Player start | Where players appear when they join |
| Platform | Ground, walls, stairs, islands, or bridges |
| Checkpoint | A safe return point after falling |
| Hazard | Lava, a trap, or an area that hurts |
| Collectible | A coin, gem, or key players can earn |
| Door | A gate that opens when a condition passes |
| Goal | A finish line or treasure that ends a challenge |
| Character / NPC | A stationary character players can talk to |
| Invisible trigger zone | An area that starts a rule without blocking the player |
| Decoration | Scenery, props, or a switch players can use |
| Moving platform | A bridge or lift that moves back and forth |

Object types provide the world pieces. Add rules to make a checkpoint save a return point, a hazard deal damage, a collectible give a reward, or a goal finish the game. A character stays in place; character pathfinding is outside this version.

### Place and resize an object

**Position (studs)** tells Roblox where the object belongs. X moves it sideways, Y moves it up or down, and Z moves it forward or backward. A stud is Roblox's world unit. **Size (studs)** changes width, height, and depth. **Rotation (degrees)** turns the object.

Type values directly or use the number fields' arrows. Negative and decimal values work too. While a number is unfinished, it does not change your game; leaving a blank or invalid field restores its previous value and explains what happened. **Object color** and **Material** change its appearance. **Stay in place (anchored)** keeps a prop fixed. **Players can stand on it (collision)** determines whether it blocks players. **Visible** controls what players see, while **Enabled** controls whether the object is active.

For a moving platform, **Move by (studs)** sets the travel offset from its starting position, and **Travel time (seconds)** sets one trip's duration. Test the ride in Studio.

The world preview uses these actual object sizes, positions, and rotations. Drag to orbit, pinch or scroll to zoom, or use **3D view**, **Top view**, and **Front view**. Invisible objects appear faintly so you can still place them. The object list and numeric fields work when your browser cannot display 3D.

![Crystal Island's actual world geometry appears above its named object list and editing controls.](/help/images/roblox-world.webp "The world preview displays your saved object's placement. Test movement, jumping, and collisions in Roblox Studio.")

The ordinary diagram remains your game plan. Moving a diagram card arranges the plan; it does not move that object in the Roblox world. The diagram's separate styled 3D mode displays cards. The builder's world preview displays world objects.

### Change player settings

Open **Game name and player settings** to set the name, description, maximum players, gravity, walking speed, jump power, respawn delay, and ambient light. The default walking speed is 16 studs per second. Match your intended maximum player count in Roblox's experience settings as well.

## Rules: When → If → Then {#rules}

Open **2 · Rules → Add rule**. Read the rule like a sentence:

> When a player touches the key, if they have fewer than three keys, then give them one key and show a message.

1. **Rule starts when** chooses the event: a player joins, touches or uses an object, a timer finishes, or a round starts or ends.
2. For a touch or interaction, choose **Trigger object**. For a timer, choose **Trigger timer**.
3. Turn on **Use a condition** if the rule needs a check.
4. Choose what **Action 1 does**. **Add action** adds the next step. Actions run in order; **Move up** changes that order.
5. Set **Wait before repeating (seconds)** so a touch does not give the same reward every frame. Use **Run only once for each player** for a one-time star or reward.

![A custom welcome rule starts when a player joins and shows the message entered in its action.](/help/images/roblox-rules.webp "Start with one understandable rule. Then add conditions and actions as your idea grows.")

Actions can change variables, give or remove inventory items, start or complete quests, advance quest progress, start or stop timers, enable or hide objects, turn collision on or off, teleport a player, save a checkpoint, show a message, damage or heal a player, declare a win, or start and end a round.

A rule runs on the server. Each player cannot simply tell the server they have earned a reward. Interaction prompts are created for objects used by interaction rules; test their range and controls in Studio.

### Make a more interesting condition

**Compare two values** lets you compare a value, variable, item count, quest progress, or quest state. Choose **Math (+ − × ÷)** for a calculation. Quest state is text: `inactive`, `active`, or `complete`; use **Equals** with a matching text value.

Choose **All conditions must pass** for a door that needs both three keys and island power. Choose **Any condition may pass** when a key or a high enough score should work. Choose **Reverse a condition** when something should happen only while a quest is incomplete. These groups can contain further groups.

Unavailable variables, items, quests, and timers appear after you add them in **Progress**. A prefab rule can also use one of that prefab's parameters.

## Progress: give players goals {#progress}

Open **Progress** and add the things your rules will use.

- **Variables** remember numbers, text, or yes/no values. Choose **Each player** for personal score or energy, or **Everyone in this server** for shared island power.
- **Inventory** counts keys, gems, or other items separately for each player. It is a count in their backpack, rather than an automatically equipped tool.
- **Quests** have a name, instructions, and a target. Rules start them and add progress. Reaching the target completes the quest.
- **Timers** count seconds after a rule starts them. Choose a player timer for personal hints, or a shared timer for a server challenge. Restarting an active timer restarts its countdown.

A shared timer has no individual player. Use its rule for shared changes, such as ending a round or turning an object off. Round start and end events run for each player currently in the server.

Progress belongs to the current server session. Leaving and returning in a different session does not preserve it. Permanent cross-visit saves, purchases, external assets, and arbitrary scripts are outside this version.

## Prefabs: reuse your creations {#prefabs}

Open **Prefabs → Create prefab**. A prefab is a reusable group of objects and rules. Build a room, trap, obstacle, or treasure chest once, then choose **Place a copy** to put it in the world.

Objects inside the prefab use positions relative to that copy. A copy has its own position and rotation. Changing the original prefab updates every copy.

Under **Parameters · give each copy its own settings**, add a number, text, or yes/no setting. **Connect parameter to object** can connect it to a color, visibility, collision, local position, size, or movement duration. A prefab rule can use a parameter as its action amount: one lava trap could deal 10 damage, another 60. Edit each copy's parameter value to make them different.

For color, use a text value such as `#22c55e`. For width or damage, use a number. For visibility, use a yes/no value. Crystal Island includes working examples you can change.

## Test the rules before opening Studio {#test-rules}

Open **Test rules**. The browser runs your declared rules with pretend players.

1. Choose **Test player** and **Test object**.
2. Choose **Touch an object** or **Interact with an object**, then **Trigger event**.
3. Read that player's score, items, quest state, health, checkpoint, and messages.
4. Choose **Add test player** and repeat. Check that personal rewards stay with the right player.
5. Use **Advance time (seconds) → Advance timers** to try countdowns and cooldowns.
6. **Restart rule test** returns this preview to its starting state.

This is a logic test. It does not simulate jumping, physics, moving-platform rides, interaction distance, or a network connection. Test those in Roblox Studio with at least two players.

## Check, build, and publish {#build}

1. Open **3 · Check & build**. Read each **Fix** or **Tip**. **Go to world**, **Go to rules**, **Go to progress**, and **Go to prefabs** take you to the relevant controls.
2. Choose **Build Roblox files**. Review the object and rule counts. **Cancel action** stops a build you no longer need. If you change the plan, build a fresh version before downloading it.
3. Choose **Download Studio place (.rbxlx)**, or **Download all files (.zip)** for the editable source, generated scripts, importer plugin, and instructions. **Inspect generated files** lets you read each file before using it.
4. On your computer, open Roblox Studio, choose **File → Open from File**, and open the downloaded .rbxlx file. If you built on your phone, transfer the file to that computer first.
5. Press **Play**. Try every checkpoint, collectible, hazard, and goal. Use Studio's multiplayer test with two players.
6. Stop the test and save a backup. Use **File → Publish As**, choose your separate test game and check the game/place names before confirming.

![The build review shows fourteen world objects, sixteen generated server rules, a real Studio place download, and Studio testing steps.](/help/images/roblox-build.webp "This editable adventure was built from its current saved plan. Review and download the files, then test that version in Studio.")

The bundle's **game.json** contains the structured game definition used to build the Roblox files. To restore your full editable Visual Nerve diagram, including card layout and notes, use the ordinary **Export → JSON**, or a [full workspace backup](/help/settings/#export-all-local-data). Keep that diagram backup as well as your Studio project.

Some older Studio versions call this menu **Publish to Roblox As…**. Publishing a new version and making an experience public are separate Roblox choices. Roblox decides which accounts can publish publicly. See its [official publishing guide](https://create.roblox.com/docs/production/publishing/publish-games-and-places).

### Update work you have changed in Studio

Keep a backup of the Studio project. Download **VisualNerveImporter.plugin.luau** with the built files. In a spare Studio place, insert a Script, paste that file, choose **Save as Local Plugin**, and remove the temporary Script. Open your project and use **Visual Nerve → Import game → Preview changes**.

Read the review before **Apply these changes**. The plugin updates the generated world objects for this game. It prepares new copies of the generated server and HUD scripts, then replaces those script objects and transfers their custom children. Other objects stay in place. A hand-edited generated object's color or generated script can change during the sync. Keep your own scripts separate from the generated ones. Studio Undo restores the previous script objects and recorded world changes.

## Optional direct upload {#optional-direct-upload}

Studio is the easiest route. If you already use the [optional local bridge](/help/api-mcp/), the builder can also upload a tested version directly to one Roblox place. A person running the bridge configures the destination and a restricted Roblox Open Cloud key on that computer. No key is entered into your game, this page, or a backup.

The bridge process accepts these settings:

| Setting | What the person running the bridge supplies |
| --- | --- |
| `VISUAL_NERVE_ROBLOX_PUBLISH_ENABLED` | Exactly `true` |
| `VISUAL_NERVE_ROBLOX_API_KEY` | A restricted Open Cloud key with `universe-places:write` for the intended universe |
| `VISUAL_NERVE_ROBLOX_UNIVERSE_ID` | The test game's Universe ID |
| `VISUAL_NERVE_ROBLOX_PLACE_ID` | The test place's Place ID |

Supply the key privately to that process through your computer's credential/environment setup. The bridge does not automatically read an existing keychain or `.env` file. Use a separate test game and a key restricted to that game. Follow Roblox's [official place-publishing setup](https://create.roblox.com/docs/cloud/guides/usage-place-publishing) for the required permission.

1. Start the configured bridge, unlock your workspace, and explicitly choose **MCP access → Read + write** in Settings. The builder does not enable that permission for you.
2. Build the current saved version and open **Upload a place version** in **3 · Check & build**.
3. Read the displayed Universe ID and Place ID. They are the bridge's fixed destination.
4. Open this build in Studio, test with two players, and check that you selected the intended test destination.
5. Check the Studio-test box and type the displayed **Universe ID / Place ID**. Choose **Upload this version** yourself.
6. The bridge asks for a separate approval in its own local terminal. Compare its destination and **Build SHA-256 fingerprint** with the values in the builder. The fingerprint identifies this exact built file. The person running the bridge types the fresh approval phrase in that terminal only when both match. Without this terminal approval, the upload is not sent.
7. Read the result and check the version in Creator Dashboard. Uploading a version does not make a private experience public.

Direct upload replaces that place's published version with the generated world. Work added only in Studio is not included. To keep those manual changes, use the Studio importer to review and merge the generated changes into your Studio project, then publish from Studio.

**Cancel upload** stops work that has not yet completed. If the outcome is **unknown**, Roblox may already have saved it. Check the place's version history in Creator Dashboard before trying again. The builder waits for your review and **Acknowledge reviewed outcome**; it never automatically retries an uncertain publication. After a bridge or browser restart, still check that history before another upload.

API and MCP can edit, validate, and build the same game plan. They cannot approve either publication step. You review the destination and choose the upload button yourself, then the local bridge operator confirms the fresh phrase in the terminal.

## Saving, unfinished edits, and limits {#saving}

Valid edits save with the diagram and work with **Undo**. If an edit temporarily leaves a broken condition or reference, the builder says **These edits are not saved yet**. Finish the related settings and the whole valid edit saves together. Until then, the world preview shows the last valid version, and building or testing is unavailable. You can also choose **Discard unfinished edits**.

Closing with unfinished edits offers **Keep editing** or **Discard edits and close**. If another editor, the API, or MCP changed the game while your draft was unfinished, the builder keeps that newer saved game. Discard your unfinished edits to review the latest version; it never silently replaces the other change.

This version supports up to 1,000 expanded world objects, 1,000 rules, 128 variables/items/quests/timers/prefabs each, 256 prefab copies, and 64 actions per rule. A copy counts toward the expanded object and rule limits. Break a large idea into reusable pieces and name them clearly.

If a referenced object, item, or parameter cannot be deleted yet, remove or update the rule or connection that uses it. **Check & build** identifies the reference. Use a [workspace backup](/help/settings/#export-all-local-data) before moving to another browser or clearing local storage.
