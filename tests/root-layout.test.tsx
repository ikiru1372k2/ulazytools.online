import { renderToStaticMarkup } from "react-dom/server";

import RootLayout, { metadata } from "@/app/layout";

describe("RootLayout", () => {
  it("exports the expected metadata", () => {
    expect(metadata.title).toBe("ulazytools.online");
    expect(metadata.description).toBe(
      "A lightweight web shell for ulazytools.online."
    );
  });

  it("renders children inside the document body", () => {
    const markup = renderToStaticMarkup(
      <RootLayout>
        <div>Dashboard placeholder</div>
      </RootLayout>
    );

    expect(markup).toContain('<html lang="en">');
    expect(markup).toContain("<body>");
    expect(markup).toContain("Dashboard placeholder");
  });
});
