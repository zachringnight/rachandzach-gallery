import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

function trainSnapshot(now = Date.now()) {
  return { checkedAt: new Date(now).toISOString(), services: [
    { boardId: "canal", route: "N", status: "fresh", feedAt: new Date(now).toISOString(), arrivals: [{ id: "canal-n", at: new Date(now + 180_000).toISOString(), destinationAt: new Date(now + 1200_000).toISOString(), platform: "Manhattan Bridge platform" }] },
    { boardId: "36th", route: "N", status: "fresh", feedAt: new Date(now).toISOString(), arrivals: [] },
    { boardId: "36th", route: "D", status: "fresh", feedAt: new Date(now).toISOString(), arrivals: [{ id: "36th-d", at: new Date(now + 300_000).toISOString(), destinationAt: new Date(now + 900_000).toISOString(), platform: "" }] },
    { boardId: "atlantic", route: "Q", status: "fresh", feedAt: new Date(now).toISOString(), arrivals: [{ id: "atlantic-q", at: new Date(now + 420_000).toISOString(), destinationAt: new Date(now + 2100_000).toISOString(), platform: "" }] },
  ] };
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/cheer/arrivals", (route) => route.fulfill({ json: trainSnapshot() }));
});

for (const width of [1440, 390]) {
  test(`cheer itinerary, timing, persistence and maps at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/cheer/transit", (route) => route.fulfill({ json: {
      checkedAt: new Date().toISOString(), feedAt: new Date().toISOString(), status: "fresh", alerts: [],
    } }));
    await page.goto("/cheer");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Let’s hear it for Rach.");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
    await expect(page.getByText("No N/D/Q alerts reported", { exact: false })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("11 Howard");
    await expect(page.getByRole("link", { name: "Google Maps", exact: true })).toHaveAttribute("href", /Brooklyn/);

    await page.getByRole("button", { name: "03 Fifth Avenue" }).click();
    const selected = page.getByRole("region", { name: "Fifth Avenue & East 96th Street" });
    await expect(selected).toContainText("12:12 PM");
    await expect(selected).toContainText("Northeast corner");
    await expect(selected).toContainText("0.6–0.7 mile");
    await page.getByLabel("Finish goal (h:mm)").fill("3:15");
    await page.getByRole("button", { name: "Update times" }).click();
    await expect(selected).toContainText("12:03 PM");
    await page.getByLabel("Start-line crossing").fill("09:20");
    await page.getByRole("button", { name: "Update times" }).click();
    await expect(selected).toContainText("12:13 PM");
    await page.reload();
    await expect(page.getByRole("button", { name: "03 Fifth Avenue" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByLabel("Finish goal (h:mm)")).toHaveValue("3:15");
    await expect(selected).toContainText("12:13 PM");
    await expect(page.getByRole("link", { name: "Google Maps", exact: true })).toHaveAttribute("href", /Manhattan/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "01 Brooklyn" }).click();
    await page.screenshot({ path: testInfo.outputPath(`cheer-${width}.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("unavailable and stale alerts cannot look like good service", async ({ page }) => {
  await page.route("**/api/cheer/transit", (route) => route.fulfill({ status: 503, json: {
    checkedAt: new Date().toISOString(), feedAt: null, status: "unavailable", alerts: [], message: "MTA alerts are unavailable. Check the MTA app.",
  } }));
  await page.goto("/cheer");
  await expect(page.getByText("MTA alerts are unavailable", { exact: false })).toBeVisible();
  await expect(page.getByText("Unverified", { exact: true })).toHaveCount(3);
  await expect(page.getByRole("heading", { name: "Fourth Avenue & 36th Street" })).toBeVisible();
  await page.unroute("**/api/cheer/transit");
  await page.route("**/api/cheer/transit", (route) => route.fulfill({ json: {
    checkedAt: new Date().toISOString(), feedAt: new Date(Date.now() - 20 * 60_000).toISOString(), status: "fresh", alerts: [],
  } }));
  await page.getByRole("button", { name: "Refresh subway alerts" }).click();
  await expect(page.getByText("MTA’s feed is over 10 minutes old", { exact: false })).toBeVisible();
  await expect(page.getByText("Unverified", { exact: true })).toHaveCount(3);
  await expect(page.getByText("No reported alerts", { exact: true })).toHaveCount(0);
});

test("copy plan works and has a manual fallback", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.route("**/api/cheer/transit", (route) => route.fulfill({ json: { status: "fresh", checkedAt: new Date().toISOString(), feedAt: new Date().toISOString(), alerts: [] } }));
  await page.goto("/cheer");
  await page.getByRole("button", { name: "Copy group plan" }).click();
  await expect(page.getByRole("status")).toHaveText("Itinerary copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("First Avenue & East 96th Street");
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, "writeText", { value: () => Promise.reject(new Error("denied")) }); });
  await page.getByRole("button", { name: "Copy bib" }).click();
  await expect(page.getByLabel("Text to copy")).toHaveValue("10378");
});

test("live train boards show the right directions and hide stale countdowns", async ({ page }) => {
  await page.route("**/api/cheer/transit", (route) => route.fulfill({ json: { status: "fresh", checkedAt: new Date().toISOString(), feedAt: new Date().toISOString(), alerts: [] } }));
  await page.goto("/cheer");
  const trains = page.getByRole("region", { name: "Next trains" });
  await expect(trains.getByText("3 min", { exact: true })).toBeVisible();
  await expect(trains.getByText("5 min", { exact: true })).toBeVisible();
  await expect(trains.getByText("7 min", { exact: true })).toBeVisible();
  await expect(trains).toContainText("Manhattan-bound N or D");
  await expect(trains).toContainText("Manhattan Bridge platform");
  await page.unroute("**/api/cheer/arrivals");
  await page.route("**/api/cheer/arrivals", (route) => {
    const stale = trainSnapshot(); stale.services.forEach((s) => { s.feedAt = new Date(Date.now() - 180_000).toISOString(); });
    return route.fulfill({ json: stale });
  });
  await page.getByRole("button", { name: "Refresh train arrivals" }).click();
  await expect(trains.getByText(/feed is old; countdowns hidden/)).toHaveCount(4);
  await expect(trains.getByText("3 min", { exact: true })).toHaveCount(0);
});

test("partial and total train feed failures remain explicit", async ({ page }) => {
  await page.unroute("**/api/cheer/arrivals");
  await page.route("**/api/cheer/arrivals", (route) => {
    const partial = trainSnapshot(); partial.services[2].status = "unavailable"; partial.services[2].arrivals = [];
    return route.fulfill({ json: partial });
  });
  await page.goto("/cheer");
  const trains = page.getByRole("region", { name: "Next trains" });
  await expect(trains).toContainText("D: predictions unavailable");
  await expect(trains.getByText("3 min", { exact: true })).toBeVisible();
  await page.unroute("**/api/cheer/arrivals");
  await page.route("**/api/cheer/arrivals", (route) => route.abort());
  await page.getByRole("button", { name: "Refresh train arrivals" }).click();
  await expect(trains).toContainText("Train times are unavailable");
  await expect(trains.getByText("3 min", { exact: true })).toHaveCount(0);
});
