import './roblox.css';
export function RobloxTemplatePreview() {
  return (
    <svg
      viewBox="0 0 180 80"
      role="img"
      aria-label="A start island, checkpoint, key, door and goal connected as a game plan"
    >
      <path
        d="M24 44L57 32L93 43L130 28L160 36"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="3 3"
      />
      <g stroke="currentColor" strokeWidth="1.2">
        <path d="M8 47L26 39L43 47L26 56Z" fill="#25634d" />
        <path d="M48 35L65 27L80 35L65 43Z" fill="#3e67a8" />
        <path d="M84 49L103 40L120 49L103 58Z" fill="#956320" />
        <path d="M123 34L139 27L154 34L139 41Z" fill="#8063a7" />
      </g>
      <circle cx="26" cy="35" r="6" fill="#38bdf8" />
      <path d="M63 13V28M63 13L74 17L63 21" fill="#22c55e" stroke="#22c55e" />
      <circle cx="104" cy="29" r="5" fill="#fbbf24" />
      <path d="M102 34V42M102 39H108" stroke="#fbbf24" strokeWidth="3" />
      <path d="M134 12V30H144V12Z" fill="#a78bfa" />
      <path
        d="M158 25L161 17L164 25L172 25L166 30L168 38L161 33L154 38L156 30L150 25Z"
        fill="#fbbf24"
      />
    </svg>
  );
}
export type RobloxStartMode = 'example' | 'empty' | 'adventure';
export function RobloxStartOptions({
  value,
  change,
}: {
  value: RobloxStartMode;
  change: (value: RobloxStartMode) => void;
}) {
  return (
    <fieldset className="roblox-start-options">
      <legend>Your starting point</legend>
      {(
        [
          ['example', 'My first game', 'Start, checkpoints, a key, and a goal. Change anything.'],
          ['empty', 'My own idea', 'An empty world. Add your own objects and rules.'],
          [
            'adventure',
            'A bigger adventure',
            'Quests, inventory, timers, rounds, and reusable obstacles.',
          ],
        ] as const
      ).map(([id, title, hint]) => (
        <label key={id}>
          <input
            type="radio"
            name="roblox-start"
            value={id}
            checked={value === id}
            onChange={() => change(id)}
          />
          <span>
            <b>{title}</b>
            <small>{hint}</small>
          </span>
        </label>
      ))}
      <p>
        Make the world → choose when things happen → check & build → test in Roblox Studio → publish
        to your test game. You can build complex games step by step.
      </p>
    </fieldset>
  );
}
