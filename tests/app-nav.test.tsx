import { render, screen } from "@testing-library/react";

import AppNav from "@/components/nav/AppNav";

describe("AppNav", () => {
  it("renders primary navigation links and marks the current path", () => {
    render(<AppNav currentPath="/tools" />);

    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: /tools/i })).toHaveAttribute("href", "/tools");
    expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute(
      "href",
      "/dashboard"
    );
    expect(screen.getByRole("link", { name: /tools/i })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});
