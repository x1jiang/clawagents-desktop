import { useState } from "react";
import { isSoundEnabled, setSoundEnabled, playCompletionChime } from "../lib/sound";

export function SoundToggle() {
  const [on, setOn] = useState(isSoundEnabled());

  function toggle() {
    const next = !on;
    setSoundEnabled(next);
    setOn(next);
    // Preview when turning on so the user knows what it sounds like.
    if (next) playCompletionChime();
  }

  return (
    <button
      onClick={toggle}
      title={on ? "Mute completion sound" : "Enable completion sound"}
      className="px-2 py-1 text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100"
    >
      {on ? "🔔" : "🔕"}
    </button>
  );
}
