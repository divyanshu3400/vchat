"use client";

import { useEffect, useRef } from "react";
import { playSound, unlockSoundsOnGesture } from "@/lib/sounds";
import { useChat } from "../ChatProvider";

/**
 * Sounds for what arrives on the personal socket while vChat is on screen: a pop in the open chat
 * (friend or random), a ding on a random match, a bell for requests and new friends. Messages in
 * other chats chime with their banner (MessageBanner). Hidden tab: silent, notifications cover it.
 */
export default function SoundEffects() {
  const { me, subscribe, isWatching, conversations, friends } = useChat();
  const muted = useRef(new Set<number>());
  const friendIds = useRef(new Set<number>());

  useEffect(() => {
    muted.current = new Set(conversations.filter((c) => c.muted).map((c) => c.user.id));
  }, [conversations]);
  useEffect(() => {
    friendIds.current = new Set(friends.map((f) => f.user.id));
  }, [friends]);

  useEffect(() => unlockSoundsOnGesture(), []);

  useEffect(
    () =>
      subscribe((event) => {
        if (!me || document.visibilityState !== "visible") return;
        switch (event.type) {
          case "dm": {
            const from = event.message.sender.id;
            if (from === me.id || muted.current.has(from)) return;
            if (event.request) playSound("request");
            else if (isWatching(from)) playSound("receive");
            return;
          }
          case "stranger.message":
            if (event.message.sender_id !== me.id) playSound("receive");
            return;
          case "stranger.matched":
            playSound("match");
            return;
          case "friend_request":
            if (event.request.to_user.id === me.id) playSound("request");
            return;
          case "friend_added":
            // Also sent for presence updates of someone already a friend: only a new friend rings.
            if (!friendIds.current.has(event.friend.id)) playSound("request");
            return;
        }
      }),
    [subscribe, me, isWatching],
  );

  return null;
}
