import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SignInPage from "@/app/sign-in/page";

describe("the sign-in page", () => {
  const html = renderToString(<SignInPage />);

  it("offers Google, and the email link as the other way", () => {
    expect(html).toContain("Continue with Google");
    expect(html).toContain("Email me a sign-in link");
  });

  it("has both buttons ready to use when nothing is happening", () => {
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });
});
