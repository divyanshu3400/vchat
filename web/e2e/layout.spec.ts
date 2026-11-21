import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Layout checks for every main screen at every size (see playwright.config.ts). Each page must:
 *  - never scroll sideways,
 *  - never crush text into a sliver (the "R o o m" bug),
 *  - keep room-invite cards readable and menu options unclipped.
 * Data comes from `manage.py seed_layout_fixture` (make layout runs it).
 */

type Fixture = { login: string; password: string; friend_id: number; room_slug: string; invite_code: string };
// Run from web/ (make layout does).
const fx: Fixture = JSON.parse(readFileSync("e2e/.fixture.json", "utf-8"));

/** Problems on the page right now, as readable strings (empty = good). */
async function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const problems: string[] = [];
    const W = window.innerWidth;
    const name = (e: Element) => `${e.tagName.toLowerCase()}${typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
    const docW = document.documentElement.scrollWidth;
    if (docW > W + 1) problems.push(`page scrolls sideways: ${docW}px wide in a ${W}px window`);
    window.scrollTo(400, window.scrollY);
    if (window.scrollX > 0) problems.push(`page can be scrolled sideways by ${window.scrollX}px`);
    window.scrollTo(0, window.scrollY);

    for (const e of document.querySelectorAll("body *")) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent?.trim() ?? "").join("");
      if (own.length > 4 && r.width < 36 && r.height > 40) problems.push(`crushed text in ${name(e)} (${Math.round(r.width)}px wide): "${own.slice(0, 20)}"`);
    }
    for (const c of document.querySelectorAll(".invite-card:not(.loading):not(.gone)")) {
      const t = c.querySelector(".invite-text")?.getBoundingClientRect();
      if (t && t.width < 70) problems.push(`room invite card name only ${Math.round(t.width)}px wide`);
    }
    for (const b of document.querySelectorAll(".dd.open .dd-seg button")) {
      if (b.scrollWidth > b.clientWidth + 1) problems.push(`menu option cut off: "${b.textContent}"`);
    }
    return problems;
  });
}

async function check(page: Page, label: string) {
  // Let fonts, history and sockets settle.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `e2e/screenshots/${test.info().project.name}/${label}.png`, fullPage: false });
  expect(await layoutProblems(page), `${label} at ${test.info().project.name}`).toEqual([]);
}

test.describe("public pages", () => {
  for (const [label, path] of [
    ["home", "/"],
    ["login", "/login"],
    ["invite", "/r/{code}"],
    ["seo-india", "/talk-to-strangers-india"],
    ["seo-hindi", "/hindi-chat-room"],
    ["room-page", "/rooms/hindi"],
    ["safety", "/safety"],
    ["guide-starters", "/conversation-starters"],
  ] as const) {
    test(label, async ({ page }) => {
      await page.goto(path.replace("{code}", fx.invite_code));
      await check(page, label);
    });
  }
});

test.describe("chat", () => {
  // Signed in once by global-setup.ts.
  test.use({ storageState: "e2e/.auth.json" });

  for (const [label, path] of [
    ["chat-home", "/chat"],
    ["rooms", "/chat/rooms"],
    ["me", "/chat/me"],
    ["random", "/chat/stranger"],
    ["dm", "/chat/dm/{friend}"],
    ["room", "/chat/{room}"],
  ] as const) {
    test(label, async ({ page }) => {
      await page.goto(path.replace("{friend}", String(fx.friend_id)).replace("{room}", fx.room_slug));
      await check(page, label);
    });
  }

  test("dm menu", async ({ page }) => {
    await page.goto(`/chat/dm/${fx.friend_id}`);
    await page.getByRole("button", { name: "More", exact: true }).first().click();
    await check(page, "dm-menu");
  });

  test("chat window beside a room (laptops and up)", async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) < 1280, "chat windows are a laptop layout");
    await page.goto(`/chat/${fx.room_slug}`);
    await page.locator(".list-pane").getByText("A_Rather_Long_Name").first().click();
    const win = page.locator(".dock .win").first();
    await expect(win).toBeVisible();
    await check(page, "dock-window");
    // The room's typing box must stay clear of the window.
    const composer = await page.locator(".screen .composer").first().boundingBox();
    const box = await win.boundingBox();
    expect(composer && box && composer.x + composer.width <= box.x + 1, "room typing box is not under the chat window").toBeTruthy();
    await win.getByRole("button", { name: "More", exact: true }).click();
    await check(page, "dock-window-menu");
  });
});
