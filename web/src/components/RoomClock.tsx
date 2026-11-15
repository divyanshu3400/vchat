"use client";

import { useEffect, useState } from "react";

function format(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone }).format(
      new Date(),
    );
  } catch {
    return "--:--";
  }
}

/** Current local time in a region. Renders a placeholder on the server, then ticks on the client. */
export default function RoomClock({ timeZone, className }: { timeZone: string; className?: string }) {
  const [time, setTime] = useState("--:--");

  useEffect(() => {
    const tick = () => setTime(format(timeZone));
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [timeZone]);

  return (
    <span className={className} suppressHydrationWarning>
      {time}
    </span>
  );
}
