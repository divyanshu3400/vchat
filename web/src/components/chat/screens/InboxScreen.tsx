"use client";

import ConversationList from "../ConversationList";
import { Icon } from "../bits";

/** Phone: the conversation list as its own tab. Wider screens already show the list beside this. */
export default function InboxScreen() {
  return (
    <div className="page-screen inbox-screen">
      <div className="inbox-phone">
        <ConversationList />
      </div>
      <div className="inbox-wide">
        <span className="soon-icon">
          <Icon name="chat" size={30} />
        </span>
        <h2>Pick a chat</h2>
        <p>Choose a friend or a room from the list.</p>
      </div>
    </div>
  );
}
