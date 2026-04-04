import { render, screen } from "@testing-library/react";

import HomePage from "@/app/page";

describe("HomePage", () => {
  it("renders the main marketing headline and CTAs", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: /a clean web shell for the next phase of document tooling/i,
      })
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /view bootstrap issue/i })
    ).toHaveAttribute(
      "href",
      "https://github.com/ikiru1372k2/ulazytools.online/issues/97"
    );

    expect(
      screen.getByRole("link", { name: /browse tools/i })
    ).toHaveAttribute("href", "/tools");

    expect(
      screen.getByRole("link", { name: /open protected app/i })
    ).toHaveAttribute("href", "/dashboard");
  });

  it("renders the verified baseline highlights", () => {
    render(<HomePage />);

    expect(screen.getByText(/verified project baseline/i)).toBeInTheDocument();
    expect(
      screen.getByText(/next\.js 14 app router foundation/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/strict typescript with alias-ready imports/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/tailwind-wired starter shell for future pdf tools/i)
    ).toBeInTheDocument();
  });
});
