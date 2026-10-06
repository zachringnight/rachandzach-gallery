import { test, expect } from "@playwright/test";

for (const width of [1440, 390]) {
  test(`NYC fundraising snapshot remains accurate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1024 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await page.goto("/nyc");
    const progress = page.locator(".atlas-nyc-progress-card");
    await expect(progress.getByText("$8,770.50", { exact: true })).toBeVisible();
    await expect(progress).toContainText("$1,229.50 to go.");
    await expect(progress).toContainText("81 donations so far.");
    await expect(progress).toContainText("October 5, 2026");
    await expect(progress.getByRole("progressbar")).toHaveAttribute(
      "aria-valuetext", "$8,770.50 raised of $10,000",
    );
    await expect(page.getByRole("link", { name: "Donate to her run" })).toHaveAttribute(
      "href", "https://donations.nyrr.org/donations/new?fundraiser=fa3fbedc687074f450f7",
    );
    await expect(page.locator(".atlas-nyc-supporters-note")).toContainText(
      "Supporter wall as of August 17, 2026",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.reload();
    await expect(progress).toContainText("$8,770.50");
    expect(errors).toEqual([]);
  });
}
