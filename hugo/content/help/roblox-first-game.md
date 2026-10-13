---
title: "Change your first Roblox game"
summary: "Make an editable starter your own, change a star reward, test two players, and download your first Roblox Studio place."
weight: 28
---

You have an idea for a game. Start with a small adventure you can play, change one thing, and see the result. This tutorial uses **My first game** so you can learn from working objects and rules.

## Open the starter

1. Choose **New diagram → Roblox Game Builder**.
2. Select **My first game**. Name it **Sky islands** and choose **Create diagram**.
3. Choose **World & rules**.
4. Open **Getting started** for the short process, then return to **1 · World**.

The starting world has **Start here**, **First jump**, **Save my place**, **Moving bridge**, **Finish**, **A bonus star**, and **Lava below**. Everything is editable. You can change the game into your own idea rather than only renaming a finished game.

![The first-game starter on a phone shows its real world preview, wrapped step tabs, and camera controls.](/help/images/roblox-mobile.webp "The same builder works on a phone. Scroll below the world preview to choose an object and edit its position.")

## Make the world yours

Choose **First jump** in the object list. Change **Object name** to **My floating island**, choose your favorite **Object color**, and try a different **Material**.

Make the platform wider by changing **Size (studs) X** from 12 to 16. Use **Top view** to see how it connects to nearby objects. The diagram still shows the same plan; world size and diagram card size are separate.

Choose **Moving bridge**. **Move by (studs)** sets how far it travels from its starting position. **Travel time (seconds)** sets the time for one trip. Start by keeping its existing settings. Once you have played it, come back and try a different movement or travel time.

Use **Duplicate** to add another island, then place the copy with its X, Y, and Z fields. A duplicate is a new object; the original's rules do not automatically become new rules for the copy. Add a rule if the new object needs one.

## Give the star a bigger reward

1. Open **2 · Rules**.
2. Choose **Star gives ten points**.
3. Read **Rule starts when → A player touches an object** and **Trigger object → A bonus star**.
4. Read **Action 1 does → Add to a variable** and its **Score** variable.
5. Change **Action 1 value** from 10 to 25.
6. Change **Action 2 message** to **You found a star: +25 points!**
7. Keep **Run only once for each player** on.

The rule now gives each player 25 points the first time they touch this star. It remains available for another player to collect their own reward. If you hide the object with a separate action, that object visibility is shared with everyone in the server.

You can rename the rule to **Star gives 25 points**. Its name helps you read your plan; the actions determine what it does.

## Check the reward with two players

1. Open **Test rules**.
2. Keep **Test player → Player1**, choose **Test object → A bonus star**, and choose **Trigger event**.
3. Player1's **Score** becomes 25 and their message appears.
4. Trigger the same event again. The score stays 25 because the rule runs once per player.
5. Choose **Add test player**. Player2 starts with their own score of 0.
6. Trigger the star event for Player2. Player2 also gets 25; Player1 stays at 25.
7. Choose **Restart rule test** to start again.

This proves your reward rule behaves as intended in the browser's logic preview. Roblox Studio is where you test actually reaching the star, landing on the moving bridge, and playing with networked players.

## Understand the checkpoint and lava

Open **2 · Rules → Checkpoint remembers my place**. Its first action is **Set checkpoint**. That saves a return point for the player who touched it.

Open **Lava sends me back**. Its **Damage player** action deals 100 damage. In **Test rules**, trigger **Save my place**, then **Lava below**, and choose **Respawn selected player**. The player returns to the saved checkpoint.

If you want gentler lava, lower the damage amount. If you want a checkpoint to display a different message, edit its message action. Test after each change so you know which edit changed the result.

## Play it in Roblox Studio

Use your computer for these Studio steps. If you built the game on your phone, transfer the downloaded file to that computer first.

1. Open **3 · Check & build → Build Roblox files**.
2. Choose **Download Studio place (.rbxlx)**.
3. Open Roblox Studio and choose **File → Open from File**.
4. Open the download and press **Play**.
5. Try the whole route: start, jump, checkpoint, moving bridge, star, finish.
6. Run Studio's multiplayer test with two players. Confirm both can earn their own star reward.
7. If a jump is too far, come back to **1 · World**, move the platform closer, and build again.

Save a backup in Studio. When you are happy with this version, use **File → Publish As** to send it to your separate test game. Check the game and place names before you confirm. Keep it private while you try it with friends; Roblox controls public publishing eligibility.

## Pick your next idea

Try one of these changes:

- Add a second star with a new touch rule and a different score reward.
- Add an inventory key and a door that opens only when the player has that key.
- Add a character that gives a hint when the player interacts with it.
- Add a timer that shows a hint after 20 seconds.
- Turn a room or obstacle into a reusable prefab and place several copies.

Follow [Build a multiplayer adventure](/help/roblox-advanced-game/) to see quests, shared switches, timed rounds, and parameterized prefabs in action. The [main Roblox guide](/help/roblox-game-builder/) explains all controls and unfinished-edit messages.
