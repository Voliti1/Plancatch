import { expect, test } from "@playwright/test";
import { mockApi, user, login } from "./fixtures";
import { localInput, zonedInputToUtc } from "../lib/date/time-zones";

test("guest choice stays in its browser across reloads", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-25T01:30:00Z"));
  await page.goto("/login");
  const picker = page.getByLabel("기준 시간대 변경");
  await expect(picker).toHaveValue("Asia/Seoul");
  await expect(page.getByLabel("현재 시각")).toHaveText("한국 10:30");
  const trigger = page.locator(".timezone.time-zone-select");
  await expect(trigger).toContainText("Asia/Seoul · 한국 시간");
  await expect(trigger).toHaveCSS("font-size", "12px");
  await expect(trigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(trigger.locator("svg")).toHaveCount(0);
  if (await page.evaluate(() => matchMedia("(hover: hover)").matches)) {
    await picker.hover();
    await expect(trigger).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await page.mouse.move(0, 0);
    await expect(trigger).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  }
  await picker.selectOption("America/New_York");
  await expect(page.getByLabel("현재 시각")).toContainText("미국 · 뉴욕 20:30");
  await page.reload();
  await expect(picker).toHaveValue("America/New_York");
});

test("account choice updates the deadline editor and local calendar date", async ({
  page,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-25T01:30:00Z"));
  const deadline = {
    id: "zone-deadline",
    title: "시간대 확인",
    due_at: "2026-11-25T01:30:00Z",
    safe_due_at: null,
    safety_buffer_minutes: null,
    description: null,
    confidence: null,
    evidence_text: null,
    deadline_type: null,
    source_id: null,
    is_confirmed: true,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
  };
  await mockApi(page, [], { deadlines: [deadline] });
  await login(page);
  let timeZone = "Asia/Seoul";
  await page.route("**/test-api/api/auth/me", (route) =>
    route.fulfill({ json: { ...user, time_zone: timeZone } }),
  );
  await page.route("**/test-api/api/auth/time-zone", (route) => {
    expect(route.request().method()).toBe("PATCH");
    timeZone = route.request().postDataJSON().time_zone;
    return route.fulfill({ json: { ...user, time_zone: timeZone } });
  });
  await page.goto("/deadlines/zone-deadline");
  const picker = page.getByLabel("기준 시간대 변경");
  await expect(page.getByLabel("마감 일시 (한국 시간)")).toHaveValue(
    "2026-11-25T10:30",
  );
  await picker.selectOption("America/New_York");
  await expect(picker).toHaveValue("America/New_York");
  await expect(page.getByLabel("마감 일시 (미국 · 뉴욕)")).toHaveValue(
    "2026-11-24T20:30",
  );
  await page.reload();
  await expect(picker).toHaveValue("America/New_York");
  await page.goto("/calendar");
  await expect(page.getByLabel("기준 날짜")).toHaveValue("2026-11-24");
  await expect(
    page
      .getByRole("region", { name: "하루 시간표" })
      .getByRole("button", { name: /시간대 확인/ }),
  ).toContainText("20:30");
});

test("regional wall times round-trip and account for daylight saving", () => {
  const zone = "America/New_York";
  for (const [value, expected] of [
    ["2026-01-15T19:30", "2026-01-16T00:30:00.000Z"],
    ["2026-07-15T20:30", "2026-07-16T00:30:00.000Z"],
    ["2026-11-01T01:30", "2026-11-01T05:30:00.000Z"],
  ]) {
    expect(zonedInputToUtc(value, zone)).toBe(expected);
    expect(localInput(expected, zone)).toBe(value);
  }
  expect(() => zonedInputToUtc("2026-03-08T02:30", zone)).toThrow();
  expect(zonedInputToUtc("2026-03-08T02:30", zone, "next")).toBe(
    "2026-03-08T07:30:00.000Z",
  );
  expect(zonedInputToUtc("2026-11-25T07:15", "Asia/Kathmandu")).toBe(
    "2026-11-25T01:30:00.000Z",
  );
});
