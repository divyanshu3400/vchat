import { readFileSync } from "node:fs";
import { request, type FullConfig } from "@playwright/test";

/** Logs in once (login is rate-limited) and saves the session for every test and size. */
export default async function globalSetup(config: FullConfig) {
  const fx = JSON.parse(readFileSync("e2e/.fixture.json", "utf-8"));
  const baseURL = config.projects[0].use.baseURL ?? "http://localhost:3100";
  const ctx = await request.newContext({ baseURL });
  const res = await ctx.post("/api/auth/login/", { data: { login: fx.login, password: fx.password } });
  if (res.status() !== 200) throw new Error(`Fixture login failed (${res.status()}): run make layout, which seeds it.`);
  await ctx.storageState({ path: "e2e/.auth.json" });
  await ctx.dispose();
}
