---
title: "Build a multiplayer Roblox adventure"
summary: "Explore personal quests, shared switches, timed rounds, nested conditions, and reusable obstacles with different rewards or damage."
weight: 29
---

An advanced game grows from connected ideas. A player collects crystals, a friend turns on the island's power, and both work toward opening a gate. Some state belongs to one player; other state belongs to the whole server.

This tutorial uses **A bigger adventure** as an editable example. It shows the same building blocks you can combine into your own escape room, exploration game, obstacle course, or cooperative challenge.

## Start Crystal Island

Choose **New diagram → Roblox Game Builder → A bigger adventure**. Give it a name and choose **Create diagram → World & rules**.

In **1 · World**, look at the island, camp, guide character, power switch, crystal gate, checkpoint, lift, and treasure. In **Prefabs**, the crystal reward and lava trap each have reusable objects and rules. Their copies appear in the world preview at their actual positions.

## Personal progress and shared state

Open **Progress**. Read the four variables:

| Variable | Belongs to | Purpose |
| --- | --- | --- |
| Explorer level | Each player | A personal level that increases at the treasure |
| Adventure score | Each player | A personal score for crystals and treasure |
| Island power | Everyone in this server | Shared power that can unlock the gate |
| Rounds started | Everyone in this server | An editable shared counter for your own round rules |

The **Crystals** inventory and **Find three crystals** quest belong to each player. Player1 collecting a crystal does not give that crystal to Player2. Turning on **Island power** changes the shared value for both.

In **2 · Rules**, **Start each player's quest** runs when a player joins. It starts the quest, starts that player's friendly hint timer, and shows instructions. Progress reaches **complete** after the quest target of three crystals.

## Change a reusable reward

Open **Prefabs**. **Edit prefab → Reusable crystal reward** has two parameters:

- **Score reward** is a number used by the prefab's score action.
- **Crystal colour** is text, such as `#facc15`, connected to the collectible's color.

![Reusable crystal parameters include a numeric score reward, a text color, and a connection from that color parameter to the glowing crystal.](/help/images/roblox-prefabs.webp "Parameters give each copy its own settings while the objects and rules remain reusable.")

Under **Copies in your world**, change **River crystal Score reward** from 20 to 75. That copy now awards 75 points; the camp and gate copies keep their own values. Change its color to another valid six-digit color if you want it to look special.

Choose **Place a copy** to create another crystal. Give it a recognizable **Copy name** and move it with its position fields. Each copy has its own once-per-player collection rule, so adding a copy does not make another crystal's reward run again.

Under **Rules inside this prefab**, inspect the reward: give one crystal, advance the quest, add the parameter's score reward, and show a message. Use **Prefab parameter** as an expression source when you want a different amount for each copy.

You can do the same with **Reusable lava trap → Damage per touch**. Make a gentle practice trap and a harder trap from one reusable design. Numeric positions and sizes, yes/no flags, colors, and movement duration can also be connected to parameters.

## Understand the gate's nested condition

Open **2 · Rules → Crystals and power open the gate**. **Use a condition** is on and the type is **All conditions must pass**.

It checks three things:

1. The player has at least three **Crystals**.
2. Their **Find three crystals** quest state equals the text `complete`.
3. Shared **Island power** is at least 1.

The actions then remove three crystals, turn the gate's collision off, hide it, and show a message. Collision and visibility are world-object state, so the open gate is shared with everyone.

Try adding a new requirement: **Add condition**, set its left source to **Variable**, choose **Explorer level**, choose **At least**, and set the right value to 2. Now this gate needs an experienced player as well.

For an alternative route, change the top group to **Any condition may pass** and build two **All conditions must pass** groups inside it. One branch might need three crystals and power; another might need a high score and a completed quest. The controls let you nest those ideas without writing code.

## Run a timed round

In **Progress → Timers & rounds**, **Friendly hint** is a player timer; **Island round** is shared.

In **2 · Rules**, **Mira starts an island round** runs when someone interacts with the guide. Its **Start a round** action sends a round-start event to every player currently in the server. **Start the shared round clock** starts the two-minute timer. When that timer finishes, **The clock ends this round** uses **End a round**, and each player's round-end rule shows a message.

A shared timer has no one player. Its action should change shared state or start/end a round. To give each player a personal message directly when a timer ends, use a player timer instead.

Choose what “a round” means in your own game. Your rules can enable the arena at the start, show a door at the end, teleport players to camp, or reward a player whose quest is complete. Starting or ending a round does not automatically erase inventory or quest progress.

## Test with two pretend players

1. Open **Test rules → Add test player**.
2. Keep **Player2**, choose **Camp crystal**, and **Trigger event** with **Touch an object**. Player2 has one crystal and quest progress 1/3. Player1 stays at 0/3.
3. Trigger the other two crystals for Player2. The quest reaches **complete**.
4. Switch to **Player1**, choose **Interact with an object → Power switch**, and trigger it. Both players see shared **Island power** increase.
5. Switch back to **Player2** and interact with **Crystal gate**. The gate becomes hidden and pass-through; Player2 pays their three crystals.
6. Interact with **Mira the island guide**, then advance timers by 120 seconds to try the round ending.
7. **Restart rule test** resets this whole preview so you can test another order.

If you added a level-2 gate requirement, the original level-1 player should fail that condition. Use that result to decide how your player earns the needed level before reaching the gate.

The preview checks logic. Use Roblox Studio's multiplayer test to check real touch detection, interaction prompts, jumping, moving platforms, and players joining or leaving the server.

## Grow the game with a plan

Try a second island with a different quest, a reusable room that appears when shared power reaches a target, or a timed escape that needs two conditions at once. Add one mechanic, test it, and then connect it to the rest.

Keep names clear. Use **Duplicate** for an independent object, **Prefab** for a reusable design, and **Place a copy** for another instance of that design. Drag your diagram cards to make the plan readable without moving the world pieces.

**Check & build** identifies broken references and missing start points. Valid changes save automatically; unfinished combinations stay visibly marked until you repair or discard them. If another editor changes the saved game while you have unfinished edits, review the latest version before continuing.

Progress lasts for this server session. Permanent cross-visit saves, purchases, imported assets, custom scripts, and moving NPC pathfinding are outside this version. You can still compose advanced behavior from the supported rules, shared and player variables, inventory, quests, timers, rounds, and prefab parameters.

Follow the [build and Studio steps](/help/roblox-game-builder/#build) to download, play, review the update plugin, and publish to your separate test game.
